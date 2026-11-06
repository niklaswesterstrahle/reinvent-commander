// Property test for the time-of-day bucket partition (Catalog_Tree).
//
// Feature: reinvent-commander, Property 20
//
// Property 20: bucketOf partitions a day's sessions. For any array of sessions,
// each session maps to exactly one bucket, and the multiset union of all five
// buckets equals the input array (no session dropped or duplicated). This is
// what lets the day → time-of-day drill-down reuse the day's rows without loss.
//
// Validates: Requirement 17 (folder navigation; day drills into time buckets).
// Runs at >= 100 iterations over generated session arrays.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Session } from '@reinvent-commander/shared';
import { bucketOf, TIME_BUCKET_ORDER, type TimeBucket } from './timeBuckets.js';

const PROPERTY_RUNS = 200;

/** A session with just enough shape to carry an optional start time. */
const timedSessionArb: fc.Arbitrary<Session> = fc
  .record({
    id: fc.integer({ min: 0, max: 100000 }),
    // A mix of valid times across every bucket plus unparseable/missing ones.
    time: fc.oneof(
      fc.constantFrom('00:00', '11:59', '12:00', '13:59', '14:00', '17:59', '18:00', '23:59'),
      fc.constantFrom('bad', '24:00', '12:60', ''),
      fc.constant(undefined),
    ),
  })
  .map(({ id, time }): Session => {
    const session: Session = { sessionId: `s-${id}`, title: `s-${id}` };
    if (time !== undefined) {
      session.sessionTime = { date: '2026-11-30', time, length: '60' };
    }
    return session;
  });

describe('Feature: reinvent-commander, Property 20', () => {
  it('partitions a day into buckets with no loss or duplication', () => {
    fc.assert(
      fc.property(fc.array(timedSessionArb, { maxLength: 40 }), (sessions) => {
        const partition = new Map<TimeBucket, Session[]>();
        for (const bucket of TIME_BUCKET_ORDER) partition.set(bucket, []);

        for (const session of sessions) {
          const bucket = bucketOf(session.sessionTime?.time);
          partition.get(bucket)!.push(session);
        }

        // Each session lands in exactly one bucket (count across buckets == 1).
        for (const session of sessions) {
          const hits = TIME_BUCKET_ORDER.filter((b) =>
            partition.get(b)!.includes(session),
          ).length;
          expect(hits).toBe(1);
        }

        // Union of buckets equals the input (same size).
        const total = TIME_BUCKET_ORDER.reduce((n, b) => n + partition.get(b)!.length, 0);
        expect(total).toBe(sessions.length);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
