// @reinvent-commander/shared — client-derived data models
//
// Types the SPA computes or holds on top of the API-derived models: the
// normalized search/index record, query state, facet/sort enumerations, and
// the IndexedDB cache record. These are not API-wire shapes; they describe
// state owned by the browser.

import type { SeatAvailability, Session } from './api.js';

/**
 * The twelve catalog facet arrays available for filtering. Each corresponds to
 * a `string[]` field on {@link Session}.
 */
export type FacetName =
  | 'tracks'
  | 'topics'
  | 'industries'
  | 'areasOfInterest'
  | 'roles'
  | 'services'
  | 'segments'
  | 'features'
  | 'customerPersonas'
  | 'experiences'
  | 'additionalActivities'
  | 'focusAreas';

/** Fields the catalog can be sorted by. */
export type SortField = 'code' | 'title' | 'track' | 'day';

/**
 * Normalized search/index record built once per catalog load, one per session.
 */
export interface IndexedSession {
  sessionId: string;
  /** Lowercased, trimmed: title + abbreviation + abstract + speaker names. */
  haystack: string;
  /** The `sessionTime.date` (ISO), when present. */
  day?: string;
  /** Weekday derived from the date (e.g. "Monday"); computed, never hard-coded. */
  weekday?: string;
  /** Title with a duplicated leading code prefix stripped (render-only). */
  displayTitle: string;
  /** Derived from venue + room, when present. */
  location?: string;
  /** Resolved from sessionTime (date+time+length); undefined if unresolvable. */
  startMs?: number;
  /** Resolved end instant; undefined if unresolvable. */
  endMs?: number;
  /** Seat band, mirrored for reservable sessions. */
  reservableBand?: SeatAvailability;
}

/** The active search/filter/sort state of the Query_Engine. */
export interface QueryState {
  term: string;
  categories: {
    day?: string[];
    track?: string[];
    type?: string[];
    level?: string[];
    location?: string[];
  };
  facets: Partial<Record<FacetName, string[]>>;
  sortField?: SortField;
  sortDir: 'asc' | 'desc';
}

/** A persisted catalog snapshot, keyed by `eventId + locale`. */
export interface CatalogCacheRecord {
  eventId: string;
  locale: string;
  sessions: Session[];
  totalCount: number;
  /** Epoch ms of the last successful refresh; drives the cached-state indicator. */
  lastRefreshedAt: number;
}
