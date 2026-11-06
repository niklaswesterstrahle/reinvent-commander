// Catalog_Tree — pure tree-level builder, reusing the Query_Engine.
//
// The tree is a visual front-end to `runQuery`: every level's session set is
// exactly the Query_Engine result for the accumulated path. Like a real
// filesystem, EVERY level shows its child folders on top AND the Session_Files
// matching the accumulated path below them — the file list is never hidden
// until a leaf. `rootDimensions` lists the top-level dimension folders present
// in the catalog; `buildTreeLevel` resolves the current path to its sessions
// via `runQuery(pathToQueryState)`, decides the child folders (dimension-pick at
// the root, value folders inside a dimension, time-of-day buckets inside a day,
// or none at a leaf), then appends the matching Session_Files, keeping folders
// always before files and a ".." parent on non-root levels. A dimension-pick
// (trailing sentinel) imposes no predicate, so it does not narrow the files;
// each concrete value deeper narrows them further. Nothing here reimplements
// filtering — it only composes single-value predicates the engine ANDs together.

import type { Session, SortField } from '@reinvent-commander/shared';
import { dayOrderKey, formatDayLabel } from '../../query/dayMatching.js';
import { runQuery } from '../../query/queryEngine.js';
import type { SearchIndex } from '../../query/searchIndex.js';
import {
  decodeTypeLevel,
  DIMENSION_META,
  encodeTypeLevel,
  TOP_LEVEL_DIMENSIONS,
  type DimensionId,
} from './dimensions.js';
import { pathToQueryState, type Path, type PathStep, type SortSpec } from './pathState.js';
import { bucketOf, TIME_BUCKET_LABELS, TIME_BUCKET_ORDER, type TimeBucket } from './timeBuckets.js';
import type { TreeEntry, TreeLevel } from './treeModel.js';

/**
 * Sentinel path-step value meaning "this dimension is selected but no value has
 * been chosen yet" — pushed by descending a root dimension folder. A level with
 * a trailing sentinel step shows that dimension's value folders.
 */
export const DIMENSION_SENTINEL = '';

/** Build a folder entry, filling in count and label. */
function folderEntry(
  dimension: DimensionId,
  value: string,
  label: string,
  count: number,
): Extract<TreeEntry, { kind: 'folder' }> {
  return { kind: 'folder', dimension, value, label, count };
}

/** The display label for a dimension value (day/typeLevel/time buckets specialised). */
function valueLabel(dimension: DimensionId, value: string): string {
  switch (dimension) {
    case 'day':
      return formatDayLabel(value);
    case 'typeLevel': {
      const { type, level } = decodeTypeLevel(value);
      if (type && level) return `${type} · ${level}`;
      return type || level;
    }
    case 'timeOfDay':
      return TIME_BUCKET_LABELS[value as TimeBucket] ?? value;
    default:
      return value;
  }
}

/**
 * The root dimension folders: one per {@link TOP_LEVEL_DIMENSIONS} whose value
 * set is non-empty in the loaded catalog (dimensions no session carries are
 * omitted). The folder `value` is the {@link DIMENSION_SENTINEL}; descending it
 * pushes a `{ dimension, value: '' }` step. The count is the number of sessions
 * that carry at least one value for the dimension.
 */
export function rootDimensions(index: SearchIndex): Array<Extract<TreeEntry, { kind: 'folder' }>> {
  const folders: Array<Extract<TreeEntry, { kind: 'folder' }>> = [];
  for (const dimension of TOP_LEVEL_DIMENSIONS) {
    const present = presentValues(dimension, index.sessions);
    if (present.size === 0) continue;
    const meta = DIMENSION_META[dimension as Exclude<DimensionId, 'timeOfDay'>];
    let count = 0;
    for (const session of index.sessions) {
      if (sessionValuesFor(dimension, session).length > 0) count += 1;
    }
    folders.push(folderEntry(dimension, DIMENSION_SENTINEL, meta.displayName, count));
  }
  return folders;
}

/** The distinct `typeLevel` / dimension values a single session contributes. */
function sessionValuesFor(dimension: DimensionId, session: Session): string[] {
  switch (dimension) {
    case 'day':
      return session.sessionTime?.date ? [session.sessionTime.date] : [];
    case 'track':
      return session.tracks ?? [];
    case 'topic':
      return session.topics ?? [];
    case 'services':
      return session.services ?? [];
    case 'typeLevel':
      if (!session.type && !session.level) return [];
      return [encodeTypeLevel(session.type ?? '', session.level ?? '')];
    case 'timeOfDay':
      return [bucketOf(session.sessionTime?.time)];
  }
}

/** The set of values present for a dimension across a session list. */
function presentValues(dimension: DimensionId, sessions: readonly Session[]): Set<string> {
  const values = new Set<string>();
  for (const session of sessions) {
    for (const v of sessionValuesFor(dimension, session)) values.add(v);
  }
  return values;
}

