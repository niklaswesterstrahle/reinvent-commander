// Query_Engine — normalized search index, displayTitle, and per-facet value sets.
//
// Built once per catalog load. For each session this produces an
// `IndexedSession` carrying a lowercased/trimmed haystack (title + abbreviation
// + abstract + speaker names), a render-only `displayTitle` with a duplicated
// leading session-code prefix stripped, and the derived day/weekday/location/
// start/end fields the search, filter, and sort stages read. It also computes
// the per-category and per-facet value sets used to populate filter choices.

import type { FacetName, IndexedSession, Session } from '@reinvent-commander/shared';
import { weekdayOf } from './dayMatching.js';

/** The twelve facet field names, mirrored from the shared {@link FacetName} union. */
export const FACET_NAMES: readonly FacetName[] = [
  'tracks',
  'topics',
  'industries',
  'areasOfInterest',
  'roles',
  'services',
  'segments',
  'features',
  'customerPersonas',
  'experiences',
  'additionalActivities',
  'focusAreas',
];

/** Matches a generic leading session-code token, e.g. "AIM200" or "SVS301-R". */
const GENERIC_CODE_PREFIX = /^[A-Z]{2,4}\d{2,4}[A-Z-]*/;

/** Trims a leading separator (":", "-", en/em dash) and surrounding space. */
const LEADING_SEPARATOR = /^\s*[:\u2013\u2014-]\s*/;

/**
 * Strip a leading session-code prefix from a title so the code is not shown
 * twice beside the Code column. Removes the exact `abbreviation` prefix when
 * the title starts with it, otherwise a generic leading code pattern, then any
 * following separator. Render-only: the stored `Session.title` is never
 * mutated, and the original trimmed title is retained if stripping would leave
 * it empty.
 */
export function displayTitle(session: Session): string {
  const original = session.title.trim();
  let t = original;
  const abbr = session.abbreviation?.trim();

  if (abbr && t.toLowerCase().startsWith(abbr.toLowerCase())) {
    t = t.slice(abbr.length);
  } else {
    t = t.replace(GENERIC_CODE_PREFIX, '');
  }

  const stripped = t.replace(LEADING_SEPARATOR, '').trim();
  return stripped || original;
}

/** Build the lowercased, trimmed haystack: title + abbreviation + abstract + speakers. */
function buildHaystack(session: Session): string {
  const speakerNames = (session.speakers ?? []).map((s) => s.name).join(' ');
  return [session.title, session.abbreviation ?? '', session.abstract ?? '', speakerNames]
    .join(' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Derive a human location from venue + room, when either is present. */
function buildLocation(session: Session): string | undefined {
  const parts = [session.venue, session.room].map((p) => p?.trim()).filter(Boolean) as string[];
  return parts.length ? parts.join(' — ') : undefined;
}

/**
 * Resolve the start/end instants of a session from its `sessionTime`. A session
 * is resolvable only when it has a date, time, and numeric length and is not an
 * all-day session. The instant is the wall-clock date+time read as a comparable
 * UTC value (the event is a single timezone, so a consistent interpretation is
 * enough for ordering and conflict math). Returns `undefined` fields when
 * unresolvable.
 */
function resolveInstants(session: Session): { startMs?: number; endMs?: number } {
  const st = session.sessionTime;
  if (!st || session.isAllDaySession) return {};
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(st.date ?? '');
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(st.time ?? '');
  if (!dateMatch || !timeMatch) return {};
  const length = Number(st.length);
  if (!Number.isFinite(length) || length < 0) return {};

  const startMs = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  return { startMs, endMs: startMs + length * 60000 };
}

/** Compute the normalized {@link IndexedSession} for a single session. */
export function indexSession(session: Session): IndexedSession {
  const day = session.sessionTime?.date;
  const { startMs, endMs } = resolveInstants(session);
  return {
    sessionId: session.sessionId,
    haystack: buildHaystack(session),
    day,
    weekday: weekdayOf(day),
    displayTitle: displayTitle(session),
    location: buildLocation(session),
    startMs,
    endMs,
    reservableBand: session.isReservable ? session.seatAvailability : undefined,
  };
}

/**
 * Per-category and per-facet value sets, built once per catalog load, used to
 * populate the filter choices. `day`/`track`/`type`/`level`/`location` are the
 * scalar categories; `facets` holds the distinct values of each facet array.
 */
export interface FacetValueSets {
  day: string[];
  track: string[];
  type: string[];
  level: string[];
  location: string[];
  facets: Record<FacetName, string[]>;
}

/** Sorted, de-duplicated values of a collection. */
function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/**
 * Build the per-facet value sets for a catalog, pairing each session with its
 * precomputed {@link IndexedSession} so location/day are taken from the index.
 */
export function buildFacetValueSets(
  sessions: readonly Session[],
  indexed: readonly IndexedSession[],
): FacetValueSets {
  const day = new Set<string>();
  const track = new Set<string>();
  const type = new Set<string>();
  const level = new Set<string>();
  const location = new Set<string>();
  const facets: Record<FacetName, Set<string>> = {
    tracks: new Set(),
    topics: new Set(),
    industries: new Set(),
    areasOfInterest: new Set(),
    roles: new Set(),
    services: new Set(),
    segments: new Set(),
    features: new Set(),
    customerPersonas: new Set(),
    experiences: new Set(),
    additionalActivities: new Set(),
    focusAreas: new Set(),
  };

  sessions.forEach((session, i) => {
    const idx = indexed[i];
    if (idx?.day) day.add(idx.day);
    if (idx?.location) location.add(idx.location);
    (session.tracks ?? []).forEach((v) => track.add(v));
    if (session.type) type.add(session.type);
    if (session.level) level.add(session.level);
    for (const name of FACET_NAMES) {
      for (const v of session[name] ?? []) facets[name].add(v);
    }
  });

  return {
    day: sortedUnique(day),
    track: sortedUnique(track),
    type: sortedUnique(type),
    level: sortedUnique(level),
    location: sortedUnique(location),
    facets: {
      tracks: sortedUnique(facets.tracks),
      topics: sortedUnique(facets.topics),
      industries: sortedUnique(facets.industries),
      areasOfInterest: sortedUnique(facets.areasOfInterest),
      roles: sortedUnique(facets.roles),
      services: sortedUnique(facets.services),
      segments: sortedUnique(facets.segments),
      features: sortedUnique(facets.features),
      customerPersonas: sortedUnique(facets.customerPersonas),
      experiences: sortedUnique(facets.experiences),
      additionalActivities: sortedUnique(facets.additionalActivities),
      focusAreas: sortedUnique(facets.focusAreas),
    },
  };
}

/**
 * The compiled search index for a catalog: the per-session {@link IndexedSession}
 * records (parallel to the input session order), a lookup by sessionId, and the
 * per-facet value sets. Built once per catalog load.
 */
export interface SearchIndex {
  sessions: readonly Session[];
  indexed: IndexedSession[];
  byId: Map<string, IndexedSession>;
  facetValues: FacetValueSets;
}

/** Build the full {@link SearchIndex} for a catalog. */
export function buildSearchIndex(sessions: readonly Session[]): SearchIndex {
  const indexed = sessions.map(indexSession);
  const byId = new Map(indexed.map((i) => [i.sessionId, i]));
  return {
    sessions,
    indexed,
    byId,
    facetValues: buildFacetValueSets(sessions, indexed),
  };
}
