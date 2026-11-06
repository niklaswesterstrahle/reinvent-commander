// Property test for the folder/Query_Engine equivalence (Catalog_Tree).
//
// Feature: reinvent-commander, Property 18
//
// Property 18: a leaf folder's file set equals the Query_Engine result for its
// path. For any catalog and any valid leaf path, the sessionIds of the file
// entries produced by buildTreeLevel equal the sessionIds of
// runQuery(index, pathToQueryState(path)).rows — bucket-filtered by bucketOf
// when the path ends in a time-of-day step. The tree adds no filtering of its
// own beyond the single virtual time bucket; it is exactly the engine's result.
//
// Validates: Requirement 17 (tree reuses runQuery as the single filter
// authority). Runs at >= 100 iterations.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Session } from '@reinvent-commander/shared';
import { runQuery } from '../../query/queryEngine.js';
import { buildSearchIndex, type SearchIndex } from '../../query/searchIndex.js';
import { catalogArb } from '../../query/testArbitraries.js';
import { buildTreeLevel } from './buildLevel.js';
import { encodeTypeLevel, type DimensionId } from './dimensions.js';
import { bucketOf, type TimeBucket } from './timeBuckets.js';
import { pathToQueryState, type Path, type SortSpec } from './pathState.js';

const PROPERTY_RUNS = 150;
const SORT: SortSpec = { sortDir: 'asc' };

/** The value a session carries for a dimension. */
function sessionValue(dimension: Exclude<DimensionId, 'timeOfDay'>, session: Session): string[] {
  switch (dimension) {
    case 'day':
      return session.sessionTime?.date ? [session.sessionTime.date] : [];
    case 'track':
      return session.tracks ?? [];
    case 'topic':
      return session.topics ?? [];
    case 'services':
      return session.services ?? [];
    case 'typeLevel':
      return session.type || session.level
        ? [encodeTypeLevel(session.type ?? '', session.level ?? '')]
        : [];
  }
}

/** All distinct (dimension, value) leaf paths derivable from the catalog. */
function candidateLeafPaths(index: SearchIndex): Path[] {
  const paths: Path[] = [];
  const dims: Array<Exclude<DimensionId, 'timeOfDay'>> = [
    'day',
    'track',
    'typeLevel',
    'topic',
    'services',
  ];
  for (const dimension of dims) {
    const values = new Set<string>();
    for (const s of index.sessions) for (const v of sessionValue(dimension, s)) values.add(v);
    for (const value of values) {
      if (dimension === 'day') {
        // Day leaf is the time-of-day level; descend one more into each bucket.
        const buckets = new Set<TimeBucket>();
        for (const s of index.sessions) {
          if (s.sessionTime?.date === value) buckets.add(bucketOf(s.sessionTime?.time));
        }
        for (const bucket of buckets) {
          paths.push([
            { dimension: 'day', value },
            { dimension: 'timeOfDay', value: bucket },
          ]);
        }
      } else {
        paths.push([{ dimension, value }]);
      }
    }
  }
  return paths;
}

/** Expected file set for a leaf path: runQuery rows, bucket-filtered for day. */
function expectedIds(index: SearchIndex, path: Path): Set<string> {
  const rows = runQuery(index, pathToQueryState(path, SORT)).rows;
  const last = path[path.length - 1];
  const filtered =
    last.dimension === 'timeOfDay'
      ? rows.filter((s) => bucketOf(s.sessionTime?.time) === last.value)
      : rows;
  return new Set(filtered.map((s) => s.sessionId));
}

describe('Feature: reinvent-commander, Property 18', () => {
  it('a leaf folder file set equals the Query_Engine result for its path', () => {
    fc.assert(
      fc.property(
        catalogArb(1, 20),
        fc.integer({ min: 0, max: 1000 }),
        (sessions, pick) => {
          const index = buildSearchIndex(sessions);
          const paths = candidateLeafPaths(index);
          if (paths.length === 0) return; // nothing to drill into
          const path = paths[pick % paths.length];

          const level = buildTreeLevel(index, path, SORT);
          const actual = new Set(
            level.entries.flatMap((e) => (e.kind === 'file' ? [e.session.sessionId] : [])),
          );
          expect(actual).toEqual(expectedIds(index, path));
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