/**
 * Comparator ordering values for display. Day folders sort chronologically by
 * their underlying ISO date (via the Query_Engine's `dayOrderKey`, so any
 * unresolvable date — an "Unscheduled" day — sorts last) rather than by their
 * formatted label, which would wrongly sort "Fri" before "Mon". Every other
 * dimension sorts by its display label.
 */
function compareValues(dimension: DimensionId, a: string, b: string): number {
  if (dimension === 'day') {
    return dayOrderKey(a).localeCompare(dayOrderKey(b));
  }
  return valueLabel(dimension, a).localeCompare(valueLabel(dimension, b));
}

/**
 * The child dimension a level drills into, given the path. Returns `undefined`
 * for a leaf level (the path has resolved a value for its active dimension and
 * no further dimension follows).
 */
function activeDimensionStep(path: Path): PathStep | undefined {
  return path.length ? path[path.length - 1] : undefined;
}

/**
 * Build the rendered {@link TreeLevel} for a path. Resolves the path's sessions
 * via the Query_Engine and assembles entries as
 * [parent?, ...folders sorted by label, ...files]; folders always precede files.
 *
 * Like a real filesystem, EVERY level shows both its child folders AND the
 * Session_Files matching the accumulated path filter below them — the file list
 * is never hidden until a leaf. The file set is exactly the Query_Engine result
 * for the accumulated CONCRETE-value predicates: a dimension-pick (trailing
 * sentinel) adds no predicate, so it does not narrow the files; each concrete
 * value deeper narrows them further. At the root the predicate set is empty, so
 * the files are the whole catalog.
 */
export function buildTreeLevel(index: SearchIndex, path: Path, sort: SortSpec): TreeLevel {
  const breadcrumb = buildBreadcrumb(path);
  const nonRoot = path.length > 0;
  const entries: TreeEntry[] = [];
  if (nonRoot) entries.push({ kind: 'parent' });

  const last = nonRoot ? (activeDimensionStep(path) as PathStep) : undefined;

  // Resolve the file set for this level via the Query_Engine. A trailing
  // sentinel (dimension picked, no value chosen) imposes NO predicate, so the
  // query runs against the ANCESTOR path — the files do not narrow. Every other
  // path folds its concrete-value predicates. The empty root path yields the
  // whole catalog.
  const queryPath = last && last.value === DIMENSION_SENTINEL ? path.slice(0, -1) : path;
  let rows = runQuery(index, pathToQueryState(queryPath, sort)).rows;

  // A chosen time-of-day bucket has no Query_Engine mapping, so filter the day's
  // rows by bucketOf here (the only filter the tree applies beyond the engine).
  if (last && last.dimension === 'timeOfDay') {
    rows = rows.filter((session) => bucketOf(session.sessionTime?.time) === last.value);
  }

  // Folders first: the child folders for this level.
  if (!nonRoot) {
    // Root: the dimension-pick folders.
    entries.push(...rootDimensions(index));
  } else if (last!.value === DIMENSION_SENTINEL) {
    // A dimension was just picked → its value folders, counted from the rows.
    pushValueFolders(entries, last!.dimension, rows);
  } else if (last!.dimension === 'day') {
    // Inside day/<date> with a chosen date → time-of-day bucket folders.
    pushTimeBucketFolders(entries, rows);
  }
  // Any other resolved value (concrete value leaf, or a chosen time bucket) has
  // no child folders.

  // Files below the folders: the Session_Files matching the accumulated path.
  for (const session of rows) entries.push({ kind: 'file', session });

  return { entries, breadcrumb };
}

/** Append sorted value folders for a dimension, counts from the filtered rows. */
function pushValueFolders(entries: TreeEntry[], dimension: DimensionId, rows: Session[]): void {
  const counts = new Map<string, number>();
  for (const session of rows) {
    for (const v of sessionValuesFor(dimension, session)) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  const values = [...counts.keys()].sort((a, b) => compareValues(dimension, a, b));
  for (const value of values) {
    entries.push(
      folderEntry(dimension, value, valueLabel(dimension, value), counts.get(value) ?? 0),
    );
  }
}

/** Append time-of-day bucket folders present in a day's rows, Unscheduled last. */
function pushTimeBucketFolders(entries: TreeEntry[], rows: Session[]): void {
  const counts = new Map<TimeBucket, number>();
  for (const session of rows) {
    const bucket = bucketOf(session.sessionTime?.time);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  for (const bucket of TIME_BUCKET_ORDER) {
    const count = counts.get(bucket);
    if (!count) continue;
    entries.push(folderEntry('timeOfDay', bucket, TIME_BUCKET_LABELS[bucket], count));
  }
}

/** Build the breadcrumb labels from the root through the path. */
function buildBreadcrumb(path: Path): string[] {
  const crumbs = ['root'];
  for (const step of path) {
    if (step.value === DIMENSION_SENTINEL) {
      crumbs.push(DIMENSION_META[step.dimension as Exclude<DimensionId, 'timeOfDay'>].displayName);
    } else {
      crumbs.push(valueLabel(step.dimension, step.value));
    }
  }
  return crumbs;
}

/** Re-export the sort field type used by callers assembling a {@link SortSpec}. */
export type { SortField };
