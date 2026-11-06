// Property test for the paginated catalog walk (Task 4.2)
//
// Feature: reinvent-commander, Property 2
//
// Property 2: Catalog walk reconstructs exactly the full unique session set.
// For any paginated catalog source partitioned into pages of up to 250 items
// with nextToken chaining and a reported totalCount, running the walk until no
// nextToken remains yields a session set whose sessionIds equal the union of
// all page items deduplicated by sessionId, and whose size equals totalCount.
//
// Validates: Requirements 4.1, 4.4. Runs against a MOCKED page source only
// (no real network), at >= 100 iterations.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Session } from '@reinvent-commander/shared';
import { PAGE_SIZE, walkCatalog, type PageFetcher, type PageResult } from './catalogWalk.js';

const PROPERTY_RUNS = 200;

function makeSession(id: string): Session {
  return { sessionId: id, title: `Session ${id}` };
}

/**
 * Build a mocked page fetcher over `sessions` partitioned into pages of up to
 * `pageSize` items, chained by opaque nextTokens. `totalCount` is reported on
 * every page as the full catalog size, as the API does.
 */
function mockPagedFetcher(sessions: Session[], pageSize: number): PageFetcher {
  const pages: Session[][] = [];
  for (let i = 0; i < sessions.length; i += pageSize) {
    pages.push(sessions.slice(i, i + pageSize));
  }
  // An empty catalog is still a single (empty) terminal page.
  if (pages.length === 0) pages.push([]);
  const totalCount = sessions.length;

  return (req) => {
    const index = req.nextToken ? Number(req.nextToken) : 0;
    const items = pages[index] ?? [];
    const hasMore = index < pages.length - 1;
    const result: PageResult = {
      items,
      totalCount,
      ...(hasMore ? { nextToken: String(index + 1) } : {}),
    };
    return Promise.resolve(result);
  };
}

describe('Feature: reinvent-commander, Property 2', () => {
  it('reconstructs exactly the full unique session set (size == totalCount)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A set of unique sessionIds; uniqueness models the API's by-sessionId
        // catalog. Sizes cross the 250 page boundary to exercise pagination.
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: 0,
          maxLength: 600,
        }),
        fc.integer({ min: 1, max: PAGE_SIZE }),
        async (ids, pageSize) => {
          const sessions = ids.map(makeSession);
          const fetcher = mockPagedFetcher(sessions, pageSize);

          const progress: number[] = [];
          const result = await walkCatalog({
            fetcher,
            onProgress: (p) => progress.push(p.retrieved),
          });

          const expected = new Set(ids);
          const actual = new Set(result.sessions.map((s) => s.sessionId));

          // Exactly the unique union, no more, no less.
          expect(actual).toEqual(expected);
          // Size equals the reported totalCount.
          expect(result.sessions.length).toBe(sessions.length);
          expect(result.totalCount).toBe(sessions.length);
          // Progress is monotonically non-decreasing and ends at the full size.
          for (let i = 1; i < progress.length; i += 1) {
            expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
          }
          expect(progress[progress.length - 1]).toBe(sessions.length);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('dedupes sessions that recur across overlapping pages', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
          minLength: 1,
          maxLength: 300,
        }),
        async (ids) => {
          const sessions = ids.map(makeSession);
          // Duplicate the whole catalog across pages: a session reappears on a
          // later page. The walk must still converge to the unique set.
          const doubled = [...sessions, ...sessions];
          // Chunk the doubled list into fixed pages and chain them.
          const fetcher = mockPagedFetcher(doubled, 50);

          const result = await walkCatalog({ fetcher });
          const actual = new Set(result.sessions.map((s) => s.sessionId));
          expect(actual).toEqual(new Set(ids));
          expect(result.sessions.length).toBe(ids.length);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
