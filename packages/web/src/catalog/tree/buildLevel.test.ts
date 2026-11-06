// Unit tests for the tree-level builder (Catalog_Tree).
//
// Feature: reinvent-commander
//
// Covers root dimension folders (absent dimensions omitted), a day → time-of-
// day level shape, folders-before-files ordering, the ".." parent on non-root
// levels, and the Session_File list shown at EVERY level (root = whole catalog,
// a dimension-pick does not narrow, each concrete value narrows further).
// Validates Requirement 17.

import { describe, expect, it } from 'vitest';
import type { Session } from '@reinvent-commander/shared';
import { buildSearchIndex } from '../../query/searchIndex.js';
import { buildTreeLevel, DIMENSION_SENTINEL, rootDimensions } from './buildLevel.js';
import { encodeTypeLevel } from './dimensions.js';
import type { Path } from './pathState.js';

const SORT = { sortField: 'day' as const, sortDir: 'asc' as const };

function session(partial: Partial<Session> & { sessionId: string }): Session {
  return { title: partial.sessionId, ...partial };
}

const CATALOG: Session[] = [
  session({
    sessionId: 's1',
    type: 'Breakout',
    level: '300',
    tracks: ['AI/ML'],
    sessionTime: { date: '2026-11-30', time: '09:00', length: '60' },
  }),
  session({
    sessionId: 's2',
    type: 'Workshop',
    level: '200',
    tracks: ['Compute'],
    sessionTime: { date: '2026-11-30', time: '15:00', length: '60' },
  }),
  session({
    sessionId: 's3',
    tracks: ['AI/ML'],
    // No date, no type/level, no topics/services.
  }),
];

describe('rootDimensions', () => {
  it('omits dimensions no session carries', () => {
    const index = buildSearchIndex(CATALOG);
    const dims = rootDimensions(index).map((f) => f.dimension);
    // day, track, typeLevel present; topic and services absent in the catalog.
    expect(dims).toEqual(['day', 'track', 'typeLevel']);
  });

  it('counts sessions carrying a value for the dimension', () => {
    const index = buildSearchIndex(CATALOG);
    const byDim = Object.fromEntries(rootDimensions(index).map((f) => [f.dimension, f.count]));
    expect(byDim.day).toBe(2); // s1, s2 have dates
    expect(byDim.track).toBe(3); // all three have a track
    expect(byDim.typeLevel).toBe(2); // s1, s2 have type+level
  });
});

