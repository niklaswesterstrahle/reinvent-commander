// Unit tests for the Schedule_Panel day-folder tree builder (FEAT-003).
//
// Feature: reinvent-commander — Schedule_Panel day-folder view (Requirement
// 17.11–17.14). Covers day grouping across reserved / favorite / personal-time
// rows, the Unscheduled bucket (a session with no sessionTime and a personal
// block with an unparseable start), folders-before-items ordering, and
// chronological day order with Unscheduled last.

import { describe, expect, it } from 'vitest';
import type { PersonalTime, Session } from '@reinvent-commander/shared';
import type { ScheduleRow } from './scheduleModel.js';
import {
  buildScheduleTreeLevel,
  NO_START_STAMP,
  rowDay,
  scheduleStartStamp,
  UNSCHEDULED_KEY,
  UNSCHEDULED_LABEL,
} from './scheduleTree.js';

/** Minimal Session carrying only the fields the tree reads (date/time). */
function session(id: string, date?: string, time = '09:00'): Session {
  return {
    sessionId: id,
    title: `Session ${id}`,
    sessionTime: date ? { date, time, length: 60 } : undefined,
  } as Session;
}

/** A reserved/favorite row backed by a session. */
function sessionRow(kind: 'reserved' | 'favorite', s: Session): ScheduleRow {
  return { id: s.sessionId, kind, title: s.title, placeholder: false, session: s, conflict: false };
}

/** A personal-time row from a wall-clock start (and matching end). */
function personalRow(id: string, start: string): ScheduleRow {
  const block: PersonalTime = {
    personalTimeId: id,
    startDateTime: start,
    endDateTime: start,
    title: `Block ${id}`,
    description: 'x',
  };
  return { id, kind: 'personalTime', title: block.title, placeholder: false, personalTime: block, conflict: false };
}

describe('scheduleTree.rowDay', () => {
  it('derives a session row day from sessionTime.date', () => {
    expect(rowDay(sessionRow('reserved', session('s1', '2026-11-30')))).toBe('2026-11-30');
  });

  it('derives a personal-time row day from the parsed wall-clock start', () => {
    expect(rowDay(personalRow('p1', '2026-12-01T14:30:00'))).toBe('2026-12-01');
  });

  it('buckets a session with no sessionTime as Unscheduled', () => {
    expect(rowDay(sessionRow('favorite', session('s2', undefined)))).toBe(UNSCHEDULED_KEY);
  });

  it('buckets a personal block with an unparseable start as Unscheduled', () => {
    expect(rowDay(personalRow('p2', 'not-a-timestamp'))).toBe(UNSCHEDULED_KEY);
  });
});

describe('scheduleTree.buildScheduleTreeLevel (root)', () => {
  it('groups reserved, favorite, and personal-time rows into day folders', () => {
    const rows: ScheduleRow[] = [
      sessionRow('reserved', session('s1', '2026-11-30')),
      sessionRow('favorite', session('s2', '2026-11-30')),
      personalRow('p1', '2026-12-01T10:00:00'),
    ];
    const level = buildScheduleTreeLevel(rows, []);
    const folders = level.entries.filter((e) => e.kind === 'folder');
    expect(folders).toHaveLength(2);
    expect(folders).toEqual([
      expect.objectContaining({ day: '2026-11-30', count: 2 }),
      expect.objectContaining({ day: '2026-12-01', count: 1 }),
    ]);
    expect(level.breadcrumb).toEqual(['root']);
  });

  it('puts unresolvable-day items in an Unscheduled folder ordered last', () => {
    const rows: ScheduleRow[] = [
      personalRow('p2', 'bad'),
      sessionRow('reserved', session('s1', '2026-11-30')),
      sessionRow('favorite', session('s2', undefined)),
    ];
    const level = buildScheduleTreeLevel(rows, []);
    const folders = level.entries.filter(
      (e): e is Extract<(typeof level.entries)[number], { kind: 'folder' }> => e.kind === 'folder',
    );
    expect(folders.map((f) => f.day)).toEqual(['2026-11-30', UNSCHEDULED_KEY]);
    const unscheduled = folders.find((f) => f.day === UNSCHEDULED_KEY);
    expect(unscheduled?.label).toBe(UNSCHEDULED_LABEL);
    expect(unscheduled?.count).toBe(2);
  });

  it('orders day folders chronologically with Unscheduled last', () => {
    const rows: ScheduleRow[] = [
      personalRow('p1', 'bad'),
      sessionRow('reserved', session('s1', '2026-12-02')),
      sessionRow('favorite', session('s2', '2026-11-30')),
      sessionRow('reserved', session('s3', '2026-12-01')),
    ];
    const level = buildScheduleTreeLevel(rows, []);
    const days = level.entries
      .filter((e) => e.kind === 'folder')
      .map((e) => (e as { day: string }).day);
    expect(days).toEqual(['2026-11-30', '2026-12-01', '2026-12-02', UNSCHEDULED_KEY]);
  });

  it('includes all items below the day folders at the root, no parent', () => {
    const rows: ScheduleRow[] = [
      sessionRow('reserved', session('s1', '2026-11-30')),
      sessionRow('favorite', session('s2', '2026-12-01')),
      personalRow('p1', '2026-11-30T10:00:00'),
    ];
    const level = buildScheduleTreeLevel(rows, []);
    // No ".." parent at the root.
    expect(level.entries.some((e) => e.kind === 'parent')).toBe(false);
    // Folders come first, then every item.
    const folders = level.entries.filter((e) => e.kind === 'folder');
    const items = level.entries.filter((e) => e.kind === 'item');
    expect(folders).toHaveLength(2);
    expect(items).toHaveLength(3);
    const firstItemIdx = level.entries.findIndex((e) => e.kind === 'item');
    const lastFolderIdx =
      level.entries.length - 1 - [...level.entries].reverse().findIndex((e) => e.kind === 'folder');
    expect(lastFolderIdx).toBeLessThan(firstItemIdx);
    // All scheduled items are present.
    expect(items.map((e) => (e as { row: ScheduleRow }).row.id).sort()).toEqual(['p1', 's1', 's2']);
  });

  it('orders root items by calendar time ascending, no-time items last', () => {
    const rows: ScheduleRow[] = [
      personalRow('pNoTime', 'bad'),
      sessionRow('reserved', session('sLate', '2026-12-01', '16:00')),
      personalRow('pMid', '2026-11-30T10:00:00'),
      sessionRow('favorite', session('sEarly', '2026-11-30', '08:00')),
      sessionRow('reserved', session('sNoTime', undefined)),
    ];
    const level = buildScheduleTreeLevel(rows, []);
    const itemIds = level.entries
      .filter((e) => e.kind === 'item')
      .map((e) => (e as { row: ScheduleRow }).row.id);
    // sEarly 11-30 08:00, pMid 11-30 10:00, sLate 12-01 16:00, then no-time
    // rows last in stable input order (pNoTime before sNoTime).
    expect(itemIds).toEqual(['sEarly', 'pMid', 'sLate', 'pNoTime', 'sNoTime']);
  });
});

