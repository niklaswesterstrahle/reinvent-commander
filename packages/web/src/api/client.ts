// SPA API client (task 14.3, Phase 1 scope)
//
// A thin same-origin fetch wrapper over the Local_Backend's `/api/*` surface.
// It always sends credentials (the session cookie, for when Phase 2 auth
// lands), calls only the local backend, and surfaces the backend's normalized
// `ApiError` envelope to the UI. It never sees tokens and never calls AWS
// directly. Only the Phase 1 anonymous catalog reads are declared here;
// schedule mutations and `/auth/*` are Phase 2.

import type {
  AggregatedBulkResult,
  ApiError,
  AuthStatusResponse,
  Event,
  ListSessionsResponse,
  PersonalTimeInput,
  Schedule,
  Session,
} from '@reinvent-commander/shared';

/** A thrown {@link ApiError}, so callers can `catch` and render the envelope. */
export class ApiClientError extends Error {
  readonly apiError: ApiError;
  constructor(apiError: ApiError) {
    super(apiError.message);
    this.name = 'ApiClientError';
    this.apiError = apiError;
  }
}

/** Is a value a normalized `ApiError` envelope? */
function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.status === 'number' && typeof v.code === 'string' && typeof v.message === 'string';
}

/** Perform a GET and parse JSON, throwing {@link ApiClientError} on any failure. */
async function getJson<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

/**
 * Perform a same-origin, cookie-bearing request, parse any JSON body, and
 * surface the backend's normalized {@link ApiError} on failure. A `body` is
 * JSON-encoded; a 204/empty response yields `undefined`.
 */
async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiClientError({
      status: 0,
      code: 'NetworkError',
      message: 'Could not reach the local backend. Is it running?',
    });
  }

  const parsed = await parseJsonSafe(response);

  if (!response.ok) {
    if (isApiError(parsed)) throw new ApiClientError(parsed);
    throw new ApiClientError({
      status: response.status,
      code: 'UpstreamError',
      message: `Request failed with status ${response.status}.`,
    });
  }

  return parsed as T;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** GET /api/events -> the list of events. */
export async function listEvents(includePast = false): Promise<Event[]> {
  const query = includePast ? '?includePast=true' : '';
  const body = await getJson<{ items: Event[] } | Event[]>(`/api/events${query}`);
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.items) ? body.items : [];
}

/** GET /api/events/:eventId -> a single event. */
export function getEvent(eventId: string): Promise<Event> {
  return getJson<Event>(`/api/events/${encodeURIComponent(eventId)}`);
}

/** Options for a single ListSessions page request. */
export interface ListSessionsOptions {
  locale?: string;
  includeAbstracts?: boolean;
  nextToken?: string;
}

/** GET /api/events/:eventId/sessions -> one page of the catalog. */
export function listSessions(
  eventId: string,
  opts: ListSessionsOptions = {},
): Promise<ListSessionsResponse> {
  const query = new URLSearchParams();
  if (opts.locale !== undefined) query.set('locale', opts.locale);
  if (opts.includeAbstracts !== undefined) {
    query.set('includeAbstracts', String(opts.includeAbstracts));
  }
  if (opts.nextToken !== undefined) query.set('nextToken', opts.nextToken);
  const qs = query.toString();
  return getJson<ListSessionsResponse>(
    `/api/events/${encodeURIComponent(eventId)}/sessions${qs ? `?${qs}` : ''}`,
  );
}

/** GET /api/events/:eventId/sessions/:sessionId -> a single session (GetSession). */
export function getSession(
  eventId: string,
  sessionId: string,
  opts: { locale?: string } = {},
): Promise<Session> {
  const query = opts.locale ? `?locale=${encodeURIComponent(opts.locale)}` : '';
  return getJson<Session>(
    `/api/events/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(sessionId)}${query}`,
  );
}

// ---------------------------------------------------------------------------
// Phase 2 — `/auth/*` session state and authenticated schedule mutations.
//
// All calls are same-origin and cookie-bearing (the opaque HttpOnly session
// cookie). The SPA never holds token material; it only learns its signed-in
// state from GET /auth/status and drives sign-in/out through the backend.
// ---------------------------------------------------------------------------

/** GET /auth/status -> whether the attendee is signed in (plus identity email). */
export function getAuthStatus(): Promise<AuthStatusResponse> {
  return getJson<AuthStatusResponse>('/auth/status');
}

/**
 * Begin sign-in by navigating the browser to GET /auth/login, which 302s to
 * the AWS Builder ID authorize URL. This is a full-document navigation, not a
 * fetch, so the OAuth redirect flow and the callback cookie set work normally.
 */
export function login(): void {
  window.location.assign('/auth/login');
}

/** POST /auth/logout -> clears the session; always reports signed out. */
export function logout(): Promise<{ signedIn: false }> {
  return request<{ signedIn: false }>('POST', '/auth/logout');
}

/** GET /api/events/:eventId/schedule -> the attendee's schedule (ids only). */
export function getSchedule(eventId: string): Promise<Schedule> {
  return getJson<Schedule>(`/api/events/${encodeURIComponent(eventId)}/schedule`);
}

/** POST /api/events/:eventId/favorites -> aggregated bulk outcome. */
export function associateFavorites(
  eventId: string,
  sessionIds: string[],
): Promise<AggregatedBulkResult> {
  return request<AggregatedBulkResult>(
    'POST',
    `/api/events/${encodeURIComponent(eventId)}/favorites`,
    { sessionIds },
  );
}

/** DELETE /api/events/:eventId/favorites/:sessionId -> 204. */
export async function disassociateFavorite(eventId: string, sessionId: string): Promise<void> {
  await request<void>(
    'DELETE',
    `/api/events/${encodeURIComponent(eventId)}/favorites/${encodeURIComponent(sessionId)}`,
  );
}

/** POST /api/events/:eventId/reservations -> aggregated bulk outcome. */
export function reserveSessions(
  eventId: string,
  sessionIds: string[],
): Promise<AggregatedBulkResult> {
  return request<AggregatedBulkResult>(
    'POST',
    `/api/events/${encodeURIComponent(eventId)}/reservations`,
    { sessionIds },
  );
}

/** DELETE /api/events/:eventId/reservations/:sessionId -> 204. */
export async function cancelReservation(eventId: string, sessionId: string): Promise<void> {
  await request<void>(
    'DELETE',
    `/api/events/${encodeURIComponent(eventId)}/reservations/${encodeURIComponent(sessionId)}`,
  );
}

/** POST /api/events/:eventId/personal-time -> 204. */
export async function createPersonalTime(
  eventId: string,
  input: PersonalTimeInput,
): Promise<void> {
  await request<void>('POST', `/api/events/${encodeURIComponent(eventId)}/personal-time`, input);
}

/** PUT /api/events/:eventId/personal-time/:personalTimeId -> 204. */
export async function updatePersonalTime(
  eventId: string,
  personalTimeId: string,
  input: PersonalTimeInput,
): Promise<void> {
  await request<void>(
    'PUT',
    `/api/events/${encodeURIComponent(eventId)}/personal-time/${encodeURIComponent(
      personalTimeId,
    )}`,
    input,
  );
}

/** DELETE /api/events/:eventId/personal-time/:personalTimeId -> 204 (idempotent). */
export async function deletePersonalTime(
  eventId: string,
  personalTimeId: string,
): Promise<void> {
  await request<void>(
    'DELETE',
    `/api/events/${encodeURIComponent(eventId)}/personal-time/${encodeURIComponent(
      personalTimeId,
    )}`,
  );
}
