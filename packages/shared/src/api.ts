// @reinvent-commander/shared — API-derived data models
//
// These types mirror the documented AWS Events API OpenAPI 3.1 schema
// (https://api.awsevents.com/v1/openapi.json) exactly. They describe the
// payloads the Local_Backend receives from api.awsevents.com and forwards to
// the SPA. Field names, optionality, and value sets follow the published
// schema; nothing undocumented is invented here.

/**
 * Seat-availability band for a reservable session. Present only on sessions
 * where `isReservable` is true.
 */
export type SeatAvailability = 'available' | 'limited' | 'veryLimited' | 'unavailable' | 'walkUp';

/** When a session is scheduled. */
export interface SessionTime {
  /** Calendar date, "YYYY-MM-DD". */
  date: string;
  /** Start time of day, "HH:MM". */
  time: string;
  /** Duration in minutes, encoded as a string. */
  length: string;
  /** IANA timezone, when present. */
  timezone?: string;
}

/** A session speaker. */
export interface Speaker {
  name: string;
}

/**
 * A single catalog session. Only `sessionId` and `title` are guaranteed; every
 * other field may be absent depending on the session and the request options
 * (for example `abstract` is omitted when `includeAbstracts=false`, and
 * `seatAvailability` is present only on reservable sessions). Each facet array
 * holds unique values, at most 100 per array.
 */
export interface Session {
  sessionId: string;
  title: string;
  abbreviation?: string;
  abstract?: string;
  type?: string;
  level?: string;
  venue?: string;
  room?: string;
  isAllDaySession?: boolean;
  isReservable?: boolean;
  /** Present only on reservable sessions. */
  seatAvailability?: SeatAvailability;
  sessionTime?: SessionTime;
  speakers?: Speaker[];
  // Facet arrays — each unique, max 100 entries.
  tracks?: string[];
  topics?: string[];
  industries?: string[];
  areasOfInterest?: string[];
  roles?: string[];
  services?: string[];
  segments?: string[];
  features?: string[];
  customerPersonas?: string[];
  experiences?: string[];
  additionalActivities?: string[];
  focusAreas?: string[];
}

/** A block of attendee personal time on the schedule. */
export interface PersonalTime {
  personalTimeId: string;
  /** Wall-clock "YYYY-MM-DDTHH:MM:SS", no Z/offset, seconds always "00". */
  startDateTime: string;
  /** Wall-clock "YYYY-MM-DDTHH:MM:SS", no Z/offset, seconds always "00". */
  endDateTime: string;
  /** 1–128 characters. */
  title: string;
  /** Required, 1–250 characters. */
  description: string;
  /** 1–255 characters when present. */
  location?: string;
}

/** Create/update payload for personal time (server assigns the id). */
export type PersonalTimeInput = Omit<PersonalTime, 'personalTimeId'>;

/**
 * The backend-only token material for one signed-in session. Held in memory by
 * the Local_Backend's token vault and NEVER crosses the trust boundary to the
 * browser: the SPA only ever holds the opaque HttpOnly session cookie.
 */
export interface TokenSet {
  /** Access JWT (~60 min). The only token sent upstream as `Authorization: Bearer`. */
  accessToken: string;
  /** Epoch ms at which the access token expires. */
  accessTokenExpiresAt: number;
  /** Identity claims decoded from the ID token; the ID token itself is never retained for export. */
  idTokenClaims: { email?: string; sub?: string };
  /** Opaque refresh token (~30 days). Sent only to the token endpoint. */
  refreshToken: string;
}

/**
 * Error `code` surfaced when a session can no longer be refreshed (refresh
 * rejected or the refresh token has reached its 30-day life). The proxy maps
 * this to a signed-out / re-auth prompt for the SPA.
 */
export const REAUTH_REQUIRED_CODE = 'ReauthRequired' as const;

/** An attendee's schedule for an event. */
export interface Schedule {
  /** Reserved sessionIds; always present (may be empty), max 1000. */
  reserved: string[];
  /** Favorited sessionIds. */
  favorites: string[];
  personalTime: PersonalTime[];
}

/**
 * Documented bulk-failure codes. The wire `code` is widened to
 * `BulkFailureCode | string` on {@link BulkFailure} so unknown codes are
 * tolerated rather than rejected.
 */
export type BulkFailureCode =
  | 'sessionNotReservable'
  | 'scheduleConflict'
  | 'alreadyScheduled'
  | 'sessionFull'
  | 'insufficientAccess'
  | 'timePassed'
  | 'alreadyFavorited'
  | 'notFavorited'
  | 'other';

/** Per-session failure entry in a {@link BulkResult}. */
export interface BulkFailure {
  sessionId: string;
  /** Widened to `string` to tolerate undocumented/unknown codes. */
  code: BulkFailureCode | string;
  /** Present for `scheduleConflict`: the conflicting sessionIds. */
  conflictsWith?: string[];
}

/**
 * Outcome of a bulk favorite/reservation request. A request can succeed for
 * some sessions and fail for others, so `failed` must be inspected even on a
 * 200 response.
 */
export interface BulkResult {
  successful: string[];
  failed: BulkFailure[];
}

/** Physical location of an event. */
export interface EventAddress {
  city?: string;
}

/**
 * A single AWS event. The API returns this same schema from both ListEvents
 * (as list `items`) and GetEvent.
 */
export interface Event {
  eventId: string;
  name: string;
  eventType: string;
  /** ISO-8601 with UTC offset. */
  startDate: string;
  /** ISO-8601 with UTC offset. */
  endDate: string;
  isOnline: boolean;
  authenticationRequired: boolean;
  /** IANA timezone, e.g. "America/Sao_Paulo". */
  timezone?: string;
  /** Short display abbreviation, e.g. "BRT". */
  timezoneAbbreviation?: string;
  /** "12 hour" or "24 hour". */
  timeFormat?: string;
  address?: EventAddress;
  /** BCP-47 language tags, unique, max 100. */
  supportedLanguageCodes?: string[];
}

/**
 * An entry in the ListEvents result. The API uses the same shape for list and
 * get, so this is an alias of {@link Event}.
 */
export type EventSummary = Event;

/**
 * Local normalized error envelope. Produced by the Local_Backend when mapping
 * upstream status codes/transport failures to a single shape the SPA renders
 * uniformly. This is not an API-wire type; it is the backend↔SPA contract.
 */
export interface ApiError {
  status: number;
  code: string;
  message: string;
  /** Present on 429 responses when a Retry-After was supplied/derived. */
  retryAfterSeconds?: number;
  /** Present when the error carries conflicting sessionIds. */
  conflictsWith?: string[];
}

/**
 * Bulk result aggregated by the Local_Backend across its internal batches of
 * ≤10, so the SPA sees a single result for an arbitrarily large unique input
 * set. The arrays are the concatenation of the per-batch arrays.
 */
export interface AggregatedBulkResult {
  successful: string[];
  failed: BulkFailure[];
}
