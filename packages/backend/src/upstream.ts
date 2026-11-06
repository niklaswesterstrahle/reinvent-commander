// @reinvent-commander/backend — AWS Events REST API client
//
// A minimal, anonymous-only client for the four Phase 1 catalog reads. It
// forwards to the real Events REST API base so the browser never calls AWS
// directly (avoids CORS, mirrors the real architecture). All path and query
// values are URL-encoded so user-provided ids/params cannot inject into the
// request. No auth is attached — that is Phase 2.

import type {
  BulkResult,
  Event,
  EventSummary,
  PersonalTimeInput,
  Schedule,
  Session,
} from '@reinvent-commander/shared';
import {
  MAX_THROTTLE_RETRIES,
  UpstreamApiError,
  mapUpstreamError,
  transportError,
} from './errors.js';
import { sendWithRefreshOn401, type SendOutcome } from './security/refresh401.js';

/** Base of the AWS Events REST API (v1 paths are appended per call). */
export const EVENTS_API_BASE = 'https://api.awsevents.com';

/** Hard cap on `nextToken` length, per the documented request contract. */
export const MAX_NEXT_TOKEN_LENGTH = 512;

/** Hard cap on sessions returned by one ListSessions page. */
export const MAX_SESSIONS_PER_PAGE = 250;

/** `fetch` signature, injectable so tests can mock the upstream. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

/** A sleep function, injectable so tests incur no real delay. */
export type SleepLike = (ms: number) => Promise<void>;

const realSleep: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface EventsClientOptions {
  base?: string;
  fetchImpl?: FetchLike;
  sleep?: SleepLike;
}

export interface ListSessionsOptions {
  locale?: string;
  includeAbstracts?: boolean;
  nextToken?: string;
}

export interface ListSessionsResult {
  items: Session[];
  totalCount: number;
  nextToken?: string;
  /** Upstream `Content-Language` response header, forwarded to the SPA. */
  contentLanguage?: string;
}

/** Validate that a path segment is a plausible id (no slashes / control chars). */
function assertPathSegment(name: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new UpstreamApiError({
      status: 400,
      code: 'ValidationException',
      message: `The ${name} path parameter is missing or invalid.`,
    });
  }
  for (let i = 0; i < value.length; i += 1) {
    const codePoint = value.charCodeAt(i);
    const isControl = codePoint <= 0x1f || codePoint === 0x7f;
    const isReserved = value[i] === '/' || value[i] === '?' || value[i] === '#';
    if (isControl || isReserved) {
      throw new UpstreamApiError({
        status: 400,
        code: 'ValidationException',
        message: `The ${name} path parameter contains invalid characters.`,
      });
    }
  }
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

export class EventsClient {
  private readonly base: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: SleepLike;

  constructor(options: EventsClientOptions = {}) {
    this.base = (options.base ?? EVENTS_API_BASE).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
    this.sleep = options.sleep ?? realSleep;
  }

