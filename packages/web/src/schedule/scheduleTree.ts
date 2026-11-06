// Schedule_Panel — day-folder tree builder (Requirement 17, FEAT-003).
//
// The optional Schedule_Panel tree groups the attendee's scheduled items
// (reserved + favorited sessions + personal-time blocks) into day folders, with
// Day as the ONLY dimension. Each item's day is derived from its own date —
// session rows from `session.sessionTime.date`, personal-time rows from the
// date part of `parseWallClock(personalTime.startDateTime)` — reusing the
// Query_Engine's `dayMatching` helpers for labels (`formatDayLabel`) and
// chronological order (`dayOrderKey`). Items with no resolvable day fall into an
// "Unscheduled" folder, ordered last. The level mirrors the catalog tree's
// navigation shape — folders before items, a ".." parent on non-root levels, and
// a breadcrumb path — but carries `ScheduleRow`s instead of catalog Session_Files
// so the Schedule_Panel's favorite/reservation/personal-time actions still target
// the selected item. This is pure data: no React, no mutation of the input rows.

import { dayOrderKey, formatDayLabel } from '../query/dayMatching.js';
import { parseWallClock } from './datetime.js';
import type { ScheduleRow } from './scheduleModel.js';

/**
 * A single entry in a rendered schedule-tree level:
 *   - `parent` — the ".." ascend row (only on non-root levels),
 *   - `folder` — a day folder (or the Unscheduled folder) with its item count,
 *   - `item`   — a leaf carrying one {@link ScheduleRow}.
 */
export type ScheduleTreeEntry =
  | { kind: 'parent' }
  | { kind: 'folder'; day: string; label: string; count: number }
  | { kind: 'item'; row: ScheduleRow };

/** One rendered level of the schedule tree: ordered entries + a breadcrumb. */
export interface ScheduleTreeLevel {
  /**
   * Parent (if any), then day folders (chronological, Unscheduled last), then
   * the matching items ordered by calendar time ascending (no-time items last).
   */
  entries: ScheduleTreeEntry[];
  /** Human path labels from the root, e.g. ['root', 'Mon Nov 30']. */
  breadcrumb: string[];
}

/**
 * A schedule-tree path: the empty root, or a single chosen day folder (Day is
 * the only dimension, so a path is at most one step deep). The `day` of the
 * Unscheduled folder is {@link UNSCHEDULED_KEY}.
 */
export type SchedulePath = string[];

/** The folder key + label for items with no resolvable day; ordered last. */
export const UNSCHEDULED_KEY = '\u0000unscheduled';
/** The visible label for the Unscheduled day folder. */
export const UNSCHEDULED_LABEL = 'Unscheduled';

/**
 * The ISO "YYYY-MM-DD" day an item belongs to, or {@link UNSCHEDULED_KEY} when
 * no day can be resolved. Session rows use `sessionTime.date`; personal-time
 * rows use the date part of a parsed wall-clock `startDateTime`; everything else
 * (an unparseable start, a session with no `sessionTime`) is Unscheduled.
 */
