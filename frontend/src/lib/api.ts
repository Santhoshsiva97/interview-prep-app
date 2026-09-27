// In dev, Vite proxies /api to the backend (see vite.config.ts), so the
// default same-origin base works both locally and in Docker.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** Machine-readable error code from the API (e.g. `EMAIL_NOT_VERIFIED`). */
  readonly code?: string;

  constructor(status: number, body: unknown) {
    super(messageFromBody(body) ?? `Request failed (${status})`);
    this.status = status;
    this.body = body;
    if (isRecord(body) && typeof body.code === 'string') this.code = body.code;
  }

  /** Reads an extra field from the error body, e.g. `retryAfterSeconds`. */
  detail<T>(key: string): T | undefined {
    return isRecord(this.body) ? (this.body[key] as T) : undefined;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

function messageFromBody(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const { message } = body;
  if (Array.isArray(message)) return message.join('. ');
  return typeof message === 'string' ? message : undefined;
}

/** User-facing message for any thrown value. */
export const errorMessage = (err: unknown) =>
  err instanceof Error
    ? err.message
    : 'Something went wrong. Please try again.';

// ── Access token (kept in memory only; the refresh token is an HttpOnly cookie) ──

let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;
let refreshInFlight: Promise<unknown> | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

/** Called when a refresh fails mid-session (AuthProvider clears the user). */
export const setSessionExpiredHandler = (handler: (() => void) | null) => {
  onSessionExpired = handler;
};

/**
 * Exchanges the refresh cookie for a new access token. Single-flight: the
 * server rotates the cookie on every call, so parallel refreshes must share
 * one request.
 */
export function refreshAccessToken<
  T extends { accessToken: string },
>(): Promise<T | null> {
  refreshInFlight ??= request<T>('/auth/refresh', { method: 'POST' })
    .then(
      (session) => {
        accessToken = session.accessToken;
        return session;
      },
      () => {
        accessToken = null;
        return null;
      },
    )
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight as Promise<T | null>;
}

const UNREACHABLE_MESSAGE =
  'Can’t reach the server. Check your connection, or that the API is running, and try again.';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        // Let the browser set the multipart boundary for FormData bodies.
        ...(!(init?.body instanceof FormData) && {
          'Content-Type': 'application/json',
        }),
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        ...init?.headers,
      },
    });
  } catch {
    // fetch only rejects on network failure (server down, offline, CORS).
    throw new ApiError(0, { message: UNREACHABLE_MESSAGE });
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    // A 5xx with no JSON body comes from the dev proxy/gateway, not the API.
    throw new ApiError(
      res.status,
      body ?? (res.status >= 500 ? { message: UNREACHABLE_MESSAGE } : null),
    );
  }
  return body as T;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const hadToken = accessToken !== null;
  try {
    return await request<T>(path, init);
  } catch (err) {
    // Expired access token: refresh once and retry.
    if (err instanceof ApiError && err.status === 401 && hadToken) {
      if (await refreshAccessToken()) return request<T>(path, init);
      onSessionExpired?.();
    }
    throw err;
  }
}

/** GET returning text (e.g. an HTML email preview), with the same auth/refresh handling. */
export async function apiFetchText(path: string): Promise<string> {
  const load = () =>
    fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
  let res = await load().catch(() => {
    throw new ApiError(0, { message: UNREACHABLE_MESSAGE });
  });
  if (res.status === 401 && accessToken && (await refreshAccessToken())) {
    res = await load();
  }
  if (!res.ok)
    throw new ApiError(res.status, await res.json().catch(() => null));
  return res.text();
}

const withBody =
  (method: string) =>
  <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method,
      body:
        body === undefined || body instanceof FormData
          ? body
          : JSON.stringify(body),
    });

/** JSON (or FormData) request helpers. */
export const apiPost = withBody('POST');
export const apiPut = withBody('PUT');
export const apiPatch = withBody('PATCH');
export const apiDelete = withBody('DELETE');