  /**
   * Perform a GET with bounded retries on 429 (honoring `Retry-After`). Any
   * non-2xx maps to an {@link UpstreamApiError}; transport failures map to a
   * 502 envelope. Returns the raw {@link Response} for the caller to read.
   */
  private async getWithRetry(path: string, query?: URLSearchParams): Promise<Response> {
    const url =
      query && [...query.keys()].length > 0
        ? `${this.base}${path}?${query}`
        : `${this.base}${path}`;

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
        });
      } catch {
        throw new UpstreamApiError(transportError());
      }

      if (response.status === 429 && attempt < MAX_THROTTLE_RETRIES) {
        const mapped = mapUpstreamError(429, undefined, response.headers.get('retry-after'));
        await this.sleep((mapped.retryAfterSeconds ?? 0) * 1000);
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        const body = await parseJsonSafe(response);
        throw new UpstreamApiError(
          mapUpstreamError(
            response.status,
            body as Record<string, unknown> | undefined,
            response.headers.get('retry-after'),
          ),
        );
      }

      return response;
    }
  }

  /** GET /v1/events (ListEvents). */
  async listEvents(opts: { includePast?: boolean } = {}): Promise<EventSummary[]> {
    const query = new URLSearchParams();
    if (opts.includePast !== undefined) {
      query.set('includePast', String(opts.includePast));
    }
    const response = await this.getWithRetry('/v1/events', query);
    const body = (await parseJsonSafe(response)) as { items?: EventSummary[] } | undefined;
    return Array.isArray(body?.items) ? body.items : [];
  }

  /**
   * GET /v1/events/{eventId} (GetEvent).
   *
   * When `auth` is provided the request carries a Bearer token through the
   * single-401 refresh-and-retry path (for registration-gated events); when
   * omitted it is an anonymous read (public, non-gated events).
   */
  async getEvent(eventId: string, auth?: AuthContext): Promise<Event> {
    assertPathSegment('eventId', eventId);
    const path = `/v1/events/${encodeURIComponent(eventId)}`;
    const body = auth
      ? await this.authedRequest(auth, { method: 'GET', path })
      : await parseJsonSafe(await this.getWithRetry(path));
    const envelope = body as { event?: Event } | Event | undefined;
    // The live API wraps the event as `{ "event": { ... } }`; tolerate both the
    // wrapped and the bare `Event` shape so the route returns a plain Event.
    if (envelope && typeof envelope === 'object' && 'event' in envelope && envelope.event) {
      return envelope.event;
    }
    return envelope as Event;
  }

  /**
   * GET /v1/events/{eventId}/sessions (ListSessions).
   *
   * When `auth` is provided the request carries a Bearer token through the
   * single-401 refresh-and-retry path (for registration-gated events); when
   * omitted it is an anonymous read (public, non-gated events).
   */
  async listSessions(
    eventId: string,
    opts: ListSessionsOptions = {},
    auth?: AuthContext,
  ): Promise<ListSessionsResult> {
    assertPathSegment('eventId', eventId);

    const query = new URLSearchParams();
    if (opts.locale !== undefined) query.set('locale', opts.locale);
    // Default includeAbstracts to true (design: full-cache walk matches abstracts).
    query.set('includeAbstracts', String(opts.includeAbstracts ?? true));
    if (opts.nextToken !== undefined) {
      if (opts.nextToken.length > MAX_NEXT_TOKEN_LENGTH) {
        throw new UpstreamApiError({
          status: 400,
          code: 'ValidationException',
          message: 'The nextToken query parameter exceeds the maximum length.',
        });
      }
      query.set('nextToken', opts.nextToken);
    }

    const path = `/v1/events/${encodeURIComponent(eventId)}/sessions`;
    let body: unknown;
    let contentLanguage: string | null;
    if (auth) {
      const authed = await this.authedResponse(auth, { method: 'GET', path, query });
      body = authed.body;
      contentLanguage = authed.response.headers.get('content-language');
    } else {
      const response = await this.getWithRetry(path, query);
      body = await parseJsonSafe(response);
      contentLanguage = response.headers.get('content-language');
    }

    const parsed = body as
      { items?: Session[]; totalCount?: number; nextToken?: string } | undefined;
    const items = Array.isArray(parsed?.items) ? parsed.items.slice(0, MAX_SESSIONS_PER_PAGE) : [];


    const result: ListSessionsResult = {
      items,
      totalCount: typeof parsed?.totalCount === 'number' ? parsed.totalCount : items.length,
    };
    if (typeof parsed?.nextToken === 'string' && parsed.nextToken.length > 0) {
      result.nextToken = parsed.nextToken;
    }
    if (contentLanguage) result.contentLanguage = contentLanguage;
    return result;
  }

  /**
   * GET /v1/events/{eventId}/sessions/{sessionId} (GetSession).
   *
   * When `auth` is provided the request carries a Bearer token through the
   * single-401 refresh-and-retry path (for registration-gated events); when
   * omitted it is an anonymous read (public, non-gated events).
   */
  async getSession(
    eventId: string,
    sessionId: string,
    opts: { locale?: string } = {},
    auth?: AuthContext,
  ): Promise<Session> {
    assertPathSegment('eventId', eventId);
    assertPathSegment('sessionId', sessionId);

    const query = new URLSearchParams();
    if (opts.locale !== undefined) query.set('locale', opts.locale);

    const path = `/v1/events/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(sessionId)}`;
    const body = auth
      ? await this.authedRequest(auth, { method: 'GET', path, query })
      : await parseJsonSafe(await this.getWithRetry(path, query));
    // The live API wraps the session as `{ "session": { ... } }`; tolerate both
    // the wrapped and the bare shape (mirrors getEvent's envelope unwrap).
    const envelope = body as { session?: Session } | Session | undefined;
    if (envelope && typeof envelope === 'object' && 'session' in envelope && envelope.session) {
      return envelope.session;
    }
    return envelope as Session;
  }

  // -------------------------------------------------------------------------
  // Authenticated schedule / favorites / reservations / personal-time calls.
  //
  // Each carries a Bearer access token and is routed through the single-401
  // refresh-and-retry handler (at most one refresh + one retry) wrapped around
  // the same bounded 429 Retry-After controller used by the anonymous reads.
  // A second 401 surfaces as a thrown AuthenticationRequiredException so the
  // caller prompts re-auth. Only the access token is ever sent upstream.
  // -------------------------------------------------------------------------

  /** GET /v1/events/{eventId}/schedule — the attendee's schedule (ids only). */
  async getSchedule(auth: AuthContext, eventId: string): Promise<Schedule> {
    assertPathSegment('eventId', eventId);
    const body = await this.authedRequest(auth, {
      method: 'GET',
      path: `/v1/events/${encodeURIComponent(eventId)}/schedule`,
    });
    // The live API wraps the schedule as `{ "schedule": { ... } }`; tolerate
    // both the wrapped and the bare shape (mirrors getEvent's envelope unwrap).
    const raw = (body ?? {}) as { schedule?: Partial<Schedule> } | Partial<Schedule>;
    const schedule = (
      raw && typeof raw === 'object' && 'schedule' in raw && raw.schedule ? raw.schedule : raw
    ) as Partial<Schedule>;
    return {
      reserved: Array.isArray(schedule.reserved) ? schedule.reserved : [],
      favorites: Array.isArray(schedule.favorites) ? schedule.favorites : [],
      personalTime: Array.isArray(schedule.personalTime) ? schedule.personalTime : [],
    };
  }

  /** POST /v1/events/{eventId}/favorites — favorite 1–10 sessions. */
  async associateFavorites(
    auth: AuthContext,
    eventId: string,
    sessionIds: string[],
  ): Promise<BulkResult> {
    assertPathSegment('eventId', eventId);
    const body = await this.authedRequest(auth, {
      method: 'POST',
      path: `/v1/events/${encodeURIComponent(eventId)}/favorites`,
      body: { sessionIds },
    });
    return readBulkResult(body);
  }

  /** DELETE /v1/events/{eventId}/favorites/{sessionId}. */
  async disassociateFavorite(
    auth: AuthContext,
    eventId: string,
    sessionId: string,
  ): Promise<void> {
    assertPathSegment('eventId', eventId);
    assertPathSegment('sessionId', sessionId);
    await this.authedRequest(auth, {
      method: 'DELETE',
      path: `/v1/events/${encodeURIComponent(eventId)}/favorites/${encodeURIComponent(sessionId)}`,
    });
  }

  /** POST /v1/events/{eventId}/reservations — reserve 1–10 sessions. */
  async reserveSessions(
    auth: AuthContext,
    eventId: string,
    sessionIds: string[],
  ): Promise<BulkResult> {
    assertPathSegment('eventId', eventId);
    const body = await this.authedRequest(auth, {
      method: 'POST',
      path: `/v1/events/${encodeURIComponent(eventId)}/reservations`,
      body: { sessionIds },
    });
    return readBulkResult(body);
  }

  /** DELETE /v1/events/{eventId}/reservations/{sessionId}. */
  async cancelReservation(
    auth: AuthContext,
    eventId: string,
    sessionId: string,
  ): Promise<void> {
    assertPathSegment('eventId', eventId);
    assertPathSegment('sessionId', sessionId);
    await this.authedRequest(auth, {
      method: 'DELETE',
      path: `/v1/events/${encodeURIComponent(eventId)}/reservations/${encodeURIComponent(sessionId)}`,
    });
  }

  /** POST /v1/events/{eventId}/personal-time — create a personal-time block. */
  async createPersonalTime(
    auth: AuthContext,
    eventId: string,
    input: PersonalTimeInput,
  ): Promise<void> {
    assertPathSegment('eventId', eventId);
    await this.authedRequest(auth, {
      method: 'POST',
      path: `/v1/events/${encodeURIComponent(eventId)}/personal-time`,
      body: input,
    });
  }

  /** PUT /v1/events/{eventId}/personal-time/{personalTimeId} — update a block. */
  async updatePersonalTime(
    auth: AuthContext,
    eventId: string,
    personalTimeId: string,
    input: PersonalTimeInput,
  ): Promise<void> {
    assertPathSegment('eventId', eventId);
    assertPathSegment('personalTimeId', personalTimeId);
    await this.authedRequest(auth, {
      method: 'PUT',
      path: `/v1/events/${encodeURIComponent(eventId)}/personal-time/${encodeURIComponent(personalTimeId)}`,
      body: input,
    });
  }

  /**
   * DELETE /v1/events/{eventId}/personal-time/{personalTimeId}. Idempotent: a
   * 404 (already gone) is swallowed so a repeat delete is a no-op.
   */
  async deletePersonalTime(
    auth: AuthContext,
    eventId: string,
    personalTimeId: string,
  ): Promise<void> {
    assertPathSegment('eventId', eventId);
    assertPathSegment('personalTimeId', personalTimeId);
    try {
      await this.authedRequest(auth, {
        method: 'DELETE',
        path: `/v1/events/${encodeURIComponent(eventId)}/personal-time/${encodeURIComponent(personalTimeId)}`,
      });
    } catch (error) {
      if (error instanceof UpstreamApiError && error.apiError.status === 404) return;
      throw error;
    }
  }

  /**
   * Perform one authenticated request with a single-401 refresh-and-retry
   * wrapped around the bounded 429 Retry-After controller. Returns the parsed
   * JSON body (or `undefined` for an empty body). Throws an
   * {@link UpstreamApiError} on a mapped non-2xx; a persistent 401 surfaces as
   * an AuthenticationRequiredException (401).
   */
  private async authedRequest(
    auth: AuthContext,
    req: { method: string; path: string; body?: unknown; query?: URLSearchParams },
  ): Promise<unknown> {
    return (await this.authedResponse(auth, req)).body;
  }

  /**
   * Like {@link authedRequest} but returns the successful {@link Response}
   * alongside the parsed body, so callers that need response headers (e.g.
   * ListSessions reading `Content-Language`) can inspect them.
   */
  private async authedResponse(
    auth: AuthContext,
    req: { method: string; path: string; body?: unknown; query?: URLSearchParams },
  ): Promise<{ response: Response; body: unknown }> {
    const send = async (token: string): Promise<SendOutcome<Response>> => {
      const response = await this.sendWithThrottleRetry(token, req);
      if (response.status === 401) return { unauthorized: true };
      return { unauthorized: false, value: response };
    };

    const result = await sendWithRefreshOn401<Response>(
      async () => send(await auth.getToken()),
      async () => {
        const refreshed = await auth.refresh();
        return typeof refreshed === 'string' && refreshed.length > 0;
      },
    );

    if (result.kind === 'reauthRequired') {
      throw new UpstreamApiError(mapUpstreamError(401));
    }

    const response = result.value;
    if (response.status < 200 || response.status >= 300) {
      const body = await parseJsonSafe(response);
      throw new UpstreamApiError(
        mapUpstreamError(
          response.status,
          body as Record<string, unknown> | undefined,
          response.headers.get('retry-after'),
        ),
      );
    }
    return { response, body: await parseJsonSafe(response) };
  }

  /**
   * Issue a single authenticated request with the bounded 429 Retry-After
   * controller. Returns the {@link Response} (including a 401, which the caller
   * inspects for the refresh-and-retry path). Transport failures map to a 502.
   */
  private async sendWithThrottleRetry(
    token: string,
    req: { method: string; path: string; body?: unknown; query?: URLSearchParams },
  ): Promise<Response> {
    const url =
      req.query && [...req.query.keys()].length > 0
        ? `${this.base}${req.path}?${req.query}`
        : `${this.base}${req.path}`;
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    };
    const init: { method: string; headers: Record<string, string>; body?: string } = {
      method: req.method,
      headers,
    };
    if (req.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(req.body);
    }

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, init);
      } catch {
        throw new UpstreamApiError(transportError());
      }

      if (response.status === 429 && attempt < MAX_THROTTLE_RETRIES) {
        const mapped = mapUpstreamError(429, undefined, response.headers.get('retry-after'));
        await this.sleep((mapped.retryAfterSeconds ?? 0) * 1000);
        continue;
      }
      return response;
    }
  }
}

/**
 * Per-request auth hooks for the schedule proxy: `getToken` returns a valid
 * access token (refreshing near expiry), and `refresh` forces a refresh for the
 * single-401 retry, returning the new token or `undefined` when re-auth is
 * required.
 */
export interface AuthContext {
  getToken: () => Promise<string>;
  refresh: () => Promise<string | undefined>;
}

/** Read an untrusted bulk-mutation body into a {@link BulkResult}. */
function readBulkResult(body: unknown): BulkResult {
  const raw = (body ?? {}) as Partial<BulkResult>;
  return {
    successful: Array.isArray(raw.successful) ? raw.successful : [],
    failed: Array.isArray(raw.failed) ? raw.failed : [],
  };
}
