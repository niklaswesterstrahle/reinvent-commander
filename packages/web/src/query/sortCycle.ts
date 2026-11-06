// F9 sort-cycle state machine (pure logic, cleanup pass).
//
// The catalog sort is keyboard-first: the F9 function key is the ONLY control
// (the mouse-driven <select> was removed). Each F9 press advances through every
// sort field in ascending then descending order before moving to the next
// field, wrapping after the last step. Kept pure (no React) so the exact cycle
// order and wrap-around are unit-testable in the web package's node vitest env.

import type { SortField } from '@reinvent-commander/shared';

/** A concrete sort selection: the field and its direction. */
export interface SortState {
  field: SortField;
  dir: 'asc' | 'desc';
}

/**
 * The full F9 cycle, in order. Each field appears ascending then descending;
 * the last step wraps back to the first. Pressing F9 eight times returns to the
 * start. The Query_Engine's sort semantics are unchanged — this only sequences
 * the (field, dir) pairs F9 steps through.
 */
export const SORT_CYCLE: readonly SortState[] = [
  { field: 'code', dir: 'asc' },
  { field: 'code', dir: 'desc' },
  { field: 'title', dir: 'asc' },
  { field: 'title', dir: 'desc' },
  { field: 'day', dir: 'asc' },
  { field: 'day', dir: 'desc' },
  { field: 'track', dir: 'asc' },
  { field: 'track', dir: 'desc' },
];

/** Index of a sort state in {@link SORT_CYCLE}, or -1 when not found. */
function cycleIndex(state: SortState): number {
  return SORT_CYCLE.findIndex((s) => s.field === state.field && s.dir === state.dir);
}

/**
 * Advance the sort one F9 step. Returns the next (field, dir) in
 * {@link SORT_CYCLE}, wrapping after the last entry. An unrecognized current
 * state (should not happen) restarts the cycle at its first entry.
 */
export function nextSortState(current: SortState): SortState {
  const i = cycleIndex(current);
  const next = i === -1 ? 0 : (i + 1) % SORT_CYCLE.length;
  return SORT_CYCLE[next];
}

/** Human-readable direction word for a status line. */
export function sortDirLabel(dir: 'asc' | 'desc'): string {
  return dir === 'asc' ? 'ascending' : 'descending';
}

/** Status-line message naming the current sort field and direction. */
export function sortStatusMessage(state: SortState): string {
  const arrow = state.dir === 'asc' ? '↑' : '↓';
  return `Sort: ${state.field} (${sortDirLabel(state.dir)}) ${arrow}. F9 cycles sort.`;
}
