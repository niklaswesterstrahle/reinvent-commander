// @reinvent-commander/backend — upstream error mapping
//
// Maps AWS Events REST API status codes / bodies to the shared normalized
// `ApiError` envelope the SPA renders uniformly (design: Error Handling).
// Phase 1 is anonymous catalog browsing only, so the 401 refresh-and-retry
// path (Phase 2 auth) is intentionally not handled here.

import type { ApiError } from '@reinvent-commander/shared';

/** Default wait, in seconds, when a 429 omits or malforms `Retry-After`. */
export const DEFAULT_RETRY_AFTER_SECONDS = 5;

/** Maximum number of retries for a throttled (429) request. */
export const MAX_THROTTLE_RETRIES = 3;

/**
 * Shape the upstream surfaces on error. The AWS Events API returns a JSON body
 * with a `message` (and sometimes a `code`/`__type`); every field is optional
 * and untrusted, so each is read defensively.
 */
interface UpstreamErrorBody {
  message?: unknown;
  code?: unknown;
  __type?: unknown;
  conflictsWith?: unknown;
}

/** The default `code` surfaced for each documented status. */
const CODE_BY_STATUS: Record<number, string> = {
  400: 'ValidationException',
  401: 'AuthenticationRequiredException',
  403: 'EventAuthRequiredException',
  404: 'NotFoundException',
  429: 'ThrottlingException',
  500: 'EventsServiceException',
  503: 'EventsUnavailableException',
};

/** A human-readable fallback message for each documented status. */
const MESSAGE_BY_STATUS: Record<number, string> = {
  400: 'The request was not valid.',
  401: 'Your session has expired. Sign in again to continue.',
  403: 'This event requires registration. Sign in with a registered account to view its sessions.',
  404: 'The requested resource was not found.',
  429: 'The service is throttling requests. Please retry shortly.',
  500: 'The events service encountered an error. Please try again.',
  503: 'The events service is temporarily unavailable. Please try again.',
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string');
  return out.length > 0 ? out : undefined;
}

/**
 * Parse a `Retry-After` header value. The Events API uses delay-seconds; an
 * absent, non-numeric, or negative value falls back to the default.
 */
export function parseRetryAfterSeconds(headerValue: string | null | undefined): number {
  if (headerValue == null) return DEFAULT_RETRY_AFTER_SECONDS;
  const trimmed = headerValue.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_RETRY_AFTER_SECONDS;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RETRY_AFTER_SECONDS;
}

/**
 * Build a normalized {@link ApiError} from an upstream status, optional parsed
 * body, and (for 429) a `Retry-After` header. Unknown statuses collapse to a
 * generic upstream-error envelope that preserves the real status code.
 */
export function mapUpstreamError(
  status: number,
  body?: UpstreamErrorBody | null,
  retryAfterHeader?: string | null,
): ApiError {
  const code =
    asString(body?.code) ?? asString(body?.__type) ?? CODE_BY_STATUS[status] ?? 'UpstreamError';
  const message =
    asString(body?.message) ??
    MESSAGE_BY_STATUS[status] ??
    'The events service returned an unexpected response.';

  const error: ApiError = { status, code, message };

  const conflictsWith = asStringArray(body?.conflictsWith);
  if (conflictsWith) error.conflictsWith = conflictsWith;

  if (status === 429) {
    error.retryAfterSeconds = parseRetryAfterSeconds(retryAfterHeader);
  }

  return error;
}

/** A thrown {@link ApiError}. Lets async handlers reject with a mapped envelope. */
export class UpstreamApiError extends Error {
  readonly apiError: ApiError;

  constructor(apiError: ApiError) {
    super(apiError.message);
    this.name = 'UpstreamApiError';
    this.apiError = apiError;
  }
}

/** Normalized envelope for a transport-level failure (no HTTP response). */
export function transportError(message = 'The request could not be completed.'): ApiError {
  return { status: 502, code: 'UpstreamUnreachable', message };
}
