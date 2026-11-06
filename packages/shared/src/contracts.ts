// @reinvent-commander/shared — SPA ↔ Local_Backend local-API contracts (Phase 1)
//
// Request/response contract types for the Phase 1 `/api/*` routes the SPA uses
// to read the catalog through the Local_Backend. These describe the
// same-origin local API, not the upstream AWS wire format: the backend proxies
// to api.awsevents.com and returns these shapes (or the normalized ApiError).
//
// Phase 1 scope is catalog browsing only. The authenticated `/auth/*` routes
// and schedule mutations are Phase 2 and are declared below (the backend-only
// TokenSet stays in api.ts, out of this SPA-facing surface).

import type {
  AggregatedBulkResult,
  Event,
  EventSummary,
  PersonalTimeInput,
  Schedule,
  Session,
} from './api.js';

/** GET /api/events?includePast */
export interface ListEventsRequest {
  /** Include events that have already ended. Defaults to false. */
  includePast?: boolean;
}

/** GET /api/events -> the list of events. */
export type ListEventsResponse = EventSummary[];

/** GET /api/events/:eventId */
export interface GetEventRequest {
  eventId: string;
}

/** GET /api/events/:eventId -> a single event. */
export type GetEventResponse = Event;

/** GET /api/events/:eventId/sessions?locale&includeAbstracts&nextToken */
export interface ListSessionsRequest {
  eventId: string;
  /** BCP-47 locale for the catalog. */
  locale?: string;
  /** Whether to include abstract text in each session. */
  includeAbstracts?: boolean;
  /** Opaque pagination cursor from the previous page. */
  nextToken?: string;
}

/** GET /api/events/:eventId/sessions -> one page of the catalog. */
export interface ListSessionsResponse {
  items: Session[];
  /** Total number of sessions in the event's catalog. */
  totalCount: number;
  /** Cursor for the next page; absent on the last page. */
  nextToken?: string;
}

/** GET /api/events/:eventId/sessions/:sessionId?locale */
export interface GetSessionRequest {
  eventId: string;
  sessionId: string;
  /** BCP-47 locale for the session. */
  locale?: string;
}

/** GET /api/events/:eventId/sessions/:sessionId -> a single session. */
export type GetSessionResponse = Session;

// ---------------------------------------------------------------------------
// Phase 2 — authenticated `/auth/*` routes and schedule mutations.
//
// These describe the same-origin local API the SPA uses once signed in. The
// backend holds the real tokens; the SPA only ever carries the opaque HttpOnly
// session cookie, so none of these shapes reference token material.
// ---------------------------------------------------------------------------

/** GET /auth/status -> whether the attendee is signed in (plus identity email). */
export interface AuthStatusResponse {
  signedIn: boolean;
  /** Present when signed in, derived from the server-held ID token claims. */
  email?: string;
}

/**
 * GET /auth/login -> HTTP 302 redirect to the AWS Builder ID authorize URL.
 * There is no JSON body; the backend sets `Location` and the browser follows
 * it. Documented here as a contract marker only.
 */
export type GetLoginResponse = never;

/** POST /auth/logout -> clears the session; always reports signed out. */
export interface LogoutResponse {
  signedIn: false;
}

/** GET /api/events/:eventId/schedule -> the attendee's schedule (ids only). */
export type GetScheduleResponse = Schedule;

/**
 * Bulk favorite/reservation request body for
 * POST /api/events/:eventId/favorites and POST .../reservations. The backend
 * batches internally (≤10 per upstream call) and aggregates the outcome.
 */
export interface BulkScheduleRequest {
  /** Unique sessionIds to favorite/reserve, 1–10 per SPA call. */
  sessionIds: string[];
}

/** Aggregated outcome of a bulk favorite/reservation request. */
export type BulkScheduleResponse = AggregatedBulkResult;

/**
 * DELETE /api/events/:eventId/favorites/:sessionId and
 * DELETE .../reservations/:sessionId -> HTTP 204, no body.
 */
export type DeleteScheduleItemResponse = void;

/**
 * POST /api/events/:eventId/personal-time (create) and
 * PUT .../personal-time/:personalTimeId (update) request body.
 */
export type PersonalTimeRequest = PersonalTimeInput;

/**
 * POST/PUT/DELETE personal-time -> HTTP 204, no body. DELETE is idempotent.
 */
export type PersonalTimeResponse = void;
