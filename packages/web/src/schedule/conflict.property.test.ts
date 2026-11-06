// Property test for schedule conflict detection.
//
// Feature: reinvent-commander, Property 11: an item is flagged as conflicting
// iff its resolved half-open [startMs, endMs) interval intersects at least one
// OTHER resolved item's interval. Unresolvable/all-day items carry no interval
// and never conflict. Verified against a brute-force all-pairs overlap oracle.

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import type { PersonalTime, Session } from '@reinvent-commander/shared';

import { formatWallClock } from './datetime.js';
import {
  detectScheduleConflicts,
  resolvePersonalTimeInterval,
  resolveSessionInterval,
  type ResolvedInterval,
} from './conflict.js';

const NUM_RUNS = 200;

const FIXTURE_DATE = '2026-12-01';

/** An arbitrary session: sometimes timed, sometimes all-day, sometimes unresolvable. */
const sessionArb = (id: string) =>
  fc
    .record({
      kind: fc.constantFrom('timed', 'allDay', 'noLength'),
      startMin: fc.integer({ min: 0, max: 23 * 60 }),
      length: fc.integer({ min: 5, max: 180 }),
    })
    .map(({ kind, startMin, length }): Session => {
      const time = `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(
        startMin % 60,
      ).padStart(2, '0')}`;
      if (kind === 'allDay') {
        return {
          sessionId: id,
          title: id,
          isAllDaySession: true,
          sessionTime: { date: FIXTURE_DATE, time, length: String(length) },
        };
      }
      if (kind === 'noLength') {
        return {
          sessionId: id,
          title: id,
          sessionTime: { date: FIXTURE_DATE, time, length: 'NaN' },
        };
      }
      return {
        sessionId: id,
        title: id,
        sessionTime: { date: FIXTURE_DATE, time, length: String(length) },
      };
    });

/** An arbitrary personal-time block, sometimes malformed. */
const personalTimeArb = (id: string) =>
  fc
    .record({
      valid: fc.boolean(),
      startMin: fc.integer({ min: 0, max: 23 * 60 }),
      length: fc.integer({ min: 5, max: 180 }),
    })
    .map(({ valid, startMin, length }): PersonalTime => {
      const start = formatWallClock({
        year: 2026,
        month: 12,
        day: 1,
        hour: Math.floor(startMin / 60),
        minute: startMin % 60,
      });
      const endMinTotal = startMin + length;
      const end = valid
        ? formatWallClock({
            year: 2026,
            month: 12,
            day: 1,
            hour: Math.floor(endMinTotal / 60) % 24,
            minute: endMinTotal % 60,
          })
        : 'not-a-datetime';
      return {
        personalTimeId: id,
        startDateTime: start,
        endDateTime: end,
        title: id,
        description: 'd',
      };
    });

/** Brute-force oracle: all-pairs half-open overlap over the resolved intervals. */
function oracleConflicts(intervals: ResolvedInterval[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = 0; j < intervals.length; j += 1) {
      if (i === j) continue;
      const a = intervals[i];
      const b = intervals[j];
      if (a.startMs < b.endMs && b.startMs < a.endMs) {
        out.add(a.id);
      }
    }
  }
  return out;
}

describe('Feature: reinvent-commander, Property 11', () => {
  it('flags exactly the items overlapping another resolved item (half-open, symmetric)', () => {
    fc.assert(
      fc.property(
        fc.array(sessionArb('s'), { minLength: 0, maxLength: 6 }).map((arr) =>
          arr.map((s, i) => ({ ...s, sessionId: `s${i}` })),
        ),
        fc.array(personalTimeArb('p'), { minLength: 0, maxLength: 4 }).map((arr) =>
          arr.map((p, i) => ({ ...p, personalTimeId: `p${i}` })),
        ),
        (sessions, personalTime) => {
          const resolved: ResolvedInterval[] = [];
          for (const s of sessions) {
            const r = resolveSessionInterval(s);
            if (r) resolved.push(r);
          }
          for (const p of personalTime) {
            const r = resolvePersonalTimeInterval(p);
            if (r) resolved.push(r);
          }

          const expected = oracleConflicts(resolved);
          const actual = detectScheduleConflicts(sessions, personalTime);

          expect([...actual].sort()).toEqual([...expected].sort());

          // No unresolvable/all-day id can appear in the result.
          const resolvableIds = new Set(resolved.map((r) => r.id));
          for (const id of actual) {
            expect(resolvableIds.has(id)).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
