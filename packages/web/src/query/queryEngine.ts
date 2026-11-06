// Query_Engine — search, filter, and sort over the normalized search index.
//
// One search box: the trimmed, case-insensitive term matches the session's
// haystack as a substring OR the session's derived day as a Day_Term (so
// typing "monday", "tue", or "dec 1" filters by day from the same box).
// Filtering is OR-within a category/facet and AND-across categories/facets over
// day/track/type/level/location and the twelve facet arrays. Sorting orders by
// the selected field (code/title/track/day) with an abbreviation tie-break;
// the day sort is chronological by date, tie-breaking on start time then
// abbreviation; ascending by default and reversed when toggled to descending.

import type { QueryState, Session } from '@reinvent-commander/shared';
import { matchesDayTerm, parseDayTerm } from './dayMatching.js';
import { FACET_NAMES, type SearchIndex } from './searchIndex.js';

/** The outcome of running a query: the matching rows plus match/total counts. */
export interface QueryResult {
  /** Sessions that match, in sorted order. */
  rows: Session[];
  /** Number of matching sessions. */
  matching: number;
  /** Total number of sessions in the catalog. */
  total: number;
}

/** Normalize a free-text term: trimmed and lowercased. */
function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

/**
 * Does a session match the search term? True when the term is empty, when the
 * session haystack contains the term as a substring, or when the term parses as
 * a Day_Term that matches the session's day.
 */
function matchesSearch(index: SearchIndex, sessionIndex: number, term: string): boolean {
  const q = normalizeTerm(term);
  if (!q) return true;
  const idx = index.indexed[sessionIndex];
  if (idx.haystack.includes(q)) return true;
  const dayTerm = parseDayTerm(q);
  return dayTerm ? matchesDayTerm(idx.day, dayTerm) : false;
}

/** The scalar category values a session contributes to, for filtering. */
function categoryValues(
  index: SearchIndex,
  sessionIndex: number,
): { day: string[]; track: string[]; type: string[]; level: string[]; location: string[] } {
  const session = index.sessions[sessionIndex];
  const idx = index.indexed[sessionIndex];
  return {
    day: idx.day ? [idx.day] : [],
    track: session.tracks ?? [],
    type: session.type ? [session.type] : [],
    level: session.level ? [session.level] : [],
    location: idx.location ? [idx.location] : [],
  };
}

/** OR-within a single category: the session has at least one selected value. */
function matchesOneCategory(sessionValues: string[], selected: string[] | undefined): boolean {
  if (!selected || selected.length === 0) return true;
  return selected.some((v) => sessionValues.includes(v));
}

/**
 * Does a session satisfy the filter state? AND across every category/facet that
 * has an active selection, OR within each one.
 */
function matchesFilters(index: SearchIndex, sessionIndex: number, state: QueryState): boolean {
  const cats = categoryValues(index, sessionIndex);
  const { categories, facets } = state;

  if (!matchesOneCategory(cats.day, categories.day)) return false;
  if (!matchesOneCategory(cats.track, categories.track)) return false;
  if (!matchesOneCategory(cats.type, categories.type)) return false;
  if (!matchesOneCategory(cats.level, categories.level)) return false;
  if (!matchesOneCategory(cats.location, categories.location)) return false;

  const session = index.sessions[sessionIndex];
  for (const name of FACET_NAMES) {
    if (!matchesOneCategory(session[name] ?? [], facets[name])) return false;
  }
  return true;
}

/** Lowercased abbreviation used as the universal tie-break key. */
function abbrevKey(session: Session): string {
  return (session.abbreviation ?? '').toLowerCase();
}

/**
 * The ascending comparator for a sort field. Returns the raw (ascending)
 * ordering; the caller negates it for a descending sort. The abbreviation
 * tie-break is applied last for every field. The day sort orders chronologically
 * by date and tie-breaks on start time before the abbreviation.
 */
export function compareBy(
  index: SearchIndex,
  field: NonNullable<QueryState['sortField']>,
  a: number,
  b: number,
): number {
  const sa = index.sessions[a];
  const sb = index.sessions[b];
  const ia = index.indexed[a];
  const ib = index.indexed[b];
  let r = 0;

  switch (field) {
    case 'code':
      r = abbrevKey(sa).localeCompare(abbrevKey(sb));
      break;
    case 'title':
      r = ia.displayTitle.toLowerCase().localeCompare(ib.displayTitle.toLowerCase());
      break;
    case 'track':
      r = (sa.tracks?.[0] ?? '').toLowerCase().localeCompare((sb.tracks?.[0] ?? '').toLowerCase());
      break;
    case 'day': {
      // Chronological by date; sessions without a date sort last.
      const da = ia.day ?? '\uffff';
      const db = ib.day ?? '\uffff';
      r = da.localeCompare(db);
      if (r === 0) {
        const ta = sa.sessionTime?.time ?? '\uffff';
        const tb = sb.sessionTime?.time ?? '\uffff';
        r = ta.localeCompare(tb);
      }
      break;
    }
  }

  if (r === 0) r = abbrevKey(sa).localeCompare(abbrevKey(sb));
  return r;
}

/**
 * Run the full query over a prebuilt index: search, then filter, then sort.
 * Returns the matching rows and the matching/total counts. The submitted
 * `state` is never mutated, so the caller retains it unchanged on no match.
 */
export function runQuery(index: SearchIndex, state: QueryState): QueryResult {
  const total = index.sessions.length;

  // Search + filter, keeping original positions so sort can read the index.
  const matchedPositions: number[] = [];
  for (let i = 0; i < total; i++) {
    if (matchesSearch(index, i, state.term) && matchesFilters(index, i, state)) {
      matchedPositions.push(i);
    }
  }

  if (state.sortField) {
    const field = state.sortField;
    const dir = state.sortDir === 'desc' ? -1 : 1;
    matchedPositions.sort((a, b) => {
      const r = compareBy(index, field, a, b);
      return dir * r;
    });
  }

  return {
    rows: matchedPositions.map((i) => index.sessions[i]),
    matching: matchedPositions.length,
    total,
  };
}
