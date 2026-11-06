// Property test for empty-query identity and no-match retention.
//
// Feature: reinvent-commander, Property 6: An empty/whitespace-only term with
// no active filters or facets returns exactly the full catalog as a set; and a
// term/filter combination that matches nothing returns an empty result while
// the submitted QueryState is retained unchanged.

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import type { QueryState } from '@reinvent-commander/shared';
import { buildSearchIndex } from './searchIndex.js';
import { runQuery } from './queryEngine.js';
import { catalogArb } from './testArbitraries.js';

const NUM_RUNS = 150;

describe('Feature: reinvent-commander, Property 6', () => {
  it('empty/whitespace term with no filters is the identity over the catalog', () => {
    fc.assert(
      fc.property(catalogArb(0, 30), fc.constantFrom('', '   ', '\t'), (sessions, blank) => {
        const index = buildSearchIndex(sessions);
        const state: QueryState = { term: blank, categories: {}, facets: {}, sortDir: 'asc' };
        const result = runQuery(index, state);

        expect(result.matching).toBe(sessions.length);
        expect(result.total).toBe(sessions.length);
        expect(new Set(result.rows.map((r) => r.sessionId))).toEqual(
          new Set(sessions.map((s) => s.sessionId)),
        );
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a no-match query returns empty and retains the submitted QueryState unchanged', () => {
    fc.assert(
      fc.property(catalogArb(0, 30), (sessions) => {
        const index = buildSearchIndex(sessions);
        const state: QueryState = {
          term: 'definitely-no-such-session-xyzzy',
          categories: { track: ['NoSuchTrack'] },
          facets: {},
          sortField: 'code',
          sortDir: 'asc',
        };
        const snapshot = JSON.parse(JSON.stringify(state));
        const result = runQuery(index, state);

        expect(result.matching).toBe(0);
        expect(result.rows).toEqual([]);
        expect(result.total).toBe(sessions.length);
        // The submitted state is retained unchanged (the engine never mutates it).
        expect(state).toEqual(snapshot);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
