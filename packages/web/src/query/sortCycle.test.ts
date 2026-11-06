import { describe, expect, it } from 'vitest';
import {
  nextSortState,
  SORT_CYCLE,
  sortDirLabel,
  sortStatusMessage,
  type SortState,
} from './sortCycle.js';

describe('F9 sort cycle', () => {
  it('visits every field in ascending then descending in the defined order', () => {
    expect(SORT_CYCLE).toEqual([
      { field: 'code', dir: 'asc' },
      { field: 'code', dir: 'desc' },
      { field: 'title', dir: 'asc' },
      { field: 'title', dir: 'desc' },
      { field: 'day', dir: 'asc' },
      { field: 'day', dir: 'desc' },
      { field: 'track', dir: 'asc' },
      { field: 'track', dir: 'desc' },
    ]);
  });

  it('steps field + direction on each F9 press, wrapping after 8 presses', () => {
    let state: SortState = SORT_CYCLE[0];
    const visited: SortState[] = [state];
    for (let i = 0; i < 8; i += 1) {
      state = nextSortState(state);
      visited.push(state);
    }
    // The first 8 entries are the full cycle, in order…
    expect(visited.slice(0, 8)).toEqual([...SORT_CYCLE]);
    // …and the 8th press wraps back to the start (code asc).
    expect(visited[8]).toEqual(SORT_CYCLE[0]);
  });

  it('advances direction before advancing field', () => {
    expect(nextSortState({ field: 'code', dir: 'asc' })).toEqual({ field: 'code', dir: 'desc' });
    expect(nextSortState({ field: 'code', dir: 'desc' })).toEqual({ field: 'title', dir: 'asc' });
    expect(nextSortState({ field: 'track', dir: 'asc' })).toEqual({ field: 'track', dir: 'desc' });
  });

  it('wraps from the last step (track desc) back to the first (code asc)', () => {
    expect(nextSortState({ field: 'track', dir: 'desc' })).toEqual({ field: 'code', dir: 'asc' });
  });

  it('restarts the cycle from an unrecognized state', () => {
    // Not a member of SORT_CYCLE's shape ordering — defensively restart.
    expect(nextSortState({ field: 'title' as never, dir: 'nope' as never })).toEqual(SORT_CYCLE[0]);
  });
});

describe('sort status message', () => {
  it('names both the current field and direction', () => {
    expect(sortDirLabel('asc')).toBe('ascending');
    expect(sortDirLabel('desc')).toBe('descending');
    expect(sortStatusMessage({ field: 'day', dir: 'desc' })).toContain('day');
    expect(sortStatusMessage({ field: 'day', dir: 'desc' })).toContain('descending');
    expect(sortStatusMessage({ field: 'code', dir: 'asc' })).toContain('ascending');
  });
});
