import { z } from "zod";

export const magnetResolveRequestSchema = z.object({
  magnet: z.string().min(12).max(4096)
});

export const authRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256)
});

export const adminSettingsPatchSchema = z.object({
  screenshotsEnabled: z.boolean().optional(),
  guestRateLimitPerHour: z.number().int().min(1).max(10000).optional(),
  userRateLimitPerHour: z.number().int().min(1).max(50000).optional()
});

export type MagnetStatus = "ok" | "unknown" | "error";

export type ScreenshotPreview = {
  time: number;
  screenshot: string;
};

export type MagnetMetadataDto = {
  infoHash: string;
  status: MagnetStatus;
  type: string;
  fileType: string;
  name: string;
  size: number;
  count: number;
  screenshots: ScreenshotPreview[];
  fetchedAt: number;
  expiresAt: number;
  isFavorite?: boolean;
};

export type SafeUserDto = {
  id: string;
  email: string;
  role: "user" | "admin";
  createdAt: number;
};
