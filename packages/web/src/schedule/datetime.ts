// Schedule — wall-clock datetime format/parse (Task 8.3)
//
// Personal-time timestamps are wall-clock "YYYY-MM-DDTHH:MM:SS" with NO
// trailing `Z` and NO UTC offset, and seconds always "00". This module formats
// year/month/day/hour/minute into that shape and parses such a string back into
// its numeric components. Formatting and parsing round-trip: parsing a
// formatted value recovers the same components.

/** Matches a wall-clock "YYYY-MM-DDTHH:MM:SS" with no trailing Z/offset. */
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/** The numeric components of a parsed wall-clock timestamp. */
export interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** Minutes since midnight on this date, for same-date ordering/duration math. */
  totalMinutes: number;
}

/** Parts accepted by {@link formatWallClock} (seconds are forced to "00"). */
export interface WallClockInput {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

/**
 * Format year/month/day/hour/minute as "YYYY-MM-DDTHH:MM:00" — wall-clock, no
 * trailing `Z`, no offset, seconds always "00".
 */
export function formatWallClock(parts: WallClockInput): string {
  return `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(
    parts.minute,
  )}:00`;
}

/**
 * Parse a wall-clock "YYYY-MM-DDTHH:MM:SS" string into its numeric components.
 * Returns `undefined` unless the string is well-formed, is a real calendar
 * date, has a valid 24-hour time, and carries no `Z`/offset. Any non-zero
 * seconds value is rejected (personal time uses seconds "00").
 */
export function parseWallClock(value: string | undefined | null): WallClockParts | undefined {
  if (typeof value !== 'string') return undefined;
  const m = WALL_CLOCK.exec(value);
  if (!m) return undefined;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);

  if (second !== 0) return undefined;
  if (month < 1 || month > 12) return undefined;
  if (hour > 23 || minute > 59) return undefined;

  // Reject impossible calendar dates (e.g. Feb 30) by round-tripping via UTC.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return undefined;
  }

  return { year, month, day, hour, minute, totalMinutes: hour * 60 + minute };
}
