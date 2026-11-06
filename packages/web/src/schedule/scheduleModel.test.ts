import { describe, expect, it } from 'vitest';
import type { PersonalTime, Schedule, Session } from '@reinvent-commander/shared';
import {
  ABSENT_SESSION_TITLE,
  applyFavoriteResult,
  applyReservationResult,
  applySchedule,
  buildScheduleRows,
  emptyScheduleModel,
  loadingSessionTitle,
  removeFavorite,
  removePersonalTime,
  removeReservation,
  upsertPersonalTime,
  type SessionLookup,
} from './scheduleModel.js';

/** A minimal session with a sessionTime so conflict math can resolve it. */
function session(id: string, date: string, time: string, length = '60'): Session {
  return {
    sessionId: id,
    title: `Title ${id}`,
    sessionTime: { date, time, length },
  };
}

function pt(id: string, startDateTime: string, endDateTime: string): PersonalTime {
  return {
    personalTimeId: id,
    startDateTime,
    endDateTime,
    title: `PT ${id}`,
    description: 'desc',
  };
}

function lookupFrom(sessions: Session[]): SessionLookup {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  return (id) => byId.get(id);
}

describe('scheduleModel — applySchedule fold', () => {
  it('preserves prior state when the GetSchedule result is null (call failed)', () => {
    const prior = applySchedule(emptyScheduleModel(), {
      reserved: ['a'],
      favorites: ['b'],
      personalTime: [],
    });
    expect(applySchedule(prior, null)).toBe(prior);
    expect(applySchedule(prior, undefined)).toBe(prior);
  });

  it('folds ids and dedupes', () => {
    const schedule: Schedule = {
      reserved: ['a', 'a', 'b'],
      favorites: ['c', 'c'],
      personalTime: [pt('p1', '2026-12-01T09:00:00', '2026-12-01T10:00:00')],
    };
    const model = applySchedule(emptyScheduleModel(), schedule);
    expect(model.reserved).toEqual(['a', 'b']);
    expect(model.favorites).toEqual(['c']);
    expect(model.personalTime).toHaveLength(1);
  });
});

describe('scheduleModel — apply only successful bulk results', () => {
  it('unions only successful favorites, never failed', () => {
    const model = emptyScheduleModel();
    const next = applyFavoriteResult(model, {
      successful: ['a', 'b'],
      failed: [{ sessionId: 'c', code: 'alreadyFavorited' }],
    });
    expect(next.favorites).toEqual(['a', 'b']);
    expect(next.favorites).not.toContain('c');
  });

  it('unions only successful reservations, never failed, and dedupes against prior', () => {
    const model = applyReservationResult(emptyScheduleModel(), {
      successful: ['a'],
      failed: [],
    });
    const next = applyReservationResult(model, {
      successful: ['a', 'b'],
      failed: [{ sessionId: 'd', code: 'sessionFull' }],
    });
    expect(next.reserved).toEqual(['a', 'b']);
    expect(next.reserved).not.toContain('d');
  });
});

describe('scheduleModel — add/remove', () => {
  it('removes favorites and reservations and upserts/removes personal time', () => {
    let model = applySchedule(emptyScheduleModel(), {
      reserved: ['a'],
      favorites: ['b'],
      personalTime: [],
    });
    model = removeFavorite(model, 'b');
    model = removeReservation(model, 'a');
    expect(model.favorites).toEqual([]);
    expect(model.reserved).toEqual([]);

    const block = pt('p1', '2026-12-01T09:00:00', '2026-12-01T10:00:00');
    model = upsertPersonalTime(model, block);
    expect(model.personalTime).toEqual([block]);

    const edited = { ...block, title: 'Renamed' };
    model = upsertPersonalTime(model, edited);
    expect(model.personalTime).toEqual([edited]);

    model = removePersonalTime(model, 'p1');
    expect(model.personalTime).toEqual([]);
  });
});

describe('scheduleModel — buildScheduleRows', () => {
  it('looks up titles and marks sessions absent from the catalog as placeholders', () => {
    const model = applySchedule(emptyScheduleModel(), {
      reserved: ['present', 'missing'],
      favorites: [],
      personalTime: [],
    });
    const rows = buildScheduleRows(model, lookupFrom([session('present', '2026-12-01', '09:00')]));
    expect(rows).toHaveLength(2);
    const present = rows.find((r) => r.id === 'present');
    const missing = rows.find((r) => r.id === 'missing');
    expect(present?.placeholder).toBe(false);
    expect(present?.title).toBe('Title present');
    expect(missing?.placeholder).toBe(true);
    expect(missing?.title).toBe(ABSENT_SESSION_TITLE);
  });

  it('shows the raw sessionId (not the absent placeholder) while the catalog is still loading', () => {
    // The schedule renders BEFORE the catalog walk finishes, so an id that is
    // not yet in the store must NOT be flagged as "absent from catalog"; it
    // shows the sessionId and fills in once the catalog arrives.
    const model = applySchedule(emptyScheduleModel(), {
      reserved: ['SVS404'],
      favorites: [],
      personalTime: [],
    });
    const emptyLookup: SessionLookup = () => undefined;
    const rows = buildScheduleRows(model, emptyLookup, /* catalogComplete */ false);
    expect(rows).toHaveLength(1);
    expect(rows[0].placeholder).toBe(false);
    expect(rows[0].title).toBe(loadingSessionTitle('SVS404'));
    expect(rows[0].title).toBe('SVS404');
  });

  it('re-resolves titles once the catalog populates (schedule-first load order)', () => {
    // Model is fixed; only the catalog lookup changes from empty (walk running)
    // to populated (walk complete). Rebuilding the rows must swap the sessionId
    // placeholder for the real title with no change to the schedule itself.
    const model = applySchedule(emptyScheduleModel(), {
      reserved: ['present'],
      favorites: [],
      personalTime: [],
    });

    // Catalog still loading: no session resolved, sessionId shown.
    const loadingRows = buildScheduleRows(model, () => undefined, false);
    expect(loadingRows[0].title).toBe('present');
    expect(loadingRows[0].placeholder).toBe(false);
    expect(loadingRows[0].session).toBeUndefined();

    // Catalog complete and the session is now present: title re-resolves.
    const populated = lookupFrom([session('present', '2026-12-01', '09:00')]);
    const resolvedRows = buildScheduleRows(model, populated, true);
    expect(resolvedRows[0].title).toBe('Title present');
    expect(resolvedRows[0].placeholder).toBe(false);
    expect(resolvedRows[0].session?.sessionId).toBe('present');
  });

  it('lists a session once when it is both reserved and favorited (under reserved)', () => {
    const model = applySchedule(emptyScheduleModel(), {
      reserved: ['a'],
      favorites: ['a'],
      personalTime: [],
    });
    const rows = buildScheduleRows(model, lookupFrom([session('a', '2026-12-01', '09:00')]));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('reserved');
  });

  it('marks overlapping items as conflicting and leaves disjoint items clear', () => {
    const model = applySchedule(emptyScheduleModel(), {
      reserved: ['x', 'y'],
      favorites: [],
      personalTime: [pt('p1', '2026-12-01T09:30:00', '2026-12-01T10:30:00')],
    });
    // x 09:00-10:00 overlaps p1 09:30-10:30; y 11:00-12:00 is disjoint.
    const rows = buildScheduleRows(
      model,
      lookupFrom([session('x', '2026-12-01', '09:00'), session('y', '2026-12-01', '11:00')]),
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.x.conflict).toBe(true);
    expect(byId.p1.conflict).toBe(true);
    expect(byId.y.conflict).toBe(false);
  });
});