describe('buildTreeLevel', () => {
  it('shows dimension folders then every session as files at the root', () => {
    const index = buildSearchIndex(CATALOG);
    const level = buildTreeLevel(index, [], SORT);
    expect(level.entries[0].kind).not.toBe('parent');
    // Folders on top, then the whole catalog as files below them.
    const files = level.entries.filter((e) => e.kind === 'file');
    const folders = level.entries.filter((e) => e.kind === 'folder');
    expect(folders.length).toBeGreaterThan(0);
    expect(files).toHaveLength(CATALOG.length);
    const ids = new Set(files.map((e) => (e.kind === 'file' ? e.session.sessionId : '')));
    expect(ids).toEqual(new Set(['s1', 's2', 's3']));
    expect(level.breadcrumb).toEqual(['root']);
  });

  it('does not narrow the file list when a dimension is picked but no value chosen', () => {
    const index = buildSearchIndex(CATALOG);
    const path: Path = [{ dimension: 'day', value: DIMENSION_SENTINEL }];
    const level = buildTreeLevel(index, path, SORT);
    const files = level.entries.filter((e) => e.kind === 'file');
    // Still the whole catalog — the sentinel imposes no predicate.
    expect(files).toHaveLength(CATALOG.length);
  });

  it('narrows the file list to the accumulated concrete value', () => {
    const index = buildSearchIndex(CATALOG);
    const path: Path = [{ dimension: 'day', value: '2026-11-30' }];
    const level = buildTreeLevel(index, path, SORT);
    const ids = new Set(
      level.entries.flatMap((e) => (e.kind === 'file' ? [e.session.sessionId] : [])),
    );
    // Only sessions dated 2026-11-30 (s1, s2); s3 has no date.
    expect(ids).toEqual(new Set(['s1', 's2']));
  });

  it('prepends a parent row on non-root levels', () => {
    const index = buildSearchIndex(CATALOG);
    const path: Path = [{ dimension: 'day', value: DIMENSION_SENTINEL }];
    const level = buildTreeLevel(index, path, SORT);
    expect(level.entries[0].kind).toBe('parent');
  });

  it('lists value folders present under a picked dimension', () => {
    const index = buildSearchIndex(CATALOG);
    const path: Path = [{ dimension: 'day', value: DIMENSION_SENTINEL }];
    const level = buildTreeLevel(index, path, SORT);
    const folders = level.entries.filter((e) => e.kind === 'folder');
    expect(folders.map((f) => (f.kind === 'folder' ? f.value : ''))).toEqual(['2026-11-30']);
  });

  it('drills a chosen day into time-of-day bucket folders', () => {
    const index = buildSearchIndex(CATALOG);
    const path: Path = [{ dimension: 'day', value: '2026-11-30' }];
    const level = buildTreeLevel(index, path, SORT);
    const buckets = level.entries
      .filter((e) => e.kind === 'folder')
      .map((e) => (e.kind === 'folder' ? e.value : ''));
    // 09:00 → morning, 15:00 → afternoon.
    expect(buckets).toEqual(['morning', 'afternoon']);
    expect(level.breadcrumb).toEqual(['root', 'Mon Nov 30']);
  });

  it('lists Session_Files at a leaf level (time bucket chosen)', () => {
    const index = buildSearchIndex(CATALOG);
    const path: Path = [
      { dimension: 'day', value: '2026-11-30' },
      { dimension: 'timeOfDay', value: 'morning' },
    ];
    const level = buildTreeLevel(index, path, SORT);
    const files = level.entries.filter((e) => e.kind === 'file');
    expect(files).toHaveLength(1);
    expect(files[0].kind === 'file' && files[0].session.sessionId).toBe('s1');
  });

  it('decodes typeLevel folders into both predicates at a leaf', () => {
    const index = buildSearchIndex(CATALOG);
    const path: Path = [{ dimension: 'typeLevel', value: DIMENSION_SENTINEL }];
    const level = buildTreeLevel(index, path, SORT);
    const values = level.entries
      .filter((e) => e.kind === 'folder')
      .map((e) => (e.kind === 'folder' ? e.value : ''));
    expect(values).toContain(encodeTypeLevel('Breakout', '300'));
    expect(values).toContain(encodeTypeLevel('Workshop', '200'));

    const leaf = buildTreeLevel(
      index,
      [{ dimension: 'typeLevel', value: encodeTypeLevel('Breakout', '300') }],
      SORT,
    );
    const leafFiles = leaf.entries.filter((e) => e.kind === 'file');
    expect(leafFiles).toHaveLength(1);
    expect(leafFiles[0].kind === 'file' && leafFiles[0].session.sessionId).toBe('s1');
  });

  it('orders day-dimension value folders chronologically by date, not by label', () => {
    // Deliberately out of alphabetical order: Friday (Dec 4) would sort FIRST
    // by its "Fri …" label, but must come LAST by date. A dateless session
    // carries no day value, so it forms no Day folder here (the catalog Day
    // dimension omits a missing date; the Unscheduled bucket lives in the
    // Schedule_Panel tree, covered by scheduleTree tests).
    const catalog: Session[] = [
      session({ sessionId: 'fri', sessionTime: { date: '2026-12-04', time: '09:00', length: '60' } }),
      session({ sessionId: 'mon', sessionTime: { date: '2026-11-30', time: '09:00', length: '60' } }),
      session({ sessionId: 'sun', sessionTime: { date: '2026-11-29', time: '09:00', length: '60' } }),
      session({ sessionId: 'tue', sessionTime: { date: '2026-12-01', time: '09:00', length: '60' } }),
      session({ sessionId: 'none' }),
    ];
    const index = buildSearchIndex(catalog);
    const path: Path = [{ dimension: 'day', value: DIMENSION_SENTINEL }];
    const level = buildTreeLevel(index, path, SORT);
    const folders = level.entries
      .filter((e) => e.kind === 'folder')
      .map((e) => (e.kind === 'folder' ? { value: e.value, label: e.label } : { value: '', label: '' }));
    // Chronological: Sun Nov 29, Mon Nov 30, Tue Dec 1, Fri Dec 4. Friday is NOT first.
    expect(folders.map((f) => f.value)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-04']);
    expect(folders[0].label).toBe('Sun Nov 29');
    expect(folders[0].label).not.toContain('Fri');
    expect(folders[folders.length - 1].label).toBe('Fri Dec 4');
  });

  it('places every folder before every file', () => {
    const index = buildSearchIndex(CATALOG);
    const path: Path = [{ dimension: 'track', value: 'AI/ML' }];
    const level = buildTreeLevel(index, path, SORT);
    const firstFile = level.entries.findIndex((e) => e.kind === 'file');
    const lastFolder = level.entries.map((e) => e.kind).lastIndexOf('folder');
    if (firstFile !== -1 && lastFolder !== -1) {
      expect(lastFolder).toBeLessThan(firstFile);
    }
  });
});
