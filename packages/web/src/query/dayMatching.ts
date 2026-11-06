// Query_Engine — data-derived day matching.
//
// The "day" dimension is computed from each session's `sessionTime.date`, never
// from a hard-coded calendar. Given an ISO date, `weekdayOf` returns the
// weekday the calendar assigns to that date for ANY year (e.g. it can tell that
// a date in a future year's catalog is a Monday). A Day_Term entered in the
// single search box is parsed by `parseDayTerm` and tested against a session's
// date by `matchesDayTerm`. The set of conference days shown in filters is
// derived from the distinct dates present in the loaded catalog
// (`conferenceDays`). The verified re:Invent 2026 dates are used only as test
// fixtures — they never appear here as production constants.

/** Full weekday names, indexed by `Date.getUTCDay()` (0 = Sunday). */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

/** Three-letter lowercase weekday abbreviations, indexed like {@link WEEKDAY_NAMES}. */
export const WEEKDAY_ABBREVS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Full lowercase month names, indexed by month number minus one (0 = January). */
const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

/** Three-letter lowercase month abbreviations, indexed like {@link MONTH_NAMES}. */
const MONTH_ABBREVS = [
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
] as const;

/** Matches a strict "YYYY-MM-DD" ISO calendar date. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse an ISO "YYYY-MM-DD" date into its numeric components, returning
 * `undefined` when the string is not a well-formed, real calendar date. The
 * check rejects impossible dates (e.g. month 13, Feb 30) by round-tripping
 * through a UTC `Date`.
 */
function parseIsoDate(date: string): { year: number; month: number; day: number } | undefined {
  const m = ISO_DATE.exec(date.trim());
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return undefined;
  }
  return { year, month, day };
}

/**
 * The weekday the calendar assigns to an ISO "YYYY-MM-DD" date, for any year.
 * Uses UTC so the result is independent of the host timezone. Returns
 * `undefined` for an unparseable date.
 */
export function weekdayOf(date: string | undefined): WeekdayName | undefined {
  if (!date) return undefined;
  const parts = parseIsoDate(date);
  if (!parts) return undefined;
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return WEEKDAY_NAMES[d.getUTCDay()];
}

/** The lowercase three-letter abbreviation for a weekday name. */
export function weekdayAbbrev(name: WeekdayName): string {
  return WEEKDAY_ABBREVS[WEEKDAY_NAMES.indexOf(name)];
}

/** A parsed Day_Term — the shapes a day search term can take. */
export type DayTerm =
  | { kind: 'weekday'; weekday: WeekdayName }
  | { kind: 'isoDate'; date: string }
  | { kind: 'monthDay'; month: number; day: number }
  | { kind: 'dayOfMonth'; day: number };

/**
 * Parse a free-text Day_Term from the search box. Accepts:
 *   - a weekday full name ("monday") or three-letter abbreviation ("mon"),
 *   - a month-and-day ("dec 1", "december 1", "1 dec"),
 *   - an ISO date ("2026-12-01"),
 *   - or a bare day-of-month number ("30", "1").
 * Returns `undefined` when the term is not a recognizable day expression, so
 * the caller can fall back to a plain substring search.
 */
export function parseDayTerm(term: string): DayTerm | undefined {
  const q = term.trim().toLowerCase();
  if (!q) return undefined;

  // Weekday full name.
  const fullIdx = WEEKDAY_NAMES.findIndex((n) => n.toLowerCase() === q);
  if (fullIdx !== -1) return { kind: 'weekday', weekday: WEEKDAY_NAMES[fullIdx] };

  // Weekday three-letter abbreviation.
  const abbrIdx = WEEKDAY_ABBREVS.indexOf(q as (typeof WEEKDAY_ABBREVS)[number]);
  if (abbrIdx !== -1) return { kind: 'weekday', weekday: WEEKDAY_NAMES[abbrIdx] };

  // ISO date.
  if (parseIsoDate(q)) return { kind: 'isoDate', date: q };

  // Month-and-day, in either order: "dec 1" or "1 dec".
  const monthDay = parseMonthDay(q);
  if (monthDay) return { kind: 'monthDay', month: monthDay.month, day: monthDay.day };

  // Bare day-of-month number.
  if (/^\d{1,2}$/.test(q)) {
    const day = Number(q);
    if (day >= 1 && day <= 31) return { kind: 'dayOfMonth', day };
  }

  return undefined;
}

