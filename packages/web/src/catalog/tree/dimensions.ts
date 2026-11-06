// Catalog_Tree — data-derived dimension definitions.
//
// The folder tree offers a fixed LIST of candidate top-level dimensions (Day,
// Track, combined Type+Level, Topic, Services), but their PRESENCE and all
// their VALUES are derived from the loaded catalog — a dimension no session
// carries is omitted, and no value is ever hard-coded. Each real dimension maps
// to a field of the Query_Engine's {@link FacetValueSets}, and descending a
// value pushes the matching {@link QueryState} predicate (see pathState.ts).
// `timeOfDay` is a virtual dimension: it has no QueryState field and is only
// valid inside a `day/<date>` path, where the level builder filters by bucket.

import type { FacetValueSets } from '../../query/searchIndex.js';

/**
 * The dimension identifiers the tree understands. The first five are real,
 * data-backed dimensions; `timeOfDay` is virtual (only valid inside a day).
 */
export type DimensionId = 'day' | 'track' | 'typeLevel' | 'topic' | 'services' | 'timeOfDay';

/**
 * The ordered list of candidate top-level dimensions. Their presence at the
 * root is filtered to those with a non-empty value set in the loaded catalog;
 * the ORDER here is the display order.
 */
export const TOP_LEVEL_DIMENSIONS: readonly DimensionId[] = [
  'day',
  'track',
  'typeLevel',
  'topic',
  'services',
] as const;

/** How a real dimension draws its distinct values from a {@link FacetValueSets}. */
type ValueSource =
  | { kind: 'category'; field: 'day' | 'type' | 'level' }
  | { kind: 'facet'; field: 'tracks' | 'topics' | 'services' }
  | { kind: 'typeLevel' };

/** Static metadata for a real dimension: its display name and value source. */
export interface DimensionMeta {
  id: DimensionId;
  displayName: string;
  valueSource: ValueSource;
}

/**
 * Metadata for the real dimensions. `timeOfDay` is intentionally absent: it is
 * virtual and handled directly by the level builder, not via a value source.
 */
export const DIMENSION_META: Record<Exclude<DimensionId, 'timeOfDay'>, DimensionMeta> = {
  day: { id: 'day', displayName: 'Day', valueSource: { kind: 'category', field: 'day' } },
  track: { id: 'track', displayName: 'Track', valueSource: { kind: 'facet', field: 'tracks' } },
  typeLevel: { id: 'typeLevel', displayName: 'Type + Level', valueSource: { kind: 'typeLevel' } },
  topic: { id: 'topic', displayName: 'Topic', valueSource: { kind: 'facet', field: 'topics' } },
  services: {
    id: 'services',
    displayName: 'Services',
    valueSource: { kind: 'facet', field: 'services' },
  },
};

/** Unit-separator (U+241F) joining a (type, level) pair into one folder value. */
export const TYPE_LEVEL_SEP = '\u241F';

/**
 * Encode a (type, level) pair into a single `typeLevel` folder value. Either
 * part may be an empty string when the session omits it; decoding is exact.
 */
export function encodeTypeLevel(type: string, level: string): string {
  return `${type}${TYPE_LEVEL_SEP}${level}`;
}

/** Decode a `typeLevel` folder value back into its `(type, level)` pair. */
export function decodeTypeLevel(value: string): { type: string; level: string } {
  const sep = value.indexOf(TYPE_LEVEL_SEP);
  if (sep === -1) return { type: value, level: '' };
  return { type: value.slice(0, sep), level: value.slice(sep + TYPE_LEVEL_SEP.length) };
}

/**
 * The distinct values a real dimension offers globally in a catalog, drawn from
 * its {@link FacetValueSets} source. For `typeLevel` the pairs are not stored in
 * the value sets, so this returns an empty list — the present pairs are derived
 * from the filtered rows by the level builder, which is the only place the
 * combined dimension's values matter.
 */
export function dimensionValues(dimension: DimensionId, facetValues: FacetValueSets): string[] {
  if (dimension === 'timeOfDay') return [];
  const meta = DIMENSION_META[dimension];
  switch (meta.valueSource.kind) {
    case 'category':
      return facetValues[meta.valueSource.field];
    case 'facet':
      return facetValues.facets[meta.valueSource.field];
    case 'typeLevel':
      return [];
  }
}
