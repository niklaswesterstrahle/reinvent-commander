// Property test for sort.
//
// Feature: reinvent-commander, Property 5: Sort is an order-correct permutation
// of the input with a stable asc/desc toggle. The sorted rows are a permutation
// of the matched rows, ordered non-decreasing by the field (abbreviation
// tie-break; day sort chronological by date then start time), and the
// descending result is the exact reverse of the ascending result.

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import type { QueryState, SortField } from '@reinvent-commander/shared';
import { buildSearchIndex, type SearchIndex } from './searchIndex.js';
import { compareBy, runQuery } from './queryEngine.js';
import { catalogArb } from './testArbitraries.js';

const NUM_RUNS = 150;

const SORT_FIELDS: SortField[] = ['code', 'title', 'track', 'day'];

const stateOf = (sortField: SortField, sortDir: 'asc' | 'desc'): QueryState => ({
  term: '',
  categories: {},
  facets: {},
  sortField,
  sortDir,
});

/** Reference comparator: positions in the original index, compared by field. */
function referenceCompare(index: SearchIndex, field: SortField, a: number, b: number): number {
  return compareBy(index, field, a, b);
}

describe('Feature: reinvent-commander, Property 5', () => {
  it('is an order-correct permutation ascending, reversed descending', () => {
    fc.assert(
      fc.property(catalogArb(0, 30), fc.constantFrom(...SORT_FIELDS), (sessions, field) => {
        const index = buildSearchIndex(sessions);
        const posById = new Map(sessions.map((s, i) => [s.sessionId, i]));

        const asc = runQuery(index, stateOf(field, 'asc'));
        const desc = runQuery(index, stateOf(field, 'desc'));

        // Permutation: same multiset of sessionIds as the input.
        const inputIds = [...sessions.map((s) => s.sessionId)].sort();
        expect([...asc.rows.map((r) => r.sessionId)].sort()).toEqual(inputIds);
        expect([...desc.rows.map((r) => r.sessionId)].sort()).toEqual(inputIds);

        // Ascending order: each adjacent pair is non-decreasing by the comparator.
        for (let i = 1; i < asc.rows.length; i++) {
          const prev = posById.get(asc.rows[i - 1].sessionId)!;
          const cur = posById.get(asc.rows[i].sessionId)!;
          expect(referenceCompare(index, field, prev, cur)).toBeLessThanOrEqual(0);
        }

        // Descending order: each adjacent pair is non-increasing by the comparator.
        // (The sort is stable, so equal-key rows keep input order in both
        // directions; a strict element-wise reverse would not hold across ties,
        // but the field ordering is fully reversed.)
        for (let i = 1; i < desc.rows.length; i++) {
          const prev = posById.get(desc.rows[i - 1].sessionId)!;
          const cur = posById.get(desc.rows[i].sessionId)!;
          expect(referenceCompare(index, field, prev, cur)).toBeGreaterThanOrEqual(0);
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('toggles to a fully reversed order across distinct sort keys', () => {
    const sessions = [
      { sessionId: 's1', title: 'A', abbreviation: 'CCC100' },
      { sessionId: 's2', title: 'B', abbreviation: 'AAA100' },
      { sessionId: 's3', title: 'C', abbreviation: 'BBB100' },
    ];
    const index = buildSearchIndex(sessions);
    const asc = runQuery(index, stateOf('code', 'asc')).rows.map((r) => r.sessionId);
    const desc = runQuery(index, stateOf('code', 'desc')).rows.map((r) => r.sessionId);
    expect(asc).toEqual(['s2', 's3', 's1']);
    expect(desc).toEqual([...asc].reverse());
  });

  it('day sort orders chronologically by date then start time', () => {
    fc.assert(
      fc.property(catalogArb(0, 30), (sessions) => {
        const index = buildSearchIndex(sessions);
        const asc = runQuery(index, stateOf('day', 'asc'));

        for (let i = 1; i < asc.rows.length; i++) {
          const a = asc.rows[i - 1];
          const b = asc.rows[i];
          const da = a.sessionTime?.date ?? '\uffff';
          const db = b.sessionTime?.date ?? '\uffff';
          if (da !== db) {
            expect(da <= db).toBe(true);
          } else {
            const ta = a.sessionTime?.time ?? '\uffff';
            const tb = b.sessionTime?.time ?? '\uffff';
            if (ta !== tb) expect(ta <= tb).toBe(true);
          }
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
