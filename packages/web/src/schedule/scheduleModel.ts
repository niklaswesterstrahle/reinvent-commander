// Schedule_Panel pure model (Task 16.1).
//
// Folds a GetSchedule result (reserved/favorites ids + personal-time blocks)
// into display rows the Schedule_Panel renders: each session id is paired with
// its title from the CatalogStore, with a placeholder when the id is absent so
// the rest of the schedule still renders. A bulk favorite/reservation outcome
// is applied by unioning ONLY the successful ids (never the failed ones).
// Conflict indicators come from FEAT-001 conflict.ts. All transforms are pure
// and immutable; a failed GetSchedule (a null fold) leaves state unchanged.

import type {
  AggregatedBulkResult,
  BulkResult,
  PersonalTime,
  Schedule,
  Session,
} from '@reinvent-commander/shared';
import { detectScheduleConflicts } from './conflict.js';

/** The kind of a schedule row, mirroring the three schedule groups. */
export type ScheduleRowKind = 'reserved' | 'favorite' | 'personalTime';

/** A single rendered Schedule_Panel row. */
export interface ScheduleRow {
  /** Stable key: the sessionId or personalTimeId. */
  id: string;
  kind: ScheduleRowKind;
  /** Display title: the catalog session title, personal-time title, or a placeholder. */
  title: string;
  /** True when the id is a session not present in the CatalogStore. */
  placeholder: boolean;
  /** The resolved session, when present in the store (for reservability/seat band). */
  session?: Session;
  /** The personal-time block, for personalTime rows. */
  personalTime?: PersonalTime;
  /** True when this item overlaps another scheduled item. */
  conflict: boolean;
}

/** The immutable Schedule_Panel state. */
export interface ScheduleModel {
  /** Reserved sessionIds, in order. */
  reserved: string[];
  /** Favorited sessionIds, in order. */
  favorites: string[];
  /** Personal-time blocks, in order. */
  personalTime: PersonalTime[];
}

/** Looks up a catalog session by id (e.g. CatalogStore.get). */
export type SessionLookup = (sessionId: string) => Session | undefined;

/** Placeholder title shown for a scheduled session absent from the catalog. */
export const ABSENT_SESSION_TITLE = '(session not in catalog)';

/**
 * Placeholder title shown for a scheduled session whose title is not yet known
 * because the catalog walk is still in flight. The schedule renders first (so
 * the attendee's reserved/favorited items appear immediately), and these rows
 * re-resolve to their real titles automatically once the catalog populates.
 * The raw sessionId is shown so the row is still identifiable in the meantime.
 */
export function loadingSessionTitle(sessionId: string): string {
  return sessionId;
}

/** An empty schedule model (the signed-out / pre-load state). */
export function emptyScheduleModel(): ScheduleModel {
  return { reserved: [], favorites: [], personalTime: [] };
}

/**
 * Fold a GetSchedule result into a {@link ScheduleModel}. A `null`/`undefined`
 * result means the GetSchedule call failed: the prior model is returned
 * unchanged so the panel preserves its content.
 */
export function applySchedule(
  prior: ScheduleModel,
  schedule: Schedule | null | undefined,
): ScheduleModel {
  if (!schedule) return prior;
  return {
    reserved: dedupe(schedule.reserved),
    favorites: dedupe(schedule.favorites),
    personalTime: [...schedule.personalTime],
  };
}

/**
 * Apply a bulk favorite outcome: union ONLY the successful ids into favorites.
 * Failed ids are never added. The order preserves prior favorites, then any
 * newly-successful ids in result order.
 */
export function applyFavoriteResult(
  model: ScheduleModel,
  result: BulkResult | AggregatedBulkResult,
): ScheduleModel {
  return { ...model, favorites: union(model.favorites, result.successful) };
}

/** Apply a bulk reservation outcome: union ONLY the successful ids into reserved. */
export function applyReservationResult(
  model: ScheduleModel,
  result: BulkResult | AggregatedBulkResult,
): ScheduleModel {
  return { ...model, reserved: union(model.reserved, result.successful) };
}

/** Remove a favorited sessionId (after a successful disassociate). */
export function removeFavorite(model: ScheduleModel, sessionId: string): ScheduleModel {
  return { ...model, favorites: model.favorites.filter((id) => id !== sessionId) };
}

