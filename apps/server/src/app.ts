import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3";
import { and, desc, eq, gt } from "drizzle-orm";
import {
  adminSettingsPatchSchema,
  authRequestSchema,
  magnetFeedbackRequestSchema,
  magnetResolveRequestSchema,
  normalizeInfoHash,
  parseMagnetLink,
  type LeaderboardItemDto,
  type MagnetMetadataDto,
  type MagnetStatus,
  type MagnetVoteValue,
  type SafeUserDto,
  type ScreenshotPreview
} from "../../../packages/shared/src";
import {
  constantTimeEqual,
  hashPassword,
  hashSessionToken,
  isAdmin,
  safeUser,
  verifyPasswordHash
} from "./auth/security";
import type { AppDatabase } from "./db";
import {
  favorites,
  magnetMetadata,
  magnetVotes,
  queryEvents,
  sessions,
  users,
  type MagnetMetadataRecord,
  type UserRecord
} from "./db/schema";
import { createId, createSessionToken } from "./ids";
import {
  getBooleanSetting,
  getNumberSetting,
  readPublicSettings,
  seedDefaultSettings,
  setSetting,
  SETTING_KEYS
} from "./settings";
import {
  type FetchLike,
  getCacheTtlMs,
  type NormalizedWhatslinkResponse,
  type WhatslinkClient
} from "./whatslink";

const SESSION_COOKIE = "magnet_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Variables = {
  user: SafeUserDto | null;
  sessionTokenHash: string | null;
};

type AppOptions = {
  db: AppDatabase;
  sqlite: Database.Database;
  whatslink: Pick<WhatslinkClient, "resolve" | "healthcheck">;
  previewFetch?: FetchLike;
  config: {
    appOrigin: string;
    sessionSecret: string;
    screenshotsEnabledDefault: boolean;
    whatslinkBaseUrl?: string;
    staticRoot?: string;
  };
};

type RateBucket = {
  windowStart: number;
  count: number;
};

