import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp, seedAdminUser } from "./app";
import { loadConfig } from "./config";
import { createDatabase, ensureSchema, openSqliteFromUrl } from "./db";
import { WhatslinkClient } from "./whatslink";

const config = loadConfig();
const sqlite = openSqliteFromUrl(config.databaseUrl);
ensureSchema(sqlite);
const db = createDatabase(sqlite);
await seedAdminUser(db, config.adminEmail, config.adminPassword);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const staticRoot = resolve(repoRoot, "apps/web/dist");
const app = createApp({
  db,
  sqlite,
  whatslink: new WhatslinkClient(config.whatslinkBaseUrl),
  config: {
    appOrigin: config.appOrigin,
    sessionSecret: config.sessionSecret,
    screenshotsEnabledDefault: config.screenshotsEnabledDefault,
    whatslinkBaseUrl: config.whatslinkBaseUrl,
    staticRoot: existsSync(staticRoot) ? staticRoot : undefined
  }
});

serve(
  {
    fetch: app.fetch,
    port: config.port
  },
  (info) => {
    console.log(`Server listening on http://localhost:${info.port}`);
  }
);
