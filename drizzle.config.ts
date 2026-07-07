import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL ?? "file:./data/app.db";

export default defineConfig({
  schema: "./apps/server/src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: databaseUrl.startsWith("file:")
      ? databaseUrl.slice("file:".length)
      : databaseUrl
  }
});