describe('scheduleTree.buildScheduleTreeLevel (inside a day)', () => {
  it('narrows to a day\u2019s items behind a ".." parent and the day folders', () => {
    const rows: ScheduleRow[] = [
      sessionRow('reserved', session('s1', '2026-11-30', '09:00')),
      sessionRow('favorite', session('s2', '2026-12-01')),
      personalRow('p1', '2026-11-30T10:00:00'),
    ];
    const level = buildScheduleTreeLevel(rows, ['2026-11-30']);
    expect(level.entries[0]).toEqual({ kind: 'parent' });
    // Day folders still appear on top (both distinct days), then this day's items.
    const folders = level.entries.filter((e) => e.kind === 'folder');
    expect(folders).toHaveLength(2);
    const firstItemIdx = level.entries.findIndex((e) => e.kind === 'item');
    const lastFolderIdx =
      level.entries.length - 1 - [...level.entries].reverse().findIndex((e) => e.kind === 'folder');
    expect(lastFolderIdx).toBeLessThan(firstItemIdx);
    const items = level.entries.filter((e) => e.kind === 'item');
    // Only 2026-11-30 items, time-ascending: s1 (09:00) then p1 (10:00).
    expect(items.map((e) => (e as { row: ScheduleRow }).row.id)).toEqual(['s1', 'p1']);
    expect(level.breadcrumb).toEqual(['root', 'Mon Nov 30']);
  });

  it('orders a day\u2019s items by calendar time ascending', () => {
    const rows: ScheduleRow[] = [
      personalRow('pLate', '2026-11-30T15:30:00'),
      sessionRow('reserved', session('sEarly', '2026-11-30', '07:45')),
      sessionRow('favorite', session('sMid', '2026-11-30', '12:00')),
      sessionRow('reserved', session('other', '2026-12-01', '09:00')),
    ];
    const level = buildScheduleTreeLevel(rows, ['2026-11-30']);
    const items = level.entries
      .filter((e) => e.kind === 'item')
      .map((e) => (e as { row: ScheduleRow }).row.id);
    expect(items).toEqual(['sEarly', 'sMid', 'pLate']);
  });

  it('lists the Unscheduled folder\u2019s items', () => {
    const rows: ScheduleRow[] = [
      sessionRow('favorite', session('s2', undefined)),
      sessionRow('reserved', session('s1', '2026-11-30')),
    ];
    const level = buildScheduleTreeLevel(rows, [UNSCHEDULED_KEY]);
    expect(level.entries[0]).toEqual({ kind: 'parent' });
    const items = level.entries.filter((e) => e.kind === 'item');
    expect(items.map((e) => (e as { row: ScheduleRow }).row.id)).toEqual(['s2']);
    expect(level.breadcrumb).toEqual(['root', UNSCHEDULED_LABEL]);
  });
});

describe('scheduleTree.scheduleStartStamp', () => {
  it('stamps a session row from its sessionTime date + time', () => {
    expect(scheduleStartStamp(sessionRow('reserved', session('s1', '2026-11-30', '09:00')))).toBe(
      'Mon Nov 30 09:00',
    );
  });

  it('stamps a personal-time row from its parsed wall-clock startDateTime', () => {
    expect(scheduleStartStamp(personalRow('p1', '2026-12-01T14:30:00'))).toBe('Tue Dec 1 14:30');
  });

  it('shows the placeholder for a session with no sessionTime', () => {
    expect(scheduleStartStamp(sessionRow('favorite', session('s2', undefined)))).toBe(
      NO_START_STAMP,
    );
  });

  it('shows the placeholder for a personal block with an unparseable start', () => {
    expect(scheduleStartStamp(personalRow('p2', 'not-a-timestamp'))).toBe(NO_START_STAMP);
  });

  it('stamps the date alone when a session has a date but no clock time', () => {
    expect(scheduleStartStamp(sessionRow('reserved', session('s3', '2026-11-30', '')))).toBe(
      'Mon Nov 30',
    );
  });
});
