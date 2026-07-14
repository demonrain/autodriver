import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  sqliteTable,
  text
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  createdAt: integer("created_at").notNull()
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull()
});

export const magnetMetadata = sqliteTable("magnet_metadata", {
  infoHash: text("info_hash").primaryKey(),
  status: text("status", { enum: ["ok", "unknown", "error"] }).notNull(),
  type: text("type").notNull().default(""),
  fileType: text("file_type").notNull().default(""),
  name: text("name").notNull().default(""),
  size: integer("size").notNull().default(0),
  count: integer("count").notNull().default(0),
  screenshotsJson: text("screenshots_json").notNull().default("[]"),
  error: text("error"),
  fetchedAt: integer("fetched_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const queryEvents = sqliteTable("query_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  actorKey: text("actor_key").notNull(),
  infoHash: text("info_hash").notNull(),
  status: text("status", { enum: ["ok", "unknown", "error"] }).notNull(),
  source: text("source", { enum: ["cache", "upstream", "error"] }).notNull(),
  createdAt: integer("created_at").notNull()
});

export const favorites = sqliteTable(
  "favorites",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    infoHash: text("info_hash")
      .notNull()
      .references(() => magnetMetadata.infoHash, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.infoHash] })
  })
);

export const magnetVotes = sqliteTable(
  "magnet_votes",
  {
    infoHash: text("info_hash")
      .notNull()
      .references(() => magnetMetadata.infoHash, { onDelete: "cascade" }),
    actorKey: text("actor_key").notNull(),
    vote: integer("vote").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.infoHash, table.actorKey] })
  })
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const suggestions = sqliteTable("suggestions", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  actorKey: text("actor_key").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull()
});

export type UserRecord = typeof users.$inferSelect;
export type MagnetMetadataRecord = typeof magnetMetadata.$inferSelect;
export type MagnetVoteRecord = typeof magnetVotes.$inferSelect;
