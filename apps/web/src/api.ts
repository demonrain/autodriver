import type { MagnetMetadataDto, SafeUserDto } from "../../../packages/shared/src";

type ApiOptions = {
  method?: string;
  body?: unknown;
};

async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const url =
    typeof window === "undefined"
      ? `http://localhost:3000${path}`
      : new URL(path, window.location.origin).toString();
  const response = await fetch(url, {
    method: options.method ?? "GET",
    credentials: "include",
    headers:
      options.body === undefined
        ? undefined
        : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error ?? "REQUEST_FAILED", response.status, data);
  }
  return data as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown
  ) {
    super(message);
  }
}

export const api = {
  session: () => apiFetch<{ user: SafeUserDto | null }>("/api/auth/session"),
  register: (email: string, password: string) =>
    apiFetch<{ user: SafeUserDto }>("/api/auth/register", {
      method: "POST",
      body: { email, password }
    }),
  login: (email: string, password: string) =>
    apiFetch<{ user: SafeUserDto }>("/api/auth/login", {
      method: "POST",
      body: { email, password }
    }),
  logout: () => apiFetch<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  resolveMagnet: (magnet: string) =>
    apiFetch<{ source: "cache" | "upstream"; data: MagnetMetadataDto }>(
      "/api/magnets/resolve",
      { method: "POST", body: { magnet } }
    ),
  history: () =>
    apiFetch<{
      items: Array<{ queriedAt: number; source: string; data: MagnetMetadataDto }>;
    }>("/api/me/history"),
  favorites: () =>
    apiFetch<{
      items: Array<{ favoritedAt: number; data: MagnetMetadataDto }>;
    }>("/api/me/favorites"),
  addFavorite: (hash: string) =>
    apiFetch<{ ok: true }>(`/api/me/favorites/${hash}`, { method: "POST" }),
  removeFavorite: (hash: string) =>
    apiFetch<{ ok: true }>(`/api/me/favorites/${hash}`, { method: "DELETE" }),
  adminStats: () =>
    apiFetch<{
      stats: Record<string, number>;
      settings: {
        screenshotsEnabled: boolean;
        guestRateLimitPerHour: number;
        userRateLimitPerHour: number;
      };
    }>("/api/admin/stats"),
  adminUsers: () => apiFetch<{ items: SafeUserDto[] }>("/api/admin/users"),
  adminQueries: () => apiFetch<{ items: Array<Record<string, unknown>> }>(
    "/api/admin/queries"
  ),
  adminHealth: () =>
    apiFetch<{ whatslink: { ok: boolean; latencyMs: number; error?: string } }>(
      "/api/admin/health"
    ),
  updateSettings: (settings: {
    screenshotsEnabled?: boolean;
    guestRateLimitPerHour?: number;
    userRateLimitPerHour?: number;
  }) =>
    apiFetch<{ settings: {
      screenshotsEnabled: boolean;
      guestRateLimitPerHour: number;
      userRateLimitPerHour: number;
    } }>("/api/admin/settings", { method: "PATCH", body: settings })
};
