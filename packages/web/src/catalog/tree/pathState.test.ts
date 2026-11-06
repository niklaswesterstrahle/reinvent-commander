// Unit tests for the path → QueryState folding (Catalog_Tree).
//
// Feature: reinvent-commander
//
// Covers each dimension mapping to the right QueryState key, typeLevel pushing
// BOTH type and level, timeOfDay carrying no predicate, and sort pass-through.
// Validates Requirement 17 (tree reuses the Query_Engine's AND-across filter).

import { describe, expect, it } from 'vitest';
import { pathToQueryState, type Path } from './pathState.js';
import { encodeTypeLevel } from './dimensions.js';

const SORT = { sortField: 'day' as const, sortDir: 'asc' as const };

describe('pathToQueryState', () => {
  it('starts from an empty state', () => {
    const state = pathToQueryState([], SORT);
    expect(state.term).toBe('');
    expect(state.categories).toEqual({});
    expect(state.facets).toEqual({});
  });

  it('maps each dimension to its QueryState field', () => {
    const path: Path = [
      { dimension: 'day', value: '2026-11-30' },
      { dimension: 'track', value: 'AI/ML' },
      { dimension: 'topic', value: 'a' },
      { dimension: 'services', value: 'svc' },
    ];
    const state = pathToQueryState(path, SORT);
    expect(state.categories.day).toEqual(['2026-11-30']);
    expect(state.facets.tracks).toEqual(['AI/ML']);
    expect(state.facets.topics).toEqual(['a']);
    expect(state.facets.services).toEqual(['svc']);
  });

  it('pushes BOTH type and level for a typeLevel step', () => {
    const state = pathToQueryState(
      [{ dimension: 'typeLevel', value: encodeTypeLevel('Breakout', '300') }],
      SORT,
    );
    expect(state.categories.type).toEqual(['Breakout']);
    expect(state.categories.level).toEqual(['300']);
  });

  it('applies no predicate for a timeOfDay step', () => {
    const state = pathToQueryState(
      [
        { dimension: 'day', value: '2026-11-30' },
        { dimension: 'timeOfDay', value: 'morning' },
      ],
      SORT,
    );
    expect(state.categories.day).toEqual(['2026-11-30']);
    // Nothing else added by the virtual dimension.
    expect(Object.keys(state.categories)).toEqual(['day']);
    expect(state.facets).toEqual({});
  });

  it('carries the sort field and direction through', () => {
    const state = pathToQueryState([], { sortField: 'title', sortDir: 'desc' });
    expect(state.sortField).toBe('title');
    expect(state.sortDir).toBe('desc');
  });
});
