// Unit tests for the dimension definitions (Catalog_Tree).
//
// Feature: reinvent-commander
//
// Covers typeLevel encode/decode round-tripping, the top-level dimension list,
// and value sourcing from a FacetValueSets. Validates Requirement 17 (data-
// derived dimensions; combined Type+Level).

import { describe, expect, it } from 'vitest';
import type { FacetValueSets } from '../../query/searchIndex.js';
import {
  decodeTypeLevel,
  dimensionValues,
  encodeTypeLevel,
  TOP_LEVEL_DIMENSIONS,
  TYPE_LEVEL_SEP,
} from './dimensions.js';

function emptyFacetValues(): FacetValueSets {
  return {
    day: [],
    track: [],
    type: [],
    level: [],
    location: [],
    facets: {
      tracks: [],
      topics: [],
      industries: [],
      areasOfInterest: [],
      roles: [],
      services: [],
      segments: [],
      features: [],
      customerPersonas: [],
      experiences: [],
      additionalActivities: [],
      focusAreas: [],
    },
  };
}

describe('typeLevel encode/decode', () => {
  it('round-trips a (type, level) pair through the unit separator', () => {
    const encoded = encodeTypeLevel('Breakout', '300');
    expect(encoded).toBe(`Breakout${TYPE_LEVEL_SEP}300`);
    expect(decodeTypeLevel(encoded)).toEqual({ type: 'Breakout', level: '300' });
  });

  it('handles a missing part on either side', () => {
    expect(decodeTypeLevel(encodeTypeLevel('Workshop', ''))).toEqual({
      type: 'Workshop',
      level: '',
    });
    expect(decodeTypeLevel(encodeTypeLevel('', '200'))).toEqual({ type: '', level: '200' });
  });
});

describe('top-level dimensions + value sourcing', () => {
  it('lists the five candidate dimensions in display order', () => {
    expect(TOP_LEVEL_DIMENSIONS).toEqual(['day', 'track', 'typeLevel', 'topic', 'services']);
  });

  it('draws values from the matching FacetValueSets field', () => {
    const fv = emptyFacetValues();
    fv.day = ['2026-11-30'];
    fv.facets.tracks = ['AI/ML'];
    fv.facets.topics = ['a'];
    fv.facets.services = ['svc'];

    expect(dimensionValues('day', fv)).toEqual(['2026-11-30']);
    expect(dimensionValues('track', fv)).toEqual(['AI/ML']);
    expect(dimensionValues('topic', fv)).toEqual(['a']);
    expect(dimensionValues('services', fv)).toEqual(['svc']);
    // typeLevel pairs are derived from rows, not the value sets.
    expect(dimensionValues('typeLevel', fv)).toEqual([]);
    expect(dimensionValues('timeOfDay', fv)).toEqual([]);
  });
});
