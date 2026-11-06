// Property test for session reachability through the folder tree (Catalog_Tree).
//
// Feature: reinvent-commander, Property 17
//
// Property 17: every session is reachable via each top-level dimension it
// carries a value for. For any catalog and any top-level dimension present in
// it, descending dimension → value (→ time-of-day for the day dimension) yields
// a leaf level whose files include every session carrying that value. The tree
// never hides a session that matches the path it is reached by.
//
// Validates: Requirements 17.1, 17.2, 17.3 (data-derived dimensions/values;
// tree is a faithful front-end to the Query_Engine). Runs at >= 100 iterations.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Session } from '@reinvent-commander/shared';
import { buildSearchIndex } from '../../query/searchIndex.js';
import { catalogArb } from '../../query/testArbitraries.js';
import { buildTreeLevel } from './buildLevel.js';
import { encodeTypeLevel, TOP_LEVEL_DIMENSIONS, type DimensionId } from './dimensions.js';
import { bucketOf } from './timeBuckets.js';
import type { Path, SortSpec } from './pathState.js';

const PROPERTY_RUNS = 150;
const SORT: SortSpec = { sortDir: 'asc' };

/** The value a session carries for a dimension (empty when it carries none). */
function sessionValue(dimension: DimensionId, session: Session): string[] {
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
    case 'timeOfDay':
      return [];
  }
}

/** Collect the sessionIds of the file entries in a built level. */
function fileIds(index: ReturnType<typeof buildSearchIndex>, path: Path): Set<string> {
  const level = buildTreeLevel(index, path, SORT);
  const ids = new Set<string>();
  for (const e of level.entries) if (e.kind === 'file') ids.add(e.session.sessionId);
  return ids;
}

describe('Feature: reinvent-commander, Property 17', () => {
  it('reaches every session via each dimension value it carries', () => {
    fc.assert(
      fc.property(catalogArb(0, 20), (sessions) => {
        const index = buildSearchIndex(sessions);

        for (const dimension of TOP_LEVEL_DIMENSIONS) {
          for (const session of sessions) {
            const values = sessionValue(dimension, session);
            if (values.length === 0) continue;

            for (const value of values) {
              if (dimension === 'day') {
                // day → <date> → time-of-day bucket of the session.
                const bucket = bucketOf(session.sessionTime?.time);
                const leaf: Path = [
                  { dimension: 'day', value },
                  { dimension: 'timeOfDay', value: bucket },
                ];
                expect(fileIds(index, leaf).has(session.sessionId)).toBe(true);
              } else {
                const leaf: Path = [{ dimension, value }];
                expect(fileIds(index, leaf).has(session.sessionId)).toBe(true);
              }
            }
          }
        }
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('only lists present dimensions at the root (absent ones omitted)', () => {
    fc.assert(
      fc.property(catalogArb(0, 20), (sessions) => {
        const index = buildSearchIndex(sessions);
        const rootDims = buildTreeLevel(index, [], SORT).entries.flatMap((e) =>
          e.kind === 'folder' ? [e.dimension] : [],
        );
        for (const dimension of TOP_LEVEL_DIMENSIONS) {
          const present = sessions.some((s) => sessionValue(dimension, s).length > 0);
          expect(rootDims.includes(dimension)).toBe(present);
        }
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
