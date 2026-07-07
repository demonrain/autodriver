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
});
