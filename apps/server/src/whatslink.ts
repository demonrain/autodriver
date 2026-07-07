import type {
  MagnetStatus,
  ScreenshotPreview
} from "../../../packages/shared/src";

export type NormalizedWhatslinkResponse = {
  status: MagnetStatus;
  type: string;
  fileType: string;
  name: string;
  size: number;
  count: number;
  screenshots: ScreenshotPreview[];
  error?: string;
};

type WhatslinkRawResponse = {
  error?: unknown;
  type?: unknown;
  file_type?: unknown;
  name?: unknown;
  size?: unknown;
  count?: unknown;
  screenshots?: unknown;
};

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export class WhatslinkClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, fetchImpl: FetchLike = fetch, timeoutMs = 8000) {
    this.baseUrl = sanitizeWhatslinkBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async resolve(magnet: string): Promise<NormalizedWhatslinkResponse> {
    const endpoint = new URL("/api/v1/link", this.baseUrl);
    endpoint.searchParams.set("url", magnet);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(endpoint, {
        headers: {
          accept: "application/json",
          referer: `${this.baseUrl.origin}/`
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`WHATSLINK_HTTP_${response.status}`);
      }

      return normalizeWhatslinkResponse(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }

  async healthcheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      await this.resolve("not-a-magnet");
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : "WHATSLINK_ERROR"
      };
    }
  }
}

export function sanitizeWhatslinkBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("WHATSLINK_BASE_URL_INVALID");
  }
  return url;
}

export function normalizeWhatslinkResponse(
  raw: WhatslinkRawResponse
): NormalizedWhatslinkResponse {
  const type = typeof raw.type === "string" ? raw.type : "UNKNOWN";
  const error = typeof raw.error === "string" ? raw.error : "";
  const status: MagnetStatus =
    error.length > 0 ? "error" : type === "UNKNOWN" ? "unknown" : "ok";

  return {
    status,
    type,
    fileType: typeof raw.file_type === "string" ? raw.file_type : "",
    name: typeof raw.name === "string" ? raw.name : "",
    size: asNonNegativeNumber(raw.size),
    count: asNonNegativeNumber(raw.count),
    screenshots: normalizeScreenshots(raw.screenshots),
    error: error || undefined
  };
}

export function getCacheTtlMs(status: MagnetStatus): number {
  if (status === "ok") return 7 * 24 * 60 * 60 * 1000;
  if (status === "unknown") return 60 * 60 * 1000;
  return 10 * 60 * 1000;
}

function normalizeScreenshots(value: unknown): ScreenshotPreview[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const screenshot = Reflect.get(item, "screenshot");
    const time = Reflect.get(item, "time");
    if (typeof screenshot !== "string" || !isHttpUrl(screenshot)) return [];
    return [
      {
        screenshot,
        time: typeof time === "number" && Number.isFinite(time) ? time : 0
      }
    ];
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function asNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
