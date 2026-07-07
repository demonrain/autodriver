import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type AppDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(sqlite: Database.Database) {
  return drizzle(sqlite, { schema });
}

export function openSqliteFromUrl(databaseUrl: string): Database.Database {
  const filename = databaseUrl.startsWith("file:")
    ? databaseUrl.slice("file:".length)
    : databaseUrl;

  const resolved = filename === ":memory:" ? filename : resolve(filename);
  if (resolved !== ":memory:") {
    mkdirSync(dirname(resolved), { recursive: true });
  }

  const sqlite = new Database(resolved);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

export function ensureSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS magnet_metadata (
      info_hash TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('ok', 'unknown', 'error')),
      type TEXT NOT NULL DEFAULT '',
      file_type TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      count INTEGER NOT NULL DEFAULT 0,
      screenshots_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      fetched_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_magnet_metadata_expires_at
      ON magnet_metadata(expires_at);

    CREATE TABLE IF NOT EXISTS query_events (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_key TEXT NOT NULL,
      info_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ok', 'unknown', 'error')),
      source TEXT NOT NULL CHECK (source IN ('cache', 'upstream', 'error')),
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_query_events_user_created
      ON query_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_query_events_created_at
      ON query_events(created_at DESC);

    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      info_hash TEXT NOT NULL REFERENCES magnet_metadata(info_hash) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, info_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_favorites_user_created
      ON favorites(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
