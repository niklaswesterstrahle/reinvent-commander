// Property test for personal-time input validation.
//
// Feature: reinvent-commander, Property 9: a PersonalTimeInput validates iff
// end is strictly after start on the SAME calendar date, the duration is a
// whole 5-minute increment, title is 1–128, description is 1–250, and location
// (when present) is 1–255. The per-field result and the boolean agree.

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import type { PersonalTimeInput } from '@reinvent-commander/shared';

import { formatWallClock } from './datetime.js';
import {
  DESCRIPTION_MAX,
  LOCATION_MAX,
  PERSONAL_TIME_INCREMENT_MINUTES,
  TITLE_MAX,
  isPersonalTimeValid,
  validatePersonalTime,
} from './personalTimeValidation.js';

const NUM_RUNS = 200;

const dateArb = fc
  .date({ min: new Date(Date.UTC(2020, 0, 1)), max: new Date(Date.UTC(2099, 11, 31)) })
  .map((d) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }));

/** A string of exactly `n` characters. */
const stringOfLength = (n: number) => 'x'.repeat(n);

/**
 * An oracle: compute validity independently from the raw inputs. Mirrors the
 * documented rules without reusing the module's control flow.
 */
function oracleValid(input: {
  sameDate: boolean;
  startMinutes: number;
  endMinutes: number;
  titleLen: number;
  descLen: number;
  locationLen: number | undefined;
}): boolean {
  if (!input.sameDate) return false;
  if (input.endMinutes <= input.startMinutes) return false;
  if ((input.endMinutes - input.startMinutes) % PERSONAL_TIME_INCREMENT_MINUTES !== 0) return false;
  if (input.titleLen < 1 || input.titleLen > TITLE_MAX) return false;
  if (input.descLen < 1 || input.descLen > DESCRIPTION_MAX) return false;
  if (input.locationLen !== undefined && (input.locationLen < 1 || input.locationLen > LOCATION_MAX))
    return false;
  return true;
}

describe('Feature: reinvent-commander, Property 9', () => {
  it('accepts iff all documented rules hold (agrees with an independent oracle)', () => {
    fc.assert(
      fc.property(
        dateArb,
        dateArb,
        fc.boolean(), // use same date (true) or distinct dates (false)
        fc.integer({ min: 0, max: 23 * 60 + 59 }), // start minutes
        fc.integer({ min: 0, max: 23 * 60 + 59 }), // end minutes
        fc.integer({ min: 0, max: 130 }), // title length
        fc.integer({ min: 0, max: 252 }), // description length
        fc.option(fc.integer({ min: 0, max: 257 }), { nil: undefined }), // location length
        (startDate, otherDate, useSameDate, startMin, endMin, titleLen, descLen, locLen) => {
          const endDate = useSameDate ? startDate : { ...otherDate, day: otherDate.day };
          // Ensure "distinct" really differs (bump the year when identical).
          const distinctEnd =
            useSameDate ||
            endDate.year !== startDate.year ||
            endDate.month !== startDate.month ||
            endDate.day !== startDate.day
              ? endDate
              : { ...endDate, year: endDate.year + 1 };
          const sameDate =
            startDate.year === distinctEnd.year &&
            startDate.month === distinctEnd.month &&
            startDate.day === distinctEnd.day;

          const input: PersonalTimeInput = {
            startDateTime: formatWallClock({
              ...startDate,
              hour: Math.floor(startMin / 60),
              minute: startMin % 60,
            }),
            endDateTime: formatWallClock({
              ...distinctEnd,
              hour: Math.floor(endMin / 60),
              minute: endMin % 60,
            }),
            title: stringOfLength(titleLen),
            description: stringOfLength(descLen),
            ...(locLen === undefined ? {} : { location: stringOfLength(locLen) }),
          };

          const expected = oracleValid({
            sameDate,
            startMinutes: startMin,
            endMinutes: endMin,
            titleLen,
            descLen,
            locationLen: locLen,
          });

          const errors = validatePersonalTime(input);
          expect(isPersonalTimeValid(input)).toBe(expected);
          expect(Object.keys(errors).length === 0).toBe(expected);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
