import type {
  LeaderboardItemDto,
  MagnetMetadataDto,
  SafeUserDto,
  SuggestionDto
} from "../../../packages/shared/src";

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

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const data = isJson
    ? await response.json().catch(() => ({} as Record<string, unknown>))
    : ({} as Record<string, unknown>);

  // SPA fallback can return HTML 200 for unknown /api routes on old servers.
  if (!isJson) {
    throw new ApiError(
      response.ok ? "API_UNAVAILABLE" : "REQUEST_FAILED",
      response.ok ? 502 : response.status,
      data
    );
  }

  if (!response.ok) {
    throw new ApiError(
      typeof data === "object" && data && "error" in data
        ? String((data as { error?: unknown }).error ?? "REQUEST_FAILED")
        : "REQUEST_FAILED",
      response.status,
      data
    );
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
  health: () =>
    apiFetch<{
      ok: boolean;
      settings: {
        screenshotsEnabled: boolean;
        guestRateLimitPerHour: number;
        userRateLimitPerHour: number;
      };
    }>("/api/health"),
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
    apiFetch<{
      source: "cache" | "upstream";
      screenshotsEnabled: boolean;
      data: MagnetMetadataDto;
    }>("/api/magnets/resolve", { method: "POST", body: { magnet } }),
  submitFeedback: (hash: string, vote: "up" | "down") =>
    apiFetch<{ data: MagnetMetadataDto }>(`/api/magnets/${hash}/feedback`, {
      method: "POST",
      body: { vote }
    }),
  leaderboard: (limit = 20) =>
    apiFetch<{ items: LeaderboardItemDto[]; linksVisible: boolean }>(
      `/api/leaderboard?limit=${limit}`
    ),
  history: () =>
    apiFetch<{
      items: Array<{
        queriedAt: number;
        source: string;
        magnetLink: string;
        data: MagnetMetadataDto;
      }>;
    }>("/api/me/history"),
  favorites: () =>
    apiFetch<{
      items: Array<{ favoritedAt: number; data: MagnetMetadataDto }>;
    }>("/api/me/favorites"),
  addFavorite: (hash: string) =>
    apiFetch<{ ok: true }>(`/api/me/favorites/${hash}`, { method: "POST" }),
  removeFavorite: (hash: string) =>
    apiFetch<{ ok: true }>(`/api/me/favorites/${hash}`, { method: "DELETE" }),
  submitSuggestion: (content: string) =>
    apiFetch<{ item: SuggestionDto }>("/api/suggestions", {
      method: "POST",
      body: { content }
    }),
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
  adminQueries: () =>
    apiFetch<{
      items: Array<Record<string, unknown> & { magnetLink?: string }>;
    }>("/api/admin/queries"),
  adminSuggestions: () =>
    apiFetch<{ items: SuggestionDto[] }>("/api/admin/suggestions"),
  adminHealth: () =>
    apiFetch<{ whatslink: { ok: boolean; latencyMs: number; error?: string } }>(
      "/api/admin/health"
    ),
  updateSettings: (settings: {
    screenshotsEnabled?: boolean;
    guestRateLimitPerHour?: number;
    userRateLimitPerHour?: number;
  }) =>
    apiFetch<{
      settings: {
        screenshotsEnabled: boolean;
        guestRateLimitPerHour: number;
        userRateLimitPerHour: number;
      };
    }>("/api/admin/settings", { method: "PATCH", body: settings })
};
