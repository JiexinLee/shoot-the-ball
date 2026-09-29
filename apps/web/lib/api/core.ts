// ==========================================================================
// lib/api/core.ts
//   基础能力：baseUrl 配置、鉴权 token、统一 ApiError 类、fetch request wrapper (http.get/post/patch/delete)
//   其他 domain 文件（videos/jobs/...）只依赖本文件，不互相 import，保证单向依赖好维护。
// ==========================================================================

export const DEFAULT_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (typeof window === "undefined"
    ? process.env.API_PROXY_TARGET ?? "http://localhost:4321/v1"
    : "/api/v1");

const TOKEN_STORAGE_KEY = "stb_auth_token";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token === null) {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } else {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export type RequestOptions = {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const url = new URL(
    DEFAULT_BASE_URL.startsWith("/")
      ? (typeof window === "undefined"
          ? `http://127.0.0.1${DEFAULT_BASE_URL}${path}`
          : `${DEFAULT_BASE_URL}${path}`)
      : `${DEFAULT_BASE_URL}${path}`,
    typeof window === "undefined" ? "http://127.0.0.1" : window.location.origin,
  );
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers ?? {}),
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  let payload: unknown = null;
  try {
    payload = res.headers.get("Content-Type")?.includes("application/json")
      ? await res.json()
      : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const msg =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `HTTP ${res.status}`;
    const details =
      payload && typeof payload === "object" && "details" in payload
        ? (payload as { details: unknown }).details
        : undefined;
    throw new ApiError(res.status, msg, details);
  }

  return payload as T;
}

export const http = {
  get: <T>(path: string, opts?: RequestOptions) =>
    request<T>("GET", path, opts),
  post: <T>(path: string, opts?: RequestOptions) =>
    request<T>("POST", path, opts),
  patch: <T>(path: string, opts?: RequestOptions) =>
    request<T>("PATCH", path, opts),
  delete: <T>(path: string, opts?: RequestOptions) =>
    request<T>("DELETE", path, opts),
};

export type HealthResponse = {
  status: string;
  service: string;
  ts: number;
};

export const health = {
  check: () => http.get<HealthResponse>("/health"),
};
