// Catalog_Tree — time-of-day buckets (single source of cutoffs).
//
// The `day/<date>` tree level drills into coarse time-of-day buckets rather
// than raw clock times. The numeric cutoffs live ONLY in this module as named
// constants, so the bucket boundaries are changed in exactly one place. A
// session with a missing or unparseable "HH:MM" start lands in `unscheduled`.
// The bucket order is chronological with `unscheduled` always last.

/** The time-of-day bucket a session falls into. */
export type TimeBucket = 'morning' | 'midday' | 'afternoon' | 'evening' | 'unscheduled';

/**
 * Bucket cutoffs, expressed as minutes-from-midnight. A session's start minute
 * is compared against these in ascending order:
 *   - morning:   < MIDDAY_START            (before 12:00)
 *   - midday:    MIDDAY_START .. AFTERNOON_START-1   (12:00–13:59)
 *   - afternoon: AFTERNOON_START .. EVENING_START-1  (14:00–17:59)
 *   - evening:   >= EVENING_START          (18:00 and later)
 * Change a boundary here and nowhere else.
 */
const MIDDAY_START = 12 * 60; // 12:00
const AFTERNOON_START = 14 * 60; // 14:00
const EVENING_START = 18 * 60; // 18:00

/** Ordered list of real buckets, chronological, with `unscheduled` last. */
export const TIME_BUCKET_ORDER: readonly TimeBucket[] = [
  'morning',
  'midday',
  'afternoon',
  'evening',
  'unscheduled',
] as const;

/** Human display labels for each bucket, used in folder rows and breadcrumbs. */
export const TIME_BUCKET_LABELS: Record<TimeBucket, string> = {
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  evening: 'Evening',
  unscheduled: 'Unscheduled',
};

/** Matches a defensive "HH:MM" (or "H:MM") 24-hour clock time. */
const HH_MM = /^(\d{1,2}):(\d{2})$/;

/**
 * Parse an "HH:MM" start time into minutes-from-midnight, returning `undefined`
 * when the value is missing or not a valid 24-hour time (hour 0–23, minute
 * 0–59).
 */
function parseMinutes(time: string | undefined): number | undefined {
  if (!time) return undefined;
  const m = HH_MM.exec(time.trim());
  if (!m) return undefined;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return hour * 60 + minute;
}

/**
 * The time-of-day bucket for a start time. Returns `unscheduled` when the time
 * is missing or unparseable; otherwise the bucket whose half-open range the
 * minute falls into, using the cutoffs defined above.
 */
export function bucketOf(time: string | undefined): TimeBucket {
  const minutes = parseMinutes(time);
  if (minutes === undefined) return 'unscheduled';
  if (minutes < MIDDAY_START) return 'morning';
  if (minutes < AFTERNOON_START) return 'midday';
  if (minutes < EVENING_START) return 'afternoon';
  return 'evening';
}
