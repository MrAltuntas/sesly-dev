/**
 * ApiError - the single error type thrown by ApiClient.
 *
 * Backend error envelope (HttpExceptionFilter + errorWrapper):
 *   { success: false, statusCode, message, path, method, timestamp, ...extra }
 * where `extra` may carry `code`, `existingNarrationId`, `status`, etc.
 *
 * `message` on this class is always user-facing text: in a Turkish UI the
 * backend message when the server sent one (the backend writes literal
 * Turkish sentences), otherwise a status-based fallback in the UI language.
 * Callers should branch on `status` / `code`, never on the message text.
 */

import { ERROR_MESSAGES } from '../config/constants';
import i18n from '../i18n';
import { msg } from '../i18n/messages';

export const API_ERROR_CODES = {
  NETWORK: 'NETWORK_ERROR',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  UNKNOWN: 'UNKNOWN_ERROR',
} as const;

/** Resolved when it is shown, so it follows the UI language. */
export function maintenanceFallbackMessage(): string {
  return msg('api.maintenance');
}

export interface ApiErrorInit {
  message: string;
  /** HTTP status. 0 when the request never got a response (network/timeout). */
  status: number;
  code?: string | null;
  data?: Record<string, unknown> | null;
  method?: string;
  path?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly data: Record<string, unknown> | null;
  readonly method?: string;
  readonly path?: string;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code ?? null;
    this.data = init.data ?? null;
    this.method = init.method;
    this.path = init.path;
    // Keep `instanceof` working when TS targets ES5-style class transpiles.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }

  get isMaintenance(): boolean {
    return this.status === 503;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** True when `error` is an ApiError with the given HTTP status. */
export function hasApiStatus(error: unknown, status: number): boolean {
  return isApiError(error) && error.status === status;
}

function pickBackendMessage(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const raw = body.message;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    const first = raw.find(m => typeof m === 'string' && m.trim());
    if (typeof first === 'string') return first.trim();
  }
  return null;
}

/**
 * The backend's messages are Turkish sentences (its exception filter only
 * translates key-shaped messages and none exist), so another UI language
 * shows the status fallback instead.
 */
function backendSentencesMatchUi(): boolean {
  const language = i18n.language || 'tr';
  return language === 'tr' || language.startsWith('tr-');
}

export function fallbackMessageForStatus(status: number): string {
  switch (status) {
    case 400:
      return msg('api.badRequest');
    case 401:
      return ERROR_MESSAGES.SESSION_EXPIRED;
    case 403:
      return msg('api.forbidden');
    case 404:
      return msg('api.notFound');
    case 409:
      return msg('api.conflict');
    case 413:
      return ERROR_MESSAGES.FILE_TOO_LARGE;
    case 429:
      return msg('api.tooMany');
    case 503:
      return maintenanceFallbackMessage();
    default:
      if (status >= 500) return ERROR_MESSAGES.SERVER;
      return ERROR_MESSAGES.UNKNOWN;
  }
}

/**
 * Pure mapper from (status, response body) to ApiError. `status` undefined
 * means there was no response at all (offline, DNS, timeout).
 */
export function apiErrorFromResponse(
  status: number | undefined,
  body: unknown,
  context?: { method?: string; path?: string },
): ApiError {
  if (status === undefined || status === null || status === 0) {
    return new ApiError({
      message: ERROR_MESSAGES.NETWORK,
      status: 0,
      code: API_ERROR_CODES.NETWORK,
      method: context?.method,
      path: context?.path,
    });
  }

  const data =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const backendMessage = pickBackendMessage(data);
  const code = data && typeof data.code === 'string' ? data.code : null;

  const turkishUi = backendSentencesMatchUi();
  let message: string;
  if (status === 503) {
    // Maintenance mode: the backend sends a Turkish explanation, show it in
    // a Turkish UI.
    message = (turkishUi ? backendMessage : null) ?? maintenanceFallbackMessage();
  } else if (status >= 500) {
    // Unhandled server errors carry an English "Internal server error"; never
    // surface that to the user.
    message = ERROR_MESSAGES.SERVER;
  } else {
    message = (turkishUi ? backendMessage : null) ?? fallbackMessageForStatus(status);
  }

  return new ApiError({
    message,
    status,
    code,
    data,
    method: context?.method,
    path: context?.path,
  });
}

// ============================================================================
// Failure classification
// ============================================================================

/**
 * What kind of failure a screen or store is looking at:
 * - offline      no connection (NetInfo says offline, or no response at all)
 * - maintenance  503
 * - server       5xx, 429, or a failure inside the app (parser, unknown)
 * - session      401 or SESSION_EXPIRED (handleSessionExpired takes over)
 * - client       any other 4xx
 *
 * Signed out is never inferred from a failure; it is the restore outcome or a
 * `session` failure that went through the session-expired flow.
 */
export type FailureKind = 'offline' | 'maintenance' | 'server' | 'session' | 'client';

export function classifyFailure(
  error: unknown,
  connectivity?: { offline: boolean },
): FailureKind {
  if (connectivity?.offline) return 'offline';
  if (!isApiError(error)) return 'server';
  if (error.code === API_ERROR_CODES.SESSION_EXPIRED) return 'session';
  if (error.status === 0) {
    return error.code === API_ERROR_CODES.NETWORK ? 'offline' : 'server';
  }
  if (error.status === 503) return 'maintenance';
  if (error.status === 401) return 'session';
  if (error.status >= 500 || error.status === 429) return 'server';
  return 'client';
}

/**
 * User-facing message for any thrown value.
 *
 * - ApiError: its message (already in the UI language, see apiErrorFromResponse).
 * - Anything else: `fallback` when given (internal errors such as parser
 *   failures carry English developer text that must not reach the UI),
 *   otherwise the error's own message with any "Error: " prefix stripped.
 */
export function getErrorMessage(error: unknown, fallback?: string): string {
  if (isApiError(error)) return error.message;
  if (fallback) return fallback;
  if (error instanceof Error && error.message) {
    const msg = error.message.replace(/^Error:\s*/i, '').trim();
    if (msg) return msg;
  }
  if (typeof error === 'string' && error.trim()) {
    return error.replace(/^Error:\s*/i, '').trim();
  }
  return ERROR_MESSAGES.UNKNOWN;
}
