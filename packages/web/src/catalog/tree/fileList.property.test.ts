// Property test for the file list shown at EVERY tree level (Catalog_Tree).
//
// Feature: reinvent-commander, Requirement 17 criterion 4
//
// Like a real filesystem, every level shows its child folders on top AND the
// Session_Files matching the accumulated path below them — never hidden until a
// leaf. These properties pin that behaviour:
//   - Root: the file set is the WHOLE catalog (empty predicate).
//   - A dimension-pick (trailing sentinel) does NOT narrow the file set — it
//     equals the file set of its ancestor level.
//   - A concrete-value path's file set equals the Query_Engine result for the
//     accumulated predicates (bucket-filtered for a time-of-day leaf).
//   - Descending a concrete value monotonically shrinks (or holds) the count.
//
// Validates: Requirement 17 (tree reuses runQuery as the single filter
// authority, files present at every level). Runs at >= 100 iterations.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Session } from '@reinvent-commander/shared';
import { runQuery } from '../../query/queryEngine.js';
import { buildSearchIndex, type SearchIndex } from '../../query/searchIndex.js';
import { catalogArb } from '../../query/testArbitraries.js';
import { buildTreeLevel, DIMENSION_SENTINEL } from './buildLevel.js';
import { encodeTypeLevel, TOP_LEVEL_DIMENSIONS, type DimensionId } from './dimensions.js';
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

/** The sessionIds of the file entries in the level built for `path`. */
function fileIds(index: SearchIndex, path: Path): Set<string> {
  const level = buildTreeLevel(index, path, SORT);
  return new Set(level.entries.flatMap((e) => (e.kind === 'file' ? [e.session.sessionId] : [])));
}

/** Every valid path reachable in the catalog, at all depths (root added separately). */
function candidatePaths(index: SearchIndex): Path[] {
  const paths: Path[] = [];
  const dims = TOP_LEVEL_DIMENSIONS as readonly Exclude<DimensionId, 'timeOfDay'>[];
  for (const dimension of dims) {
    const values = new Set<string>();
    for (const s of index.sessions) for (const v of sessionValue(dimension, s)) values.add(v);
    if (values.size === 0) continue;
    paths.push([{ dimension, value: DIMENSION_SENTINEL }]);
    for (const value of values) {
      paths.push([{ dimension, value }]);
      if (dimension === 'day') {
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
      }
    }
  }
  return paths;
}

/** Expected file set for a path: runQuery rows, bucket-filtered for a time leaf. */
function expectedIds(index: SearchIndex, path: Path): Set<string> {
  const last = path[path.length - 1];
  const queryPath = last && last.value === DIMENSION_SENTINEL ? path.slice(0, -1) : path;
  const rows = runQuery(index, pathToQueryState(queryPath, SORT)).rows;
  const filtered =
    last && last.dimension === 'timeOfDay'
      ? rows.filter((s) => bucketOf(s.sessionTime?.time) === last.value)
      : rows;
  return new Set(filtered.map((s) => s.sessionId));
}

describe('Feature: reinvent-commander, Requirement 17.4', () => {
  it('shows every session as files at the root (empty predicate)', () => {
    fc.assert(
      fc.property(catalogArb(0, 20), (sessions) => {
        const index = buildSearchIndex(sessions);
        const ids = fileIds(index, []);
        expect(ids).toEqual(new Set(sessions.map((s) => s.sessionId)));
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('a dimension-pick (sentinel) does not narrow the file set', () => {
    fc.assert(
      fc.property(catalogArb(0, 20), (sessions) => {
        const index = buildSearchIndex(sessions);
        const all = fileIds(index, []);
        for (const dimension of TOP_LEVEL_DIMENSIONS) {
          if (dimension === 'timeOfDay') continue;
          const present = sessions.some((s) => sessionValue(dimension, s).length > 0);
          if (!present) continue;
          const picked = fileIds(index, [{ dimension, value: DIMENSION_SENTINEL }]);
          expect(picked).toEqual(all);
        }
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('a path file set equals the Query_Engine result for its predicates', () => {
    fc.assert(
      fc.property(catalogArb(1, 20), fc.integer({ min: 0, max: 1000 }), (sessions, pick) => {
        const index = buildSearchIndex(sessions);
        const paths = candidatePaths(index);
        if (paths.length === 0) return;
        const path = paths[pick % paths.length];
        expect(fileIds(index, path)).toEqual(expectedIds(index, path));
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('descending a concrete value monotonically shrinks (or holds) the count', () => {
    fc.assert(
      fc.property(catalogArb(1, 20), fc.integer({ min: 0, max: 1000 }), (sessions, pick) => {
        const index = buildSearchIndex(sessions);
        const dims = TOP_LEVEL_DIMENSIONS as readonly Exclude<DimensionId, 'timeOfDay'>[];
        const dayDims = dims.filter((d) => sessions.some((s) => sessionValue(d, s).length > 0));
        if (dayDims.length === 0) return;
        const dimension = dayDims[pick % dayDims.length];

        const rootCount = fileIds(index, []).size;
        // root >= dimension-pick (equal) >= a concrete value.
        const pickCount = fileIds(index, [{ dimension, value: DIMENSION_SENTINEL }]).size;
        expect(pickCount).toBe(rootCount);

        const values = new Set<string>();
        for (const s of index.sessions) for (const v of sessionValue(dimension, s)) values.add(v);
        for (const value of values) {
          const valueCount = fileIds(index, [{ dimension, value }]).size;
          expect(valueCount).toBeLessThanOrEqual(pickCount);
          // Day narrows further into a time-of-day bucket.
          if (dimension === 'day') {
            const buckets = new Set<TimeBucket>();
            for (const s of index.sessions) {
              if (s.sessionTime?.date === value) buckets.add(bucketOf(s.sessionTime?.time));
            }
            for (const bucket of buckets) {
              const bucketCount = fileIds(index, [
                { dimension: 'day', value },
                { dimension: 'timeOfDay', value: bucket },
              ]).size;
              expect(bucketCount).toBeLessThanOrEqual(valueCount);
            }
          }
        }
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
