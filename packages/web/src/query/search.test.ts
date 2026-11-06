// Property test for search over the indexed fields and the session day.
//
// Feature: reinvent-commander, Property 3: Search is case-insensitive matching
// over the normalized haystack (title + abbreviation + abstract + speaker
// names) OR a Day_Term match against the session's derived day; a term and its
// upper/lower-case variants produce identical result sets.

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import type { QueryState } from '@reinvent-commander/shared';
import { buildSearchIndex } from './searchIndex.js';
import { runQuery } from './queryEngine.js';
import { matchesDay, parseDayTerm } from './dayMatching.js';
import { catalogArb } from './testArbitraries.js';

const NUM_RUNS = 150;

const baseState = (term: string): QueryState => ({
  term,
  categories: {},
  facets: {},
  sortDir: 'asc',
});

/** A pool of search terms exercising haystack substrings and Day_Terms. */
const termArb = fc.oneof(
  fc.constantFrom('serverless', 'ml', 'AIM200', 'Ada', 'security', 'depth', 'keynote'),
  fc.constantFrom('monday', 'MON', 'Tuesday', 'dec 1', '2026-12-01', '30'),
  fc.constantFrom('', '   ', 'zzz-no-match'),
);

describe('Feature: reinvent-commander, Property 3', () => {
  it('matches haystack substring OR the session day, case-insensitively', () => {
    fc.assert(
      fc.property(catalogArb(0, 25), termArb, (sessions, term) => {
        const index = buildSearchIndex(sessions);
        const result = runQuery(index, baseState(term));
        const resultIds = new Set(result.rows.map((r) => r.sessionId));

        const q = term.trim().toLowerCase();
        const dayTerm = parseDayTerm(q);

        // Oracle: a session is in the result iff haystack substring OR day match.
        sessions.forEach((session, i) => {
          const idx = index.indexed[i];
          const haystackHit = q === '' || idx.haystack.includes(q);
          const dayHit = q !== '' && dayTerm ? matchesDay(idx.day, q) : false;
          const expected = haystackHit || dayHit;
          expect(resultIds.has(session.sessionId)).toBe(expected);
        });
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is case-insensitive: a term and its case variants produce identical result sets', () => {
    fc.assert(
      fc.property(
        catalogArb(0, 25),
        fc.constantFrom('Serverless', 'MONDAY', 'Aim200', 'Dec 1', 'SECURITY'),
        (sessions, term) => {
          const index = buildSearchIndex(sessions);
          const ids = (t: string) =>
            new Set(runQuery(index, baseState(t)).rows.map((r) => r.sessionId));
          const upper = ids(term.toUpperCase());
          const lower = ids(term.toLowerCase());
          expect(upper).toEqual(lower);
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
