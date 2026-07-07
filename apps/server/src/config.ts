export type RuntimeConfig = {
  databaseUrl: string;
  sessionSecret: string;
  adminEmail?: string;
  adminPassword?: string;
  whatslinkBaseUrl: string;
  appOrigin: string;
  port: number;
  screenshotsEnabledDefault: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    databaseUrl: env.DATABASE_URL ?? "file:./data/app.db",
    sessionSecret: env.SESSION_SECRET ?? "development-session-secret",
    adminEmail: env.ADMIN_EMAIL,
    adminPassword: env.ADMIN_PASSWORD,
    whatslinkBaseUrl: env.WHATSLINK_BASE_URL ?? "https://whatslink.info",
    appOrigin: env.APP_ORIGIN ?? "http://localhost:3000",
    port: Number.parseInt(env.PORT ?? "3000", 10),
    screenshotsEnabledDefault: env.SCREENSHOTS_ENABLED !== "false"
  };
}
