// Catalog_Tree — search collapse/restore and parent-selection restore.
//
// Typing in the single search box collapses the tree to a flat Query_Engine
// result spanning all paths; clearing the box restores the tree at the level
// the user left. `onSearchChange` is the pure state transition driving this:
// on the first non-empty term it saves the current path, and on clearing it
// restores the saved path. `parentSelectionIndex` computes, after ascending via
// "..", the row to re-select so focus returns to the folder just left.

import type { TreeEntry } from './treeModel.js';
import type { DimensionId } from './dimensions.js';
import type { Path } from './pathState.js';

/** The tree's view state: the current path and a path saved while searching. */
export interface TreeViewState {
  /** The level currently shown (empty = root). */
  path: Path;
  /** The path saved when search began; null when not collapsed by search. */
  savedPath: Path | null;
}

/**
 * Transition the view state when the search term's emptiness changes.
 *   - term becomes non-empty and nothing is saved yet → save the current path
 *     (the panel renders the flat result from here on),
 *   - term clears and a path was saved → restore it and clear the save,
 *   - otherwise → unchanged.
 * Pure: the input state is never mutated.
 */
export function onSearchChange(view: TreeViewState, termNonEmpty: boolean): TreeViewState {
  if (termNonEmpty) {
    if (view.savedPath !== null) return view;
    return { path: view.path, savedPath: view.path };
  }
  if (view.savedPath === null) return view;
  return { path: view.savedPath, savedPath: null };
}

/**
 * Whether the Catalog_Panel shows the folder tree for the given search term.
 * The tree IS the panel — there is no List/Tree toggle — so it ALWAYS renders
 * EXCEPT while a non-empty (non-whitespace) search term collapses it to the
 * flat Query_Engine result across all folders (Requirement 17.1, 17.8). Returns
 * true for an empty/whitespace term (tree) and false for an active search (flat).
 */
export function showCatalogTreeForTerm(term: string): boolean {
  return term.trim() === '';
}

/**
 * The row index to re-select after ascending one level via "..". Given the
 * parent level's rendered `entries` and the `(dimension, value)` of the folder
 * just left, returns the index of that folder's row, or 0 (the ".." row) when
 * it can no longer be found.
 */
export function parentSelectionIndex(
  entries: TreeEntry[],
  dimension: DimensionId,
  value: string,
): number {
  const idx = entries.findIndex(
    (e) => e.kind === 'folder' && e.dimension === dimension && e.value === value,
  );
  return idx === -1 ? 0 : idx;
}
