// Property test for wall-clock datetime format/parse.
//
// Feature: reinvent-commander, Property 10: formatting year/month/day/hour/
// minute then parsing the result round-trips to the same components, and the
// formatted string carries no trailing Z / no offset with seconds "00".

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import { formatWallClock, parseWallClock } from './datetime.js';

const NUM_RUNS = 200;

/** An arbitrary that yields a real calendar date plus a valid time. */
const wallClockPartsArb = fc
  .date({ min: new Date(Date.UTC(2000, 0, 1)), max: new Date(Date.UTC(2099, 11, 31)) })
  .chain((d) =>
    fc.record({
      year: fc.constant(d.getUTCFullYear()),
      month: fc.constant(d.getUTCMonth() + 1),
      day: fc.constant(d.getUTCDate()),
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
    }),
  );

describe('Feature: reinvent-commander, Property 10', () => {
  it('formats to wall-clock YYYY-MM-DDTHH:MM:00 and round-trips through parse', () => {
    fc.assert(
      fc.property(wallClockPartsArb, (parts) => {
        const formatted = formatWallClock(parts);

        // Wall-clock shape: no Z, no offset, seconds "00".
        expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(formatted)).toBe(true);
        expect(formatted.includes('Z')).toBe(false);
        expect(formatted.includes('+')).toBe(false);

        const parsed = parseWallClock(formatted);
        expect(parsed).toBeDefined();
        expect(parsed!.year).toBe(parts.year);
        expect(parsed!.month).toBe(parts.month);
        expect(parsed!.day).toBe(parts.day);
        expect(parsed!.hour).toBe(parts.hour);
        expect(parsed!.minute).toBe(parts.minute);
        expect(parsed!.totalMinutes).toBe(parts.hour * 60 + parts.minute);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects values with a Z, an offset, or non-zero seconds', () => {
    fc.assert(
      fc.property(wallClockPartsArb, (parts) => {
        const base = formatWallClock(parts);
        expect(parseWallClock(`${base}Z`)).toBeUndefined();
        expect(parseWallClock(`${base}+00:00`)).toBeUndefined();
        expect(parseWallClock(base.replace(/:00$/, ':30'))).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
