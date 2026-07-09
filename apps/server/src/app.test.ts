import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { createDatabase, ensureSchema } from "./db";
import type { WhatslinkClient } from "./whatslink";

const magnet =
  "magnet:?xt=urn:btih:7c1da06ef6898eaf9cabf879e44450417f5ae63f&dn=ROYD-327-C";

describe("app API", () => {
  let sqlite: Database.Database;
  let client: Pick<WhatslinkClient, "resolve" | "healthcheck">;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    const db = createDatabase(sqlite);
    ensureSchema(sqlite);
    client = {
      resolve: vi.fn(async () => ({
        status: "ok",
        type: "FOLDER",
        fileType: "folder",
        name: "ROYD-327-C",
        size: 6321789982,
        count: 5,
        screenshots: [{ time: 0, screenshot: "https://whatslink.info/image/a" }]
      })),
      healthcheck: vi.fn(async () => ({ ok: true, latencyMs: 20 }))
    };
    app = createApp({
      db,
      sqlite,
      whatslink: client,
      config: {
        appOrigin: "http://localhost:3000",
        sessionSecret: "test-secret",
        screenshotsEnabledDefault: true
      }
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  let app: ReturnType<typeof createApp>;

  it("lets guests resolve a magnet and caches the result", async () => {
    const first = await app.request("/api/magnets/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ magnet })
    });
    const second = await app.request("/api/magnets/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ magnet })
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      source: "cache",
      data: { infoHash: "7c1da06ef6898eaf9cabf879e44450417f5ae63f" }
    });
    expect(client.resolve).toHaveBeenCalledTimes(1);
  });

  it("blocks user and admin endpoints for guests", async () => {
    expect((await app.request("/api/me/history")).status).toBe(401);
    expect((await app.request("/api/admin/stats")).status).toBe(401);
  });

  it("proxies preview images through the fixed upstream host", async () => {
    const db = createDatabase(sqlite);
    app = createApp({
      db,
      sqlite,
      whatslink: client,
      previewFetch: vi.fn(async () =>
        new Response("image-bytes", {
          headers: { "content-type": "image/jpeg" }
        })
      ),
      config: {
        appOrigin: "http://localhost:3000",
        sessionSecret: "test-secret",
        screenshotsEnabledDefault: true,
        whatslinkBaseUrl: "https://whatslink.test"
      }
    });

    const response = await app.request("/api/previews/abc123def456");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(await response.text()).toBe("image-bytes");
  });

  it("allows registered users to keep history and favorites", async () => {
    const register = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", password: "password123" })
    });
    const cookie = register.headers.get("set-cookie") ?? "";

    await app.request("/api/magnets/resolve", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ magnet })
    });
    await app.request(
      "/api/me/favorites/7c1da06ef6898eaf9cabf879e44450417f5ae63f",
      { method: "POST", headers: { cookie } }
    );

    const history = await app.request("/api/me/history", {
      headers: { cookie }
    });
    const favorites = await app.request("/api/me/favorites", {
      headers: { cookie }
    });

    expect(history.status).toBe(200);
    expect((await history.json()).items).toHaveLength(1);
    expect((await favorites.json()).items).toHaveLength(1);
  });

  it("accepts feedback votes and ranks magnets on the leaderboard", async () => {
    const hash = "7c1da06ef6898eaf9cabf879e44450417f5ae63f";

    await app.request("/api/magnets/resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "1.1.1.1"
      },
      body: JSON.stringify({ magnet })
    });

    const up = await app.request(`/api/magnets/${hash}/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "1.1.1.1"
      },
      body: JSON.stringify({ vote: "up" })
    });
    expect(up.status).toBe(200);
    expect(await up.json()).toMatchObject({
      data: { infoHash: hash, score: 1, myVote: 1 }
    });

    const downFromOther = await app.request(`/api/magnets/${hash}/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "2.2.2.2"
      },
      body: JSON.stringify({ vote: "down" })
    });
    expect(downFromOther.status).toBe(200);
    expect(await downFromOther.json()).toMatchObject({
      data: { infoHash: hash, score: 0, myVote: -1 }
    });

    const guestBoard = await app.request("/api/leaderboard");
    expect(guestBoard.status).toBe(200);
    const guestJson = await guestBoard.json();
    expect(guestJson).toMatchObject({
      linksVisible: false,
      items: [{ score: 0, voteCount: 2 }]
    });
    expect(guestJson.items[0].infoHash).not.toBe(hash);
    expect(guestJson.items[0].magnetLink).toBeUndefined();

    const register = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "board@example.com", password: "password123" })
    });
    const cookie = register.headers.get("set-cookie") ?? "";
    const authedBoard = await app.request("/api/leaderboard", {
      headers: { cookie }
    });
    expect(authedBoard.status).toBe(200);
    const authedJson = await authedBoard.json();
    expect(authedJson).toMatchObject({
      linksVisible: true,
      items: [
        {
          infoHash: hash,
          score: 0,
          voteCount: 2,
          magnetLink: `magnet:?xt=urn:btih:${hash}&dn=ROYD-327-C`
        }
      ]
    });

    // Param route must not swallow the leaderboard endpoint.
    const legacyCollision = await app.request("/api/magnets/leaderboard");
    expect(legacyCollision.status).toBe(400);
    expect(await legacyCollision.json()).toMatchObject({ error: "HASH_INVALID" });

    // Same actor clicking the same vote again cancels it.
    const cancel = await app.request(`/api/magnets/${hash}/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "1.1.1.1"
      },
      body: JSON.stringify({ vote: "up" })
    });
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toMatchObject({
      data: { score: -1, myVote: null }
    });
  });
});
