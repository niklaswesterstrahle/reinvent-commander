// @reinvent-commander/backend — query-parameter validation
//
// Validates and normalizes the only query params the Phase 1 catalog routes
// accept. User-provided values are checked here so malformed or oversized
// input is rejected before a request is built for the upstream.

import { UpstreamApiError } from './errors.js';
import { MAX_NEXT_TOKEN_LENGTH } from './upstream.js';

function validationError(message: string): UpstreamApiError {
  return new UpstreamApiError({ status: 400, code: 'ValidationException', message });
}

/** Read a single string value from a possibly-array query field. */
function single(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * Parse an optional boolean query param. Accepts "true"/"false"
 * (case-insensitive); any other present value is a validation error.
 */
export function parseBooleanParam(name: string, raw: unknown): boolean | undefined {
  const value = single(raw);
  if (value === undefined) return undefined;
  const lowered = value.toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;
  throw validationError(`The ${name} query parameter must be "true" or "false".`);
}

/** BCP-47 language tag: letters/digits in hyphen-separated subtags, ≤35 chars. */
export function parseLocaleParam(raw: unknown): string | undefined {
  const value = single(raw);
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > 35 || !/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(value)) {
    throw validationError('The locale query parameter is not a valid BCP-47 language tag.');
  }
  return value;
}

/** Opaque pagination cursor, bounded to the documented max length. */
export function parseNextTokenParam(raw: unknown): string | undefined {
  const value = single(raw);
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > MAX_NEXT_TOKEN_LENGTH) {
    throw validationError('The nextToken query parameter is missing or too long.');
  }
  return value;
}