/** Resolve a month token (name, abbreviation, or 1-12 number) to a month number. */
function monthFromToken(token: string): number | undefined {
  const full = MONTH_NAMES.indexOf(token as (typeof MONTH_NAMES)[number]);
  if (full !== -1) return full + 1;
  const abbr = MONTH_ABBREVS.indexOf(token as (typeof MONTH_ABBREVS)[number]);
  if (abbr !== -1) return abbr + 1;
  if (/^\d{1,2}$/.test(token)) {
    const n = Number(token);
    if (n >= 1 && n <= 12) return n;
  }
  return undefined;
}

/** Parse a "month day" / "day month" expression into numeric month + day. */
function parseMonthDay(q: string): { month: number; day: number } | undefined {
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length !== 2) return undefined;

  // Try "<month> <day>".
  const m1 = monthFromToken(tokens[0]);
  if (m1 !== undefined && /^\d{1,2}$/.test(tokens[1])) {
    const day = Number(tokens[1]);
    if (day >= 1 && day <= 31) return { month: m1, day };
  }

  // Try "<day> <month>".
  const m2 = monthFromToken(tokens[1]);
  if (m2 !== undefined && /^\d{1,2}$/.test(tokens[0])) {
    const day = Number(tokens[0]);
    if (day >= 1 && day <= 31) return { month: m2, day };
  }

  return undefined;
}

/**
 * Does a session's ISO date match a parsed Day_Term? Weekday terms compare
 * against the date's derived weekday; month-day, ISO-date, and day-of-month
 * terms compare against the date's components. A missing or unparseable session
 * date never matches.
 */
export function matchesDayTerm(date: string | undefined, term: DayTerm): boolean {
  const parts = date ? parseIsoDate(date) : undefined;
  if (!parts) return false;

  switch (term.kind) {
    case 'weekday':
      return weekdayOf(date) === term.weekday;
    case 'isoDate':
      return (
        `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(
          parts.day,
        ).padStart(2, '0')}` === term.date
      );
    case 'monthDay':
      return parts.month === term.month && parts.day === term.day;
    case 'dayOfMonth':
      return parts.day === term.day;
  }
}

/**
 * Convenience: does a session date match a free-text day query? Returns
 * `false` when the query does not parse as a Day_Term (so plain searches do not
 * accidentally match on the day dimension).
 */
export function matchesDay(date: string | undefined, query: string): boolean {
  const term = parseDayTerm(query);
  if (!term) return false;
  return matchesDayTerm(date, term);
}

/** Three-letter title-case month abbreviations for display, indexed like {@link MONTH_NAMES}. */
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * A compact, data-derived day label for display, e.g. "2026-11-30" -> "Mon Nov
 * 30". Both the weekday and the month are computed from the ISO date itself, so
 * the label is correct for any event year without a hard-coded calendar.
 * Returns the raw date string when it is not a well-formed ISO date, and an
 * empty string when no date is supplied.
 */
export function formatDayLabel(date: string | undefined): string {
  if (!date) return '';
  const parts = parseIsoDate(date);
  if (!parts) return date;
  const weekday = weekdayOf(date);
  const short = weekday ? weekday.slice(0, 3) : '';
  return `${short} ${MONTH_LABELS[parts.month - 1]} ${parts.day}`;
}

/**
 * Chronological order key for a session date: the ISO date sorts naturally as a
 * string. Sessions without a resolvable date sort last via a high sentinel.
 */
export function dayOrderKey(date: string | undefined): string {
  return parseIsoDate(date ?? '') ? (date as string) : '\uffff';
}

/** A conference day derived from the catalog: its ISO date and derived weekday. */
export interface ConferenceDay {
  date: string;
  weekday: WeekdayName;
}

/**
 * Derive the set of conference days from the distinct, well-formed
 * `sessionTime.date` values present across a loaded catalog, sorted
 * chronologically. The weekday of each day is computed from the date, so the
 * list is correct for any event year without a built-in calendar.
 */
export function conferenceDays(dates: Iterable<string | undefined>): ConferenceDay[] {
  const seen = new Set<string>();
  const days: ConferenceDay[] = [];
  for (const date of dates) {
    if (!date || seen.has(date)) continue;
    const weekday = weekdayOf(date);
    if (!weekday) continue;
    seen.add(date);
    days.push({ date, weekday });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}