export function createApp(options: AppOptions) {
  const { db, sqlite, whatslink, config } = options;
  const app = new Hono<{ Variables: Variables }>();
  const rateBuckets = new Map<string, RateBucket>();

  seedDefaultSettings(db, config.screenshotsEnabledDefault);

  app.use(
    "/api/*",
    cors({
      origin: config.appOrigin,
      credentials: true
    })
  );

  app.use("*", async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const loaded = token
      ? loadUserFromSession(db, config.sessionSecret, token)
      : null;
    c.set("user", loaded?.user ?? null);
    c.set("sessionTokenHash", loaded?.sessionTokenHash ?? null);
    await next();
  });

  const requireAuth = async (
    c: Parameters<Parameters<typeof app.use>[1]>[0],
    next: () => Promise<void>
  ) => {
    if (!c.var.user) {
      return c.json({ error: "UNAUTHENTICATED" }, 401);
    }
    await next();
  };

  const requireAdmin = async (
    c: Parameters<Parameters<typeof app.use>[1]>[0],
    next: () => Promise<void>
  ) => {
    if (!c.var.user) {
      return c.json({ error: "UNAUTHENTICATED" }, 401);
    }
    if (!isAdmin(c.var.user)) {
      return c.json({ error: "FORBIDDEN" }, 403);
    }
    await next();
  };

  app.get("/api/health", (c) =>
    c.json({ ok: true, settings: readPublicSettings(db) })
  );

  app.get("/api/previews/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^[a-z0-9]{8,96}$/i.test(id)) {
      return c.json({ error: "PREVIEW_ID_INVALID" }, 400);
    }

    const base = new URL(config.whatslinkBaseUrl ?? "https://whatslink.info");
    const upstream = new URL(`/image/${id}`, base);
    const response = await (options.previewFetch ?? fetch)(upstream, {
      headers: {
        accept: "image/*",
        referer: `${base.origin}/`
      }
    });

    if (!response.ok) {
      return c.json({ error: "PREVIEW_UNAVAILABLE" }, 502);
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return c.json({ error: "PREVIEW_CONTENT_INVALID" }, 502);
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400"
      }
    });
  });

  app.post("/api/magnets/resolve", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsedBody = magnetResolveRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json({ error: "REQUEST_INVALID" }, 400);
    }

    let parsedMagnet: ReturnType<typeof parseMagnetLink>;
    try {
      parsedMagnet = parseMagnetLink(parsedBody.data.magnet);
    } catch {
      return c.json({ error: "MAGNET_INVALID" }, 400);
    }

    const rateLimit = checkRateLimit({
      db,
      buckets: rateBuckets,
      actorKey: actorKeyForRequest(c.req.header("x-forwarded-for"), c.var.user),
      user: c.var.user
    });
    if (!rateLimit.allowed) {
      return c.json(
        {
          error: "RATE_LIMITED",
          retryAfterSeconds: rateLimit.retryAfterSeconds
        },
        429
      );
    }

    const now = Date.now();
    const screenshotsEnabled = getBooleanSetting(
      db,
      SETTING_KEYS.screenshotsEnabled,
      true
    );
    const cached = db
      .select()
      .from(magnetMetadata)
      .where(eq(magnetMetadata.infoHash, parsedMagnet.infoHash))
      .get();

    if (cached && cached.expiresAt > now) {
      recordQuery(db, {
        user: c.var.user,
        actorKey: rateLimit.actorKey,
        infoHash: parsedMagnet.infoHash,
        status: cached.status,
        source: "cache"
      });
      return c.json({
        source: "cache",
        data: metadataToDto(
          db,
          cached,
          screenshotsEnabled,
          c.var.user?.id,
          rateLimit.actorKey
        )
      });
    }

    try {
      const upstream = await whatslink.resolve(parsedBody.data.magnet);
      const saved = upsertMetadata(db, parsedMagnet.infoHash, upstream, {
        fallbackName: parsedMagnet.displayName
      });
      recordQuery(db, {
        user: c.var.user,
        actorKey: rateLimit.actorKey,
        infoHash: parsedMagnet.infoHash,
        status: saved.status,
        source: "upstream"
      });
      return c.json({
        source: "upstream",
        data: metadataToDto(
          db,
          saved,
          screenshotsEnabled,
          c.var.user?.id,
          rateLimit.actorKey
        )
      });
    } catch (error) {
      const saved = upsertMetadata(
        db,
        parsedMagnet.infoHash,
        {
          status: "error",
          type: "ERROR",
          fileType: "",
          name: parsedMagnet.displayName ?? "",
          size: 0,
          count: 0,
          screenshots: [],
          error: error instanceof Error ? error.message : "WHATSLINK_ERROR"
        },
        { fallbackName: parsedMagnet.displayName }
      );
      recordQuery(db, {
        user: c.var.user,
        actorKey: rateLimit.actorKey,
        infoHash: parsedMagnet.infoHash,
        status: "error",
        source: "error"
      });
      return c.json(
        {
          error: "WHATSLINK_UNAVAILABLE",
          data: metadataToDto(
            db,
            saved,
            screenshotsEnabled,
            c.var.user?.id,
            rateLimit.actorKey
          )
        },
        502
      );
    }
  });

  // Independent path so it never collides with /api/magnets/:hash.
  app.get("/api/leaderboard", (c) => {
    const limitRaw = Number(c.req.query("limit") ?? "20");
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50)
      : 20;
    const revealLinks = Boolean(c.var.user);

    const rows = sqlite
      .prepare(
        `
        SELECT
          mm.info_hash as infoHash,
          mm.name as name,
          mm.status as status,
          mm.size as size,
          mm.count as count,
          COALESCE(SUM(mv.vote), 0) as score,
          COUNT(mv.actor_key) as voteCount
        FROM magnet_metadata mm
        LEFT JOIN magnet_votes mv ON mv.info_hash = mm.info_hash
        GROUP BY mm.info_hash
        HAVING COUNT(mv.actor_key) > 0
        ORDER BY score DESC, voteCount DESC, mm.updated_at DESC
        LIMIT ?
      `
      )
      .all(limit) as Array<{
      infoHash: string;
      name: string;
      status: MagnetStatus;
      size: number;
      count: number;
      score: number;
      voteCount: number;
    }>;

    const items: LeaderboardItemDto[] = rows.map((row) => {
      const item: LeaderboardItemDto = {
        // Guests only see a shortened hash so the full magnet cannot be rebuilt.
        infoHash: revealLinks ? row.infoHash : maskInfoHash(row.infoHash),
        name: row.name,
        status: row.status,
        size: row.size,
        count: row.count,
        score: Number(row.score) || 0,
        voteCount: Number(row.voteCount) || 0
      };
      if (revealLinks) {
        item.magnetLink = buildMagnetLink(row.infoHash, row.name);
      }
      return item;
    });

    return c.json({ items, linksVisible: revealLinks });
  });

  app.get("/api/magnets/:hash", (c) => {
    let infoHash: string;
    try {
      infoHash = normalizeInfoHash(c.req.param("hash"));
    } catch {
      return c.json({ error: "HASH_INVALID" }, 400);
    }

    const cached = db
      .select()
      .from(magnetMetadata)
      .where(eq(magnetMetadata.infoHash, infoHash))
      .get();

    if (!cached) {
      return c.json({ error: "MAGNET_NOT_FOUND" }, 404);
    }

    const actorKey = actorKeyForRequest(
      c.req.header("x-forwarded-for"),
      c.var.user
    );

    return c.json({
      data: metadataToDto(
        db,
        cached,
        getBooleanSetting(db, SETTING_KEYS.screenshotsEnabled, true),
        c.var.user?.id,
        actorKey
      )
    });
  });

  app.post("/api/magnets/:hash/feedback", async (c) => {
    let infoHash: string;
    try {
      infoHash = normalizeInfoHash(c.req.param("hash"));
    } catch {
      return c.json({ error: "HASH_INVALID" }, 400);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = magnetFeedbackRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "REQUEST_INVALID" }, 400);
    }

    const metadata = db
      .select()
      .from(magnetMetadata)
      .where(eq(magnetMetadata.infoHash, infoHash))
      .get();
    if (!metadata) {
      return c.json({ error: "MAGNET_NOT_FOUND" }, 404);
    }

    const actorKey = actorKeyForRequest(
      c.req.header("x-forwarded-for"),
      c.var.user
    );
    const nextVote: MagnetVoteValue = parsed.data.vote === "up" ? 1 : -1;
    const now = Date.now();
    const existing = db
      .select()
      .from(magnetVotes)
      .where(
        and(
          eq(magnetVotes.infoHash, infoHash),
          eq(magnetVotes.actorKey, actorKey)
        )
      )
      .get();

    // Clicking the same reaction again cancels the vote.
    if (existing && existing.vote === nextVote) {
      db.delete(magnetVotes)
        .where(
          and(
            eq(magnetVotes.infoHash, infoHash),
            eq(magnetVotes.actorKey, actorKey)
          )
        )
        .run();
    } else {
      db.insert(magnetVotes)
        .values({
          infoHash,
          actorKey,
          vote: nextVote,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: [magnetVotes.infoHash, magnetVotes.actorKey],
          set: {
            vote: nextVote,
            updatedAt: now
          }
        })
        .run();
    }

    return c.json({
      data: metadataToDto(
        db,
        metadata,
        getBooleanSetting(db, SETTING_KEYS.screenshotsEnabled, true),
        c.var.user?.id,
        actorKey
      )
    });
  });

  app.post("/api/auth/register", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = authRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "REQUEST_INVALID" }, 400);
    }

    const email = parsed.data.email.trim().toLowerCase();
    const existing = db.select().from(users).where(eq(users.email, email)).get();
    if (existing) {
      return c.json({ error: "EMAIL_EXISTS" }, 409);
    }

    const user: UserRecord = {
      id: createId("usr"),
      email,
      passwordHash: await hashPassword(parsed.data.password),
      role: "user",
      createdAt: Date.now()
    };
    db.insert(users).values(user).run();
    const session = createSession(db, config.sessionSecret, user.id);
    writeSessionCookie(c, session.token, config.appOrigin);
    return c.json({ user: safeUser(user) }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = authRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "REQUEST_INVALID" }, 400);
    }

    const email = parsed.data.email.trim().toLowerCase();
    const user = db.select().from(users).where(eq(users.email, email)).get();
    if (!user || !(await verifyPasswordHash(user.passwordHash, parsed.data.password))) {
      return c.json({ error: "AUTH_INVALID" }, 401);
    }

    const session = createSession(db, config.sessionSecret, user.id);
    writeSessionCookie(c, session.token, config.appOrigin);
    return c.json({ user: safeUser(user) });
  });

  app.post("/api/auth/logout", (c) => {
    if (c.var.sessionTokenHash) {
      db.delete(sessions)
        .where(eq(sessions.tokenHash, c.var.sessionTokenHash))
        .run();
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/auth/session", (c) => {
    return c.json({ user: c.var.user });
  });

  app.use("/api/me/*", requireAuth);

  app.get("/api/me/history", (c) => {
    const user = c.var.user!;
    const rows = sqlite
      .prepare(
        `
        SELECT qe.created_at as queriedAt, qe.source, qe.status as eventStatus,
               mm.info_hash as infoHash,
               mm.status,
               mm.type,
               mm.file_type as fileType,
               mm.name,
               mm.size,
               mm.count,
               mm.screenshots_json as screenshotsJson,
               mm.error,
               mm.fetched_at as fetchedAt,
               mm.expires_at as expiresAt,
               mm.updated_at as updatedAt
        FROM query_events qe
        LEFT JOIN magnet_metadata mm ON mm.info_hash = qe.info_hash
        WHERE qe.user_id = ?
        ORDER BY qe.created_at DESC
        LIMIT 50
      `
      )
      .all(user.id) as Array<MagnetMetadataRecord & {
        queriedAt: number;
        source: string;
        eventStatus: MagnetStatus;
      }>;

    return c.json({
      items: rows
        .filter((row) => row.infoHash)
        .map((row) => ({
          queriedAt: row.queriedAt,
          source: row.source,
          data: metadataToDto(
            db,
            row,
            getBooleanSetting(db, SETTING_KEYS.screenshotsEnabled, true),
            user.id,
            `user:${user.id}`
          )
        }))
    });
  });

  app.get("/api/me/favorites", (c) => {
    const user = c.var.user!;
    const rows = sqlite
      .prepare(
        `
        SELECT f.created_at as favoritedAt,
               mm.info_hash as infoHash,
               mm.status,
               mm.type,
               mm.file_type as fileType,
               mm.name,
               mm.size,
               mm.count,
               mm.screenshots_json as screenshotsJson,
               mm.error,
               mm.fetched_at as fetchedAt,
               mm.expires_at as expiresAt,
               mm.updated_at as updatedAt
        FROM favorites f
        JOIN magnet_metadata mm ON mm.info_hash = f.info_hash
        WHERE f.user_id = ?
        ORDER BY f.created_at DESC
        LIMIT 50
      `
      )
      .all(user.id) as Array<MagnetMetadataRecord & { favoritedAt: number }>;

    return c.json({
      items: rows.map((row) => ({
        favoritedAt: row.favoritedAt,
        data: metadataToDto(
          db,
          row,
          getBooleanSetting(db, SETTING_KEYS.screenshotsEnabled, true),
          user.id,
          `user:${user.id}`
        )
      }))
    });
  });

  app.post("/api/me/favorites/:hash", (c) => {
    const user = c.var.user!;
    let infoHash: string;
    try {
      infoHash = normalizeInfoHash(c.req.param("hash"));
    } catch {
      return c.json({ error: "HASH_INVALID" }, 400);
    }

    const metadata = db
      .select()
      .from(magnetMetadata)
      .where(eq(magnetMetadata.infoHash, infoHash))
      .get();
    if (!metadata) {
      return c.json({ error: "MAGNET_NOT_FOUND" }, 404);
    }

    db.insert(favorites)
      .values({ userId: user.id, infoHash, createdAt: Date.now() })
      .onConflictDoNothing()
      .run();

    return c.json({ ok: true });
  });

  app.delete("/api/me/favorites/:hash", (c) => {
    const user = c.var.user!;
    let infoHash: string;
    try {
      infoHash = normalizeInfoHash(c.req.param("hash"));
    } catch {
      return c.json({ error: "HASH_INVALID" }, 400);
    }

    db.delete(favorites)
      .where(and(eq(favorites.userId, user.id), eq(favorites.infoHash, infoHash)))
      .run();

    return c.json({ ok: true });
  });

  app.use("/api/admin/*", requireAdmin);

  app.get("/api/admin/users", (c) => {
    const rows = db.select().from(users).orderBy(desc(users.createdAt)).all();
    return c.json({ items: rows.map(safeUser) });
  });

  app.get("/api/admin/queries", (c) => {
    const rows = sqlite
      .prepare(
        `
        SELECT qe.*, mm.name, mm.size, u.email
        FROM query_events qe
        LEFT JOIN magnet_metadata mm ON mm.info_hash = qe.info_hash
        LEFT JOIN users u ON u.id = qe.user_id
        ORDER BY qe.created_at DESC
        LIMIT 100
      `
      )
      .all();
    return c.json({ items: rows });
  });

  app.get("/api/admin/stats", (c) => {
    const row = sqlite
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM users) as users,
          (SELECT COUNT(*) FROM query_events) as queries,
          (SELECT COUNT(*) FROM favorites) as favorites,
          (SELECT COUNT(*) FROM magnet_metadata WHERE status = 'ok') as cachedOk,
          (SELECT COUNT(*) FROM magnet_metadata WHERE status = 'unknown') as cachedUnknown
      `
      )
      .get();
    return c.json({ stats: row, settings: readPublicSettings(db) });
  });

  app.get("/api/admin/settings", (c) =>
    c.json({ settings: readPublicSettings(db) })
  );

  app.patch("/api/admin/settings", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = adminSettingsPatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "REQUEST_INVALID" }, 400);
    }

    if (parsed.data.screenshotsEnabled !== undefined) {
      setSetting(
        db,
        SETTING_KEYS.screenshotsEnabled,
        String(parsed.data.screenshotsEnabled)
      );
    }
    if (parsed.data.guestRateLimitPerHour !== undefined) {
      setSetting(
        db,
        SETTING_KEYS.guestRateLimitPerHour,
        String(parsed.data.guestRateLimitPerHour)
      );
    }
    if (parsed.data.userRateLimitPerHour !== undefined) {
      setSetting(
        db,
        SETTING_KEYS.userRateLimitPerHour,
        String(parsed.data.userRateLimitPerHour)
      );
    }

    return c.json({ settings: readPublicSettings(db) });
  });

  app.get("/api/admin/health", async (c) => {
    return c.json({ whatslink: await whatslink.healthcheck() });
  });

  // Never serve the SPA shell for unknown API routes — that breaks clients
  // that treat HTML 200 responses as successful JSON.
  app.all("/api/*", (c) => c.json({ error: "NOT_FOUND" }, 404));

  if (config.staticRoot) {
    app.use("/assets/*", serveStatic({ root: config.staticRoot }));
    app.get("*", serveStatic({ root: config.staticRoot, path: "index.html" }));
  }

  return app;
}

export async function seedAdminUser(
  db: AppDatabase,
  email?: string,
  password?: string
): Promise<void> {
  if (!email || !password) return;

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .get();

  if (existing) {
    if (existing.role !== "admin") {
      db.update(users)
        .set({ role: "admin" })
        .where(eq(users.id, existing.id))
        .run();
    }
    return;
  }

  db.insert(users)
    .values({
      id: createId("usr"),
      email: normalizedEmail,
      passwordHash: await hashPassword(password),
      role: "admin",
      createdAt: Date.now()
    })
    .run();
}

function loadUserFromSession(
  db: AppDatabase,
  secret: string,
  token: string
): { user: SafeUserDto; sessionTokenHash: string } | null {
  const tokenHash = hashSessionToken(secret, token);
  const row = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, Date.now())))
    .get();
  if (!row || !constantTimeEqual(row.tokenHash, tokenHash)) return null;

  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  return user ? { user: safeUser(user), sessionTokenHash: tokenHash } : null;
}

function createSession(db: AppDatabase, secret: string, userId: string) {
  const token = createSessionToken();
  const now = Date.now();
  db.insert(sessions)
    .values({
      tokenHash: hashSessionToken(secret, token),
      userId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS
    })
    .run();
  return { token };
}

function writeSessionCookie(
  c: Parameters<Parameters<ReturnType<typeof createApp>["post"]>[1]>[0],
  token: string,
  appOrigin: string
): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: appOrigin.startsWith("https://"),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  });
}

function upsertMetadata(
  db: AppDatabase,
  infoHash: string,
  upstream: NormalizedWhatslinkResponse,
  options: { fallbackName?: string }
): MagnetMetadataRecord {
  const now = Date.now();
  const record = {
    infoHash,
    status: upstream.status,
    type: upstream.type,
    fileType: upstream.fileType,
    name: upstream.name || options.fallbackName || "",
    size: upstream.size,
    count: upstream.count,
    screenshotsJson: JSON.stringify(upstream.screenshots),
    error: upstream.error ?? null,
    fetchedAt: now,
    expiresAt: now + getCacheTtlMs(upstream.status),
    updatedAt: now
  };

  db.insert(magnetMetadata)
    .values(record)
    .onConflictDoUpdate({
      target: magnetMetadata.infoHash,
      set: {
        status: record.status,
        type: record.type,
        fileType: record.fileType,
        name: record.name,
        size: record.size,
        count: record.count,
        screenshotsJson: record.screenshotsJson,
        error: record.error,
        fetchedAt: record.fetchedAt,
        expiresAt: record.expiresAt,
        updatedAt: record.updatedAt
      }
    })
    .run();

  return db
    .select()
    .from(magnetMetadata)
    .where(eq(magnetMetadata.infoHash, infoHash))
    .get()!;
}

function metadataToDto(
  db: AppDatabase,
  row: MagnetMetadataRecord,
  screenshotsEnabled: boolean,
  userId?: string,
  actorKey?: string
): MagnetMetadataDto {
  const screenshots = screenshotsEnabled
    ? parseScreenshots(row.screenshotsJson).map((item) => ({
        ...item,
        screenshot: toPreviewUrl(item.screenshot)
      }))
    : [];
  const favorite = userId
    ? db
        .select()
        .from(favorites)
        .where(and(eq(favorites.userId, userId), eq(favorites.infoHash, row.infoHash)))
        .get()
    : null;

  let score = 0;
  let myVote: MagnetVoteValue | null = null;
  try {
    score = getMagnetScore(db, row.infoHash);
    myVote = actorKey ? getMyVote(db, row.infoHash, actorKey) : null;
  } catch {
    // Voting table may be missing on very old DBs before migrate; keep query usable.
    score = 0;
    myVote = null;
  }

  return {
    infoHash: row.infoHash,
    status: row.status,
    type: row.type,
    fileType: row.fileType,
    name: row.name,
    size: row.size,
    count: row.count,
    screenshots,
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
    isFavorite: Boolean(favorite),
    score: Number.isFinite(score) ? score : 0,
    myVote
  };
}

function getMagnetScore(db: AppDatabase, infoHash: string): number {
  const rows = db
    .select({ vote: magnetVotes.vote })
    .from(magnetVotes)
    .where(eq(magnetVotes.infoHash, infoHash))
    .all();
  return rows.reduce((sum, row) => sum + (Number(row.vote) || 0), 0);
}

function buildMagnetLink(infoHash: string, name?: string): string {
  let link = `magnet:?xt=urn:btih:${infoHash}`;
  const displayName = name?.trim();
  if (displayName) {
    link += `&dn=${encodeURIComponent(displayName)}`;
  }
  return link;
}

function maskInfoHash(infoHash: string): string {
  if (infoHash.length <= 12) return infoHash;
  return `${infoHash.slice(0, 6)}…${infoHash.slice(-4)}`;
}

function getMyVote(
  db: AppDatabase,
  infoHash: string,
  actorKey: string
): MagnetVoteValue | null {
  const row = db
    .select()
    .from(magnetVotes)
    .where(
      and(eq(magnetVotes.infoHash, infoHash), eq(magnetVotes.actorKey, actorKey))
    )
    .get();
  if (!row) return null;
  return row.vote === 1 || row.vote === -1 ? (row.vote as MagnetVoteValue) : null;
}

function parseScreenshots(value: string): ScreenshotPreview[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toPreviewUrl(value: string): string {
  try {
    const url = new URL(value);
    const match = /^\/image\/([^/?#]+)$/.exec(url.pathname);
    return match ? `/api/previews/${encodeURIComponent(match[1]!)}` : value;
  } catch {
    return value;
  }
}

function recordQuery(
  db: AppDatabase,
  event: {
    user: SafeUserDto | null;
    actorKey: string;
    infoHash: string;
    status: MagnetStatus;
    source: "cache" | "upstream" | "error";
  }
): void {
  db.insert(queryEvents)
    .values({
      id: createId("qry"),
      userId: event.user?.id ?? null,
      actorKey: event.actorKey,
      infoHash: event.infoHash,
      status: event.status,
      source: event.source,
      createdAt: Date.now()
    })
    .run();
}

function actorKeyForRequest(
  forwardedFor: string | undefined,
  user: SafeUserDto | null
): string {
  if (user) return `user:${user.id}`;
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";
  return `guest:${ip}`;
}

function checkRateLimit(options: {
  db: AppDatabase;
  buckets: Map<string, RateBucket>;
  actorKey: string;
  user: SafeUserDto | null;
}): { allowed: true; actorKey: string } | {
  allowed: false;
  actorKey: string;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const limit = options.user
    ? getNumberSetting(options.db, SETTING_KEYS.userRateLimitPerHour, 120)
    : getNumberSetting(options.db, SETTING_KEYS.guestRateLimitPerHour, 30);
  const bucket = options.buckets.get(options.actorKey);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    options.buckets.set(options.actorKey, { windowStart: now, count: 1 });
    return { allowed: true, actorKey: options.actorKey };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      actorKey: options.actorKey,
      retryAfterSeconds: Math.ceil((bucket.windowStart + windowMs - now) / 1000)
    };
  }

  bucket.count += 1;
  return { allowed: true, actorKey: options.actorKey };
}
