import { buildMagnetLink, parseMagnetLink } from "../../../packages/shared/src";
import type { MagnetMetadataDto, MagnetStatus, ScreenshotPreview } from "../../../packages/shared/src";

const WHATSLINK_BASE_URL = "https://whatslink.info";

type WhatslinkRawResponse = {
  error?: unknown;
  type?: unknown;
  file_type?: unknown;
  name?: unknown;
  size?: unknown;
  count?: unknown;
  screenshots?: unknown;
};

function normalizeScreenshots(value: unknown): ScreenshotPreview[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const screenshot = Reflect.get(item, "screenshot");
    const time = Reflect.get(item, "time");
    if (typeof screenshot !== "string") return [];
    try {
      const url = new URL(screenshot);
      if (url.protocol !== "http:" && url.protocol !== "https:") return [];
    } catch {
      return [];
    }
    return [
      {
        screenshot,
        time: typeof time === "number" && Number.isFinite(time) ? time : 0
      }
    ];
  });
}

function normalizeWhatslinkResponse(
  raw: WhatslinkRawResponse,
  infoHash: string,
  fallbackName?: string
): MagnetMetadataDto {
  const type = typeof raw.type === "string" ? raw.type : "UNKNOWN";
  const error = typeof raw.error === "string" ? raw.error : "";
  const status: MagnetStatus =
    error.length > 0 ? "error" : type === "UNKNOWN" ? "unknown" : "ok";
  const now = Date.now();

  return {
    infoHash,
    status,
    type,
    fileType: typeof raw.file_type === "string" ? raw.file_type : "",
    name:
      typeof raw.name === "string" && raw.name.length > 0
        ? raw.name
        : fallbackName ?? "",
    size:
      typeof raw.size === "number" && Number.isFinite(raw.size) && raw.size > 0
        ? raw.size
        : 0,
    count:
      typeof raw.count === "number" &&
      Number.isFinite(raw.count) &&
      raw.count > 0
        ? raw.count
        : 0,
    screenshots: normalizeScreenshots(raw.screenshots),
    fetchedAt: now,
    expiresAt: now + (status === "ok" ? 7 * 24 * 60 * 60 * 1000 : 10 * 60 * 1000)
  };
}

export async function resolveMagnetFromBrowser(
  magnet: string
): Promise<MagnetMetadataDto> {
  const parsed = parseMagnetLink(magnet);
  const magnetUri = buildMagnetLink(parsed.infoHash, parsed.displayName);
  const endpoint = new URL("/api/v1/link", WHATSLINK_BASE_URL);
  endpoint.searchParams.set("url", magnetUri);

  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
      referer: `${WHATSLINK_BASE_URL}/`
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error("WHATSLINK_UNAVAILABLE");
  }

  return normalizeWhatslinkResponse(
    (await response.json()) as WhatslinkRawResponse,
    parsed.infoHash,
    parsed.displayName
  );
}