/** Remove a reserved sessionId (after a successful cancel). */
export function removeReservation(model: ScheduleModel, sessionId: string): ScheduleModel {
  return { ...model, reserved: model.reserved.filter((id) => id !== sessionId) };
}

/** Upsert a personal-time block (insert on create, replace on edit). */
export function upsertPersonalTime(model: ScheduleModel, block: PersonalTime): ScheduleModel {
  const index = model.personalTime.findIndex((p) => p.personalTimeId === block.personalTimeId);
  const personalTime =
    index === -1
      ? [...model.personalTime, block]
      : model.personalTime.map((p) => (p.personalTimeId === block.personalTimeId ? block : p));
  return { ...model, personalTime };
}

/** Remove a personal-time block by id (after a successful delete). */
export function removePersonalTime(model: ScheduleModel, personalTimeId: string): ScheduleModel {
  return {
    ...model,
    personalTime: model.personalTime.filter((p) => p.personalTimeId !== personalTimeId),
  };
}

/**
 * Build the Schedule_Panel display rows for a model, looking up each session
 * title via `lookup` and marking a conflict on every item that overlaps
 * another scheduled item. Reserved rows are listed first, then favorites that
 * are not also reserved, then personal time.
 *
 * `catalogComplete` reflects whether the catalog walk has finished. The
 * schedule is loaded and rendered BEFORE the (slow) catalog walk, so a session
 * title may not be resolvable yet. While `catalogComplete` is false an
 * unresolved session shows its raw sessionId (via {@link loadingSessionTitle})
 * and is NOT flagged as a true "absent from catalog" placeholder — its title
 * fills in automatically once the catalog populates and this is rebuilt. Only
 * after the walk completes (`catalogComplete` true) does a still-unresolved id
 * become the {@link ABSENT_SESSION_TITLE} placeholder. Defaults to `true` so
 * existing callers see the completed-catalog behavior unchanged.
 */
export function buildScheduleRows(
  model: ScheduleModel,
  lookup: SessionLookup,
  catalogComplete = true,
): ScheduleRow[] {
  const sessionIds = unique([...model.reserved, ...model.favorites]);
  const resolved = sessionIds
    .map((id) => lookup(id))
    .filter((s): s is Session => s !== undefined);
  const conflicting = detectScheduleConflicts(resolved, model.personalTime);

  const rows: ScheduleRow[] = [];
  const reservedSet = new Set(model.reserved);

  for (const id of model.reserved) {
    rows.push(sessionRow(id, 'reserved', lookup, conflicting, catalogComplete));
  }
  for (const id of model.favorites) {
    // A favorited session that is also reserved is shown once, under reserved.
    if (reservedSet.has(id)) continue;
    rows.push(sessionRow(id, 'favorite', lookup, conflicting, catalogComplete));
  }
  for (const block of model.personalTime) {
    rows.push({
      id: block.personalTimeId,
      kind: 'personalTime',
      title: block.title,
      placeholder: false,
      personalTime: block,
      conflict: conflicting.has(block.personalTimeId),
    });
  }
  return rows;
}

/**
 * Build a session-backed row, resolving the title or a placeholder. An
 * unresolved id shows the real "absent" placeholder only once the catalog walk
 * has completed; while it is still loading the raw sessionId is shown and the
 * row is not flagged as a placeholder (the title re-resolves automatically when
 * the catalog arrives).
 */
function sessionRow(
  id: string,
  kind: 'reserved' | 'favorite',
  lookup: SessionLookup,
  conflicting: Set<string>,
  catalogComplete: boolean,
): ScheduleRow {
  const session = lookup(id);
  const unresolvedTitle = catalogComplete ? ABSENT_SESSION_TITLE : loadingSessionTitle(id);
  return {
    id,
    kind,
    title: session ? session.title : unresolvedTitle,
    // Flag as a placeholder only when the catalog is complete and the id truly
    // isn't there — not merely while the catalog is still loading.
    placeholder: session === undefined && catalogComplete,
    session,
    conflict: conflicting.has(id),
  };
}

/** Union two id lists preserving `base` order, appending new ids in `extra` order. */
function union(base: readonly string[], extra: readonly string[]): string[] {
  const seen = new Set(base);
  const result = [...base];
  for (const id of extra) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/** First-seen dedupe of an id list. */
function dedupe(ids: readonly string[]): string[] {
  return unique(ids);
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
