// Schedule — conflict detection (Task 8.5)
//
// Resolves comparable start/end instants for schedule items — catalog sessions
// (from `sessionTime`, reusing the same rules as the search index) and personal
// time (from its wall-clock strings) — and marks any pair whose half-open
// [startMs, endMs) intervals intersect. The event is a single timezone, so each
// wall-clock value is read as a comparable UTC instant (matching
// searchIndex.resolveInstants). Unresolvable and all-day items carry no
// interval and never conflict.

import type { PersonalTime, Session } from '@reinvent-commander/shared';
import { indexSession } from '../query/searchIndex.js';
import { parseWallClock } from './datetime.js';

/** A resolved, comparable time interval for a schedule item. */
export interface ResolvedInterval {
  /** The item's stable id (sessionId or personalTimeId). */
  id: string;
  startMs: number;
  endMs: number;
}

/**
 * Resolve a session's interval. Requires `sessionTime` with a well-formed
 * date + time + numeric length and a non-all-day session (same rules the
 * search index applies). Returns `undefined` when unresolvable or all-day.
 */
export function resolveSessionInterval(session: Session): ResolvedInterval | undefined {
  const { startMs, endMs } = indexSession(session);
  if (startMs === undefined || endMs === undefined) return undefined;
  return { id: session.sessionId, startMs, endMs };
}

/**
 * Resolve a personal-time block's interval from its wall-clock start/end
 * strings, read as comparable UTC instants. Returns `undefined` when either
 * timestamp is malformed or the end is not strictly after the start.
 */
export function resolvePersonalTimeInterval(pt: PersonalTime): ResolvedInterval | undefined {
  const start = parseWallClock(pt.startDateTime);
  const end = parseWallClock(pt.endDateTime);
  if (!start || !end) return undefined;
  const startMs = Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute);
  const endMs = Date.UTC(end.year, end.month - 1, end.day, end.hour, end.minute);
  if (endMs <= startMs) return undefined;
  return { id: pt.personalTimeId, startMs, endMs };
}

/**
 * Whether two half-open intervals [startMs, endMs) intersect. Back-to-back
 * intervals (one ending exactly when the next begins) do NOT conflict. The
 * relation is symmetric.
 */
export function intervalsOverlap(a: ResolvedInterval, b: ResolvedInterval): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/**
 * Given a set of resolved intervals, return the set of ids that conflict with
 * at least one OTHER interval. Pairs are compared half-open and symmetrically;
 * an item never conflicts with itself.
 */
export function findConflictingIds(intervals: readonly ResolvedInterval[]): Set<string> {
  const conflicting = new Set<string>();
  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length; j += 1) {
      if (intervalsOverlap(intervals[i], intervals[j])) {
        conflicting.add(intervals[i].id);
        conflicting.add(intervals[j].id);
      }
    }
  }
  return conflicting;
}

/**
 * Resolve a mixed set of sessions and personal-time blocks to their intervals,
 * dropping any unresolvable/all-day item, and return the ids that conflict with
 * at least one other scheduled item.
 */
export function detectScheduleConflicts(
  sessions: readonly Session[],
  personalTime: readonly PersonalTime[],
): Set<string> {
  const intervals: ResolvedInterval[] = [];
  for (const session of sessions) {
    const interval = resolveSessionInterval(session);
    if (interval) intervals.push(interval);
  }
  for (const pt of personalTime) {
    const interval = resolvePersonalTimeInterval(pt);
    if (interval) intervals.push(interval);
  }
  return findConflictingIds(intervals);
}
