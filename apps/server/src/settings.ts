import { eq } from "drizzle-orm";
import type { AppDatabase } from "./db";
import { settings } from "./db/schema";

export const SETTING_KEYS = {
  screenshotsEnabled: "screenshots_enabled",
  guestRateLimitPerHour: "guest_rate_limit_per_hour",
  userRateLimitPerHour: "user_rate_limit_per_hour"
} as const;

export function seedDefaultSettings(
  db: AppDatabase,
  screenshotsEnabledDefault: boolean
): void {
  const now = Date.now();
  const defaults = [
    [SETTING_KEYS.screenshotsEnabled, String(screenshotsEnabledDefault)],
    [SETTING_KEYS.guestRateLimitPerHour, "30"],
    [SETTING_KEYS.userRateLimitPerHour, "120"]
  ] as const;

  for (const [key, value] of defaults) {
    db.insert(settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoNothing()
      .run();
  }
}

export function getBooleanSetting(
  db: AppDatabase,
  key: string,
  fallback: boolean
): boolean {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  return row.value === "true";
}

export function getNumberSetting(
  db: AppDatabase,
  key: string,
  fallback: number
): number {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  const value = Number.parseInt(row.value, 10);
  return Number.isFinite(value) ? value : fallback;
}

export function setSetting(db: AppDatabase, key: string, value: string): void {
  db.insert(settings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: Date.now() }
    })
    .run();
}

export function readPublicSettings(db: AppDatabase) {
  return {
    screenshotsEnabled: getBooleanSetting(
      db,
      SETTING_KEYS.screenshotsEnabled,
      true
    ),
    guestRateLimitPerHour: getNumberSetting(
      db,
      SETTING_KEYS.guestRateLimitPerHour,
      30
    ),
    userRateLimitPerHour: getNumberSetting(
      db,
      SETTING_KEYS.userRateLimitPerHour,
      120
    )
  };
}
