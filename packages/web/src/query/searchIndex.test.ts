// Unit tests for the search index: displayTitle stripping, haystack content,
// and per-facet value sets.

import { describe, expect, it } from 'vitest';
import type { Session } from '@reinvent-commander/shared';
import { buildSearchIndex, displayTitle, indexSession } from './searchIndex.js';

const base = (over: Partial<Session>): Session => ({
  sessionId: 's1',
  title: 'Title',
  ...over,
});

describe('displayTitle', () => {
  it('strips a leading prefix that duplicates the abbreviation', () => {
    expect(displayTitle(base({ abbreviation: 'AIM200', title: 'AIM200: Build with ML' }))).toBe(
      'Build with ML',
    );
  });

  it('strips a generic leading session-code pattern when no abbreviation prefix', () => {
    expect(displayTitle(base({ title: 'SVS301-R - Serverless deep dive' }))).toBe(
      'Serverless deep dive',
    );
  });

  it('leaves a title without a code prefix unchanged', () => {
    expect(displayTitle(base({ abbreviation: 'AIM200', title: 'Build with ML' }))).toBe(
      'Build with ML',
    );
  });

  it('retains the original title when stripping would empty it (render-only)', () => {
    const s = base({ abbreviation: 'AIM200', title: 'AIM200' });
    expect(displayTitle(s)).toBe('AIM200');
    // The underlying title is never mutated.
    expect(s.title).toBe('AIM200');
  });

  it('is case-insensitive on the abbreviation prefix', () => {
    expect(displayTitle(base({ abbreviation: 'aim200', title: 'AIM200: Topic' }))).toBe('Topic');
  });
});

describe('indexSession', () => {
  it('builds a lowercased haystack over title, abbreviation, abstract, and speakers', () => {
    const idx = indexSession(
      base({
        title: 'Serverless',
        abbreviation: 'SVS301',
        abstract: 'Deep Dive',
        speakers: [{ name: 'Ada Lovelace' }],
      }),
    );
    expect(idx.haystack).toContain('serverless');
    expect(idx.haystack).toContain('svs301');
    expect(idx.haystack).toContain('deep dive');
    expect(idx.haystack).toContain('ada lovelace');
    expect(idx.haystack).toBe(idx.haystack.toLowerCase());
  });

  it('derives weekday from the date and resolves start/end for timed sessions', () => {
    const idx = indexSession(
      base({ sessionTime: { date: '2026-12-01', time: '09:00', length: '60' } }),
    );
    expect(idx.day).toBe('2026-12-01');
    expect(idx.weekday).toBe('Tuesday');
    expect(idx.endMs! - idx.startMs!).toBe(60 * 60000);
  });

  it('leaves start/end unresolved for all-day sessions', () => {
    const idx = indexSession(
      base({ isAllDaySession: true, sessionTime: { date: '2026-12-01', time: '09:00', length: '60' } }),
    );
    expect(idx.startMs).toBeUndefined();
    expect(idx.endMs).toBeUndefined();
  });
});

describe('buildSearchIndex facet value sets', () => {
  it('collects sorted, de-duplicated values per category and facet', () => {
    const sessions: Session[] = [
      base({
        sessionId: 's1',
        tracks: ['Compute', 'AI/ML'],
        type: 'Breakout',
        level: '300',
        topics: ['a', 'b'],
        sessionTime: { date: '2026-12-02', time: '09:00', length: '60' },
      }),
      base({
        sessionId: 's2',
        tracks: ['AI/ML'],
        type: 'Workshop',
        level: '300',
        topics: ['a'],
        sessionTime: { date: '2026-12-01', time: '10:00', length: '30' },
      }),
    ];
    const { facetValues } = buildSearchIndex(sessions);
    expect(facetValues.track).toEqual(['AI/ML', 'Compute']);
    expect(facetValues.type).toEqual(['Breakout', 'Workshop']);
    expect(facetValues.level).toEqual(['300']);
    expect(facetValues.day).toEqual(['2026-12-01', '2026-12-02']);
    expect(facetValues.facets.topics).toEqual(['a', 'b']);
  });
});
