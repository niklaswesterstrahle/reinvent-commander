// Property test for filter semantics.
//
// Feature: reinvent-commander, Property 4: Filtering is OR-within a
// category/facet, AND-across categories/facets, and monotonically
// non-increasing as selections are added. Validated against a brute-force
// per-session predicate oracle.

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import type { FacetName, QueryState, Session } from '@reinvent-commander/shared';
import { buildSearchIndex } from './searchIndex.js';
import { runQuery } from './queryEngine.js';
import { FACET_NAMES } from './searchIndex.js';
import { catalogArb } from './testArbitraries.js';

const NUM_RUNS = 150;

type Categories = NonNullable<QueryState['categories']>;

/** Build a filter-only QueryState (no search term, no sort). */
const stateOf = (
  categories: Categories,
  facets: Partial<Record<FacetName, string[]>>,
): QueryState => ({ term: '', categories, facets, sortDir: 'asc' });

/** The scalar category values a session contributes to (mirrors the engine). */
function sessionCategoryValues(session: Session): Record<keyof Categories, string[]> {
  const location =
    [session.venue, session.room].map((p) => p?.trim()).filter(Boolean).join(' — ') || undefined;
  return {
    day: session.sessionTime?.date ? [session.sessionTime.date] : [],
    track: session.tracks ?? [],
    type: session.type ? [session.type] : [],
    level: session.level ? [session.level] : [],
    location: location ? [location] : [],
  };
}

/** Brute-force oracle: AND-across categories/facets, OR-within each. */
function oracleMatches(
  session: Session,
  categories: Categories,
  facets: Partial<Record<FacetName, string[]>>,
): boolean {
  const cats = sessionCategoryValues(session);
  for (const key of Object.keys(cats) as (keyof Categories)[]) {
    const selected = categories[key];
    if (selected && selected.length > 0 && !selected.some((v) => cats[key].includes(v))) {
      return false;
    }
  }
  for (const name of FACET_NAMES) {
    const selected = facets[name];
    const have = session[name] ?? [];
    if (selected && selected.length > 0 && !selected.some((v) => have.includes(v))) {
      return false;
    }
  }
  return true;
}

/** Arbitrary filter selections drawn from the value pools the catalog uses. */
const filterArb = fc.record({
  day: fc.array(fc.constantFrom('2026-11-30', '2026-12-01', '2026-12-02'), { maxLength: 2 }),
  track: fc.array(fc.constantFrom('AI/ML', 'Compute', 'Security'), { maxLength: 2 }),
  type: fc.array(fc.constantFrom('Breakout', 'Workshop'), { maxLength: 2 }),
  level: fc.array(fc.constantFrom('100', '300'), { maxLength: 2 }),
  topics: fc.array(fc.constantFrom('a', 'b'), { maxLength: 2 }),
});

describe('Feature: reinvent-commander, Property 4', () => {
  it('matches the brute-force OR-within / AND-across oracle', () => {
    fc.assert(
      fc.property(catalogArb(0, 25), filterArb, (sessions, f) => {
        const index = buildSearchIndex(sessions);
        const categories: Categories = { day: f.day, track: f.track, type: f.type, level: f.level };
        const facets: Partial<Record<FacetName, string[]>> = { topics: f.topics };

        const result = runQuery(index, stateOf(categories, facets));
        const resultIds = new Set(result.rows.map((r) => r.sessionId));

        sessions.forEach((session) => {
          expect(resultIds.has(session.sessionId)).toBe(
            oracleMatches(session, categories, facets),
          );
        });
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is monotonic: adding a selection never grows the result set', () => {
    fc.assert(
      fc.property(catalogArb(0, 25), filterArb, (sessions, f) => {
        const index = buildSearchIndex(sessions);

        const before = runQuery(index, stateOf({ track: f.track }, {}));
        // Add a further category selection (type) on top.
        const after = runQuery(index, stateOf({ track: f.track, type: f.type }, {}));

        const beforeIds = new Set(before.rows.map((r) => r.sessionId));
        // Result is non-increasing and a subset of the looser query.
        expect(after.rows.length).toBeLessThanOrEqual(before.rows.length);
        for (const row of after.rows) {
          expect(beforeIds.has(row.sessionId)).toBe(true);
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