export function rowDay(row: ScheduleRow): string {
  if (row.personalTime) {
    const parts = parseWallClock(row.personalTime.startDateTime);
    if (!parts) return UNSCHEDULED_KEY;
    return `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`;
  }
  const date = row.session?.sessionTime?.date;
  return date && date.trim() ? date : UNSCHEDULED_KEY;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

/** The display label for a day folder key (Unscheduled or a formatted date). */
function dayLabel(day: string): string {
  return day === UNSCHEDULED_KEY ? UNSCHEDULED_LABEL : formatDayLabel(day);
}

/**
 * The comparable calendar-start key for a row, used to order items by time
 * ascending. Session rows combine `sessionTime.date` + `sessionTime.time`;
 * personal-time rows use the parsed wall-clock `startDateTime`. A row with no
 * resolvable time yields `undefined` and sorts LAST (stable among such rows).
 */
export function rowTimeKey(row: ScheduleRow): string | undefined {
  if (row.personalTime) {
    const parts = parseWallClock(row.personalTime.startDateTime);
    if (!parts) return undefined;
    return `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(
      parts.hour,
    )}:${pad2(parts.minute)}`;
  }
  const time = row.session?.sessionTime;
  if (!time || !time.date || !time.date.trim()) return undefined;
  // `time.time` is "HH:MM"; fall back to start-of-day so a dated session with no
  // clock time still sorts within its day (ahead of no-time items).
  const clock = time.time && time.time.trim() ? time.time : '00:00';
  return `${time.date}T${clock}`;
}

/** The placeholder shown for an item with no resolvable start time. */
export const NO_START_STAMP = '\u2014';

/**
 * A compact, readable start date-and-time stamp for a scheduled item "file",
 * consistent with the catalog's day + time columns, e.g. "Mon Nov 30 09:00".
 * Session rows combine `formatDayLabel(sessionTime.date)` with the "HH:MM"
 * `sessionTime.time`; personal-time rows derive both from a parsed wall-clock
 * `startDateTime`. WHERE no start time resolves (an absent/unparseable date,
 * a session with no `sessionTime`), returns {@link NO_START_STAMP} rather than
 * an incorrect/epoch time. Folders and the ".." parent are not items and never
 * reach this helper.
 */
export function scheduleStartStamp(row: ScheduleRow): string {
  if (row.personalTime) {
    const parts = parseWallClock(row.personalTime.startDateTime);
    if (!parts) return NO_START_STAMP;
    const date = `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`;
    return `${formatDayLabel(date)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
  }
  const time = row.session?.sessionTime;
  if (!time || !time.date || !time.date.trim()) return NO_START_STAMP;
  const label = formatDayLabel(time.date);
  if (!label) return NO_START_STAMP;
  const clock = time.time && time.time.trim() ? time.time : '';
  return clock ? `${label} ${clock}` : label;
}

/**
 * Stable sort of rows by calendar start time ascending (earliest first). Rows
 * with no resolvable time (see {@link rowTimeKey}) are kept last, preserving
 * their relative input order. The input array is not mutated.
 */
function sortRowsByTime(rows: ScheduleRow[]): ScheduleRow[] {
  return rows
    .map((row, index) => ({ row, index, key: rowTimeKey(row) }))
    .sort((a, b) => {
      if (a.key === undefined && b.key === undefined) return a.index - b.index;
      if (a.key === undefined) return 1;
      if (b.key === undefined) return -1;
      const cmp = a.key.localeCompare(b.key);
      return cmp !== 0 ? cmp : a.index - b.index;
    })
    .map((entry) => entry.row);
}

/**
 * The chronological sort key for a day folder: real days sort by their ISO date
 * (via `dayOrderKey`), and the Unscheduled folder sorts after every real day by
 * using the same high sentinel the Query_Engine uses for missing dates.
 */
function daySortKey(day: string): string {
  return day === UNSCHEDULED_KEY ? dayOrderKey(undefined) : dayOrderKey(day);
}

/**
 * Build the rendered {@link ScheduleTreeLevel} for a schedule-tree path. The day
 * folders are ALWAYS on top (one per distinct item day, chronological,
 * Unscheduled last) with their counts, and the matching scheduled items follow
 * below them — ordered by calendar start time ascending, items with no
 * resolvable time last. At the root the items are ALL of the attendee's
 * scheduled items; inside a day folder a ".." parent precedes the folders and
 * the items narrow to that day's items. Folders always precede items; the
 * breadcrumb is `['root', <day label>?]`.
 */
export function buildScheduleTreeLevel(
  rows: ScheduleRow[],
  path: SchedulePath,
): ScheduleTreeLevel {
  const activeDay = path.length > 0 ? path[0] : undefined;

  // Day folders (always on top): one per distinct day across ALL rows, counted
  // and ordered chronologically with Unscheduled last.
  const counts = new Map<string, number>();
  for (const row of rows) {
    const day = rowDay(row);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days = [...counts.keys()].sort((a, b) => daySortCompare(a, b));

  const entries: ScheduleTreeEntry[] = [];
  // A ".." parent ascends from any non-root (day) level.
  if (activeDay !== undefined) entries.push({ kind: 'parent' });
  for (const day of days) {
    entries.push({ kind: 'folder', day, label: dayLabel(day), count: counts.get(day) ?? 0 });
  }

  // Items below the folders: ALL items at the root, or just the active day's
  // items inside a day folder — always ordered by calendar time ascending.
  const items = activeDay === undefined ? rows : rows.filter((row) => rowDay(row) === activeDay);
  for (const row of sortRowsByTime(items)) {
    entries.push({ kind: 'item', row });
  }

  const breadcrumb = activeDay === undefined ? ['root'] : ['root', dayLabel(activeDay)];
  return { entries, breadcrumb };
}

/** Compare two day keys chronologically (ISO date; Unscheduled last). */
function daySortCompare(a: string, b: string): number {
  return daySortKey(a).localeCompare(daySortKey(b));
}
