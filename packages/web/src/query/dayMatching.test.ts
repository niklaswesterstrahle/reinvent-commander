// Property test for the data-derived day-matching module.
//
// Feature: reinvent-commander, Property 3a: Weekday is derived correctly from
// the date for any year, and a weekday Day_Term matches a session iff the
// session's derived weekday equals the named weekday — equally for the full
// name and its three-letter abbreviation.

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  WEEKDAY_ABBREVS,
  WEEKDAY_NAMES,
  conferenceDays,
  matchesDay,
  matchesDayTerm,
  parseDayTerm,
  weekdayAbbrev,
  weekdayOf,
  type WeekdayName,
} from './dayMatching.js';

const NUM_RUNS = 200;

/** Verified re:Invent 2026 dates — TEST FIXTURES ONLY, never production constants. */
const REINVENT_2026: { date: string; weekday: WeekdayName }[] = [
  { date: '2026-11-29', weekday: 'Sunday' }, // pre-event
  { date: '2026-11-30', weekday: 'Monday' },
  { date: '2026-12-01', weekday: 'Tuesday' },
  { date: '2026-12-02', weekday: 'Wednesday' },
  { date: '2026-12-03', weekday: 'Thursday' },
  { date: '2026-12-04', weekday: 'Friday' },
];

/** An arbitrary that yields a well-formed ISO date and its true weekday, for any year. */
const dateArb = fc
  .date({ min: new Date(Date.UTC(1900, 0, 1)), max: new Date(Date.UTC(2999, 11, 31)) })
  .map((d) => {
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
      day,
    ).padStart(2, '0')}`;
    return { iso, trueWeekday: WEEKDAY_NAMES[d.getUTCDay()] };
  });

describe('Feature: reinvent-commander, Property 3a', () => {
  it('derives the calendar weekday for any year and matches weekday terms (full == abbrev)', () => {
    fc.assert(
      fc.property(dateArb, fc.boolean(), (sample, useAbbrev) => {
        const derived = weekdayOf(sample.iso);
        // Weekday is derived correctly from the date, independent of year.
        expect(derived).toBe(sample.trueWeekday);

        // A weekday term matches iff the derived weekday equals the named weekday,
        // and the full name and the three-letter abbreviation behave identically.
        for (const name of WEEKDAY_NAMES) {
          const token = useAbbrev ? weekdayAbbrev(name) : name;
          const term = parseDayTerm(token);
          expect(term).toEqual({ kind: 'weekday', weekday: name });
          const matched = matchesDayTerm(sample.iso, term!);
          expect(matched).toBe(derived === name);
          // Full name and abbreviation agree.
          const other = parseDayTerm(useAbbrev ? name : weekdayAbbrev(name))!;
          expect(matchesDayTerm(sample.iso, other)).toBe(matched);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('matches month-day, ISO-date, and day-of-month terms against the date components', () => {
    fc.assert(
      fc.property(dateArb, (sample) => {
        const [y, m, d] = sample.iso.split('-').map(Number);
        const monthAbbrev = [
          'jan',
          'feb',
          'mar',
          'apr',
          'may',
          'jun',
          'jul',
          'aug',
          'sep',
          'oct',
          'nov',
          'dec',
        ][m - 1];

        // ISO date matches exactly its own date.
        expect(matchesDay(sample.iso, sample.iso)).toBe(true);
        // Month-and-day matches.
        expect(matchesDay(sample.iso, `${monthAbbrev} ${d}`)).toBe(true);
        // Bare day-of-month matches when 1..31.
        expect(matchesDay(sample.iso, String(d))).toBe(true);

        // A different ISO date (one day later, same year) must not match the day-of-month
        // unless the day-of-month happens to coincide.
        const other = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(
          (d % 28) + 1,
        ).padStart(2, '0')}`;
        if (other !== sample.iso) {
          expect(matchesDay(sample.iso, other)).toBe(false);
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('matches the verified re:Invent 2026 fixtures with derived weekdays', () => {
    for (const { date, weekday } of REINVENT_2026) {
      expect(weekdayOf(date)).toBe(weekday);
      expect(matchesDay(date, weekday)).toBe(true);
      expect(matchesDay(date, weekdayAbbrev(weekday))).toBe(true);
    }
  });

  it('derives conference days from distinct catalog dates, sorted chronologically', () => {
    const dates = [
      '2026-12-01',
      undefined,
      '2026-11-30',
      '2026-12-01', // duplicate
      'not-a-date',
      '2026-11-29',
    ];
    const days = conferenceDays(dates);
    expect(days.map((d) => d.date)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01']);
    expect(days.map((d) => d.weekday)).toEqual(['Sunday', 'Monday', 'Tuesday']);
  });

  it('abbreviation table aligns with the weekday name table', () => {
    expect(WEEKDAY_ABBREVS).toHaveLength(WEEKDAY_NAMES.length);
    WEEKDAY_NAMES.forEach((name, i) => {
      expect(weekdayAbbrev(name)).toBe(WEEKDAY_ABBREVS[i]);
    });
  });
});
