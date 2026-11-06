// Unit tests for the search collapse/restore state (Catalog_Tree).
//
// Feature: reinvent-commander
//
// Covers save-on-first-nonempty / restore-on-clear transitions and the
// parent-selection-index restore on ascend. Validates Requirement 17 (search
// collapses the tree; ascending restores selection to the folder left).

import { describe, expect, it } from 'vitest';
import {
  onSearchChange,
  parentSelectionIndex,
  showCatalogTreeForTerm,
  type TreeViewState,
} from './searchCollapse.js';
import type { Path } from './pathState.js';
import type { TreeEntry } from './treeModel.js';

const PATH: Path = [{ dimension: 'day', value: '2026-11-30' }];

describe('showCatalogTreeForTerm', () => {
  it('renders the folder tree by default — no toggle, empty search', () => {
    // The tree IS the panel (Requirement 17.1): with no search term the
    // Catalog_Panel always shows the folder tree, never a flat list.
    expect(showCatalogTreeForTerm('')).toBe(true);
  });

  it('treats a whitespace-only term as no search (still the tree)', () => {
    expect(showCatalogTreeForTerm('   ')).toBe(true);
  });

  it('collapses to the flat search result when a term is active', () => {
    // A non-empty term collapses the tree to the flat Query_Engine result
    // across all folders (Requirement 17.8).
    expect(showCatalogTreeForTerm('keynote')).toBe(false);
    expect(showCatalogTreeForTerm('  monday  ')).toBe(false);
  });
});

describe('onSearchChange', () => {
  it('saves the current path on the first non-empty term', () => {
    const view: TreeViewState = { path: PATH, savedPath: null };
    const next = onSearchChange(view, true);
    expect(next.savedPath).toEqual(PATH);
    expect(next.path).toEqual(PATH);
  });

  it('does not overwrite an already-saved path on later non-empty terms', () => {
    const view: TreeViewState = { path: [], savedPath: PATH };
    const next = onSearchChange(view, true);
    expect(next).toBe(view);
  });

  it('restores the saved path when the term clears', () => {
    const view: TreeViewState = { path: [], savedPath: PATH };
    const next = onSearchChange(view, false);
    expect(next.path).toEqual(PATH);
    expect(next.savedPath).toBeNull();
  });

  it('is a no-op when clearing with nothing saved', () => {
    const view: TreeViewState = { path: PATH, savedPath: null };
    expect(onSearchChange(view, false)).toBe(view);
  });
});

describe('parentSelectionIndex', () => {
  const entries: TreeEntry[] = [
    { kind: 'parent' },
    { kind: 'folder', dimension: 'track', value: 'AI/ML', label: 'AI/ML', count: 2 },
    { kind: 'folder', dimension: 'track', value: 'Compute', label: 'Compute', count: 1 },
  ];

  it('returns the row index of the folder just left', () => {
    expect(parentSelectionIndex(entries, 'track', 'Compute')).toBe(2);
  });

  it('falls back to the parent row when the folder is gone', () => {
    expect(parentSelectionIndex(entries, 'track', 'Missing')).toBe(0);
  });
});
