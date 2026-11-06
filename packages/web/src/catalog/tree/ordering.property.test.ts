// Property test for tree-level entry ordering (Catalog_Tree).
//
// Feature: reinvent-commander, Property 19
//
// Property 19: in every built level, every folder entry precedes every file
// entry, and the ".." parent is the first entry on any non-root level (and
// never present at the root). This is the Norton-Commander ordering invariant
// the renderer relies on.
//
// Validates: Requirement 17.1 (folders before files; ".." ascend row). Runs at
// >= 100 iterations over generated catalogs and valid paths.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Session } from '@reinvent-commander/shared';
import { buildSearchIndex, type SearchIndex } from '../../query/searchIndex.js';
import { catalogArb } from '../../query/testArbitraries.js';
import { buildTreeLevel, DIMENSION_SENTINEL } from './buildLevel.js';
import { encodeTypeLevel, TOP_LEVEL_DIMENSIONS, type DimensionId } from './dimensions.js';
import { bucketOf, type TimeBucket } from './timeBuckets.js';
import type { Path, SortSpec } from './pathState.js';

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

/**
 * Every valid path reachable in the catalog, at all depths: root dimension
 * picks (sentinel), chosen values, day → time-of-day. The empty root path is
 * added by the caller.
 */
function candidatePaths(index: SearchIndex): Path[] {
  const paths: Path[] = [];
  const dims = TOP_LEVEL_DIMENSIONS as readonly Exclude<DimensionId, 'timeOfDay'>[];
  for (const dimension of dims) {
    const values = new Set<string>();
    for (const s of index.sessions) for (const v of sessionValue(dimension, s)) values.add(v);
    if (values.size === 0) continue;
    paths.push([{ dimension, value: DIMENSION_SENTINEL }]); // dimension picked
    for (const value of values) {
      paths.push([{ dimension, value }]); // value chosen (leaf or day→buckets)
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

/** Assert the folders-before-files + ".."-first invariant on a level's entries. */
function assertOrdering(entries: ReturnType<typeof buildTreeLevel>['entries'], nonRoot: boolean) {
  if (nonRoot) {
    expect(entries[0]?.kind).toBe('parent');
  } else {
    expect(entries.some((e) => e.kind === 'parent')).toBe(false);
  }
  const lastFolder = entries.map((e) => e.kind).lastIndexOf('folder');
  const firstFile = entries.findIndex((e) => e.kind === 'file');
  if (lastFolder !== -1 && firstFile !== -1) {
    expect(lastFolder).toBeLessThan(firstFile);
  }
}

describe('Feature: reinvent-commander, Property 19', () => {
  it('orders ".." first, then folders, then files, at every level', () => {
    fc.assert(
      fc.property(
        catalogArb(0, 20),
        fc.integer({ min: 0, max: 1000 }),
        (sessions, pick) => {
          const index = buildSearchIndex(sessions);

          // Root level always holds.
          assertOrdering(buildTreeLevel(index, [], SORT).entries, false);

          const paths = candidatePaths(index);
          if (paths.length === 0) return;
          const path = paths[pick % paths.length];
          assertOrdering(buildTreeLevel(index, path, SORT).entries, true);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
