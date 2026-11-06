// Catalog_Tree — path stack to QueryState folding.
//
// A tree path is a stack of (dimension, value) steps accumulated by descending
// folders. `pathToQueryState` folds the stack onto an EMPTY {@link QueryState}
// so the Query_Engine can resolve the exact session set for the path: each step
// pushes a single-value predicate, and the engine's AND-across-dimensions
// behavior is reused unchanged. `typeLevel` pushes BOTH a type and a level
// predicate (the engine ANDs them). `timeOfDay` steps carry no QueryState
// mapping and are intentionally skipped here — the level builder applies the
// time bucket locally after the query runs. The shared QueryState type is only
// read, never mutated.

import type { QueryState, SortField } from '@reinvent-commander/shared';
import { decodeTypeLevel, type DimensionId } from './dimensions.js';

/** One descent in the tree: a dimension and the value chosen within it. */
export interface PathStep {
  dimension: DimensionId;
  value: string;
}

/** A tree path from the root (empty array) down to the current level. */
export type Path = PathStep[];

/** The sort carried through a path so folder contents respect the active F9 sort. */
export interface SortSpec {
  sortField?: SortField;
  sortDir: QueryState['sortDir'];
}

/** Push a single value onto a category array, creating it if absent. */
function pushCategory(
  categories: QueryState['categories'],
  key: keyof QueryState['categories'],
  value: string,
): void {
  const existing = categories[key];
  if (existing) existing.push(value);
  else categories[key] = [value];
}

/** Push a single value onto a facet array, creating it if absent. */
function pushFacet(facets: QueryState['facets'], key: 'tracks' | 'topics' | 'services', value: string): void {
  const existing = facets[key];
  if (existing) existing.push(value);
  else facets[key] = [value];
}

/**
 * Fold a tree path into a fresh {@link QueryState} the Query_Engine understands.
 * Starts from an empty state and pushes one predicate per step:
 *   - day      → categories.day
 *   - track    → facets.tracks
 *   - topic    → facets.topics
 *   - services → facets.services
 *   - typeLevel→ categories.type AND categories.level (decoded pair)
 *   - timeOfDay→ (skipped; applied by the level builder after the query)
 * The sort field/direction are carried through unchanged.
 */
export function pathToQueryState(path: Path, sort: SortSpec): QueryState {
  const state: QueryState = {
    term: '',
    categories: {},
    facets: {},
    sortDir: sort.sortDir,
  };
  if (sort.sortField) state.sortField = sort.sortField;

  for (const step of path) {
    switch (step.dimension) {
      case 'day':
        pushCategory(state.categories, 'day', step.value);
        break;
      case 'track':
        pushFacet(state.facets, 'tracks', step.value);
        break;
      case 'topic':
        pushFacet(state.facets, 'topics', step.value);
        break;
      case 'services':
        pushFacet(state.facets, 'services', step.value);
        break;
      case 'typeLevel': {
        const { type, level } = decodeTypeLevel(step.value);
        if (type) pushCategory(state.categories, 'type', type);
        if (level) pushCategory(state.categories, 'level', level);
        break;
      }
      case 'timeOfDay':
        // Virtual dimension: no QueryState mapping. The level builder filters
        // the day's rows by bucketOf() after runQuery has applied the day.
        break;
    }
  }

  return state;
}
