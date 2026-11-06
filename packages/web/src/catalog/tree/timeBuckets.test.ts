// Unit tests for the time-of-day bucket module (Catalog_Tree).
//
// Feature: reinvent-commander
//
// Covers the boundary minutes around each cutoff and the unscheduled fallback,
// plus the ordered bucket list and labels. Validates Requirement 17 (folder
// navigation: day → time-of-day buckets).

import { describe, expect, it } from 'vitest';
import { bucketOf, TIME_BUCKET_LABELS, TIME_BUCKET_ORDER } from './timeBuckets.js';

describe('bucketOf — boundary minutes', () => {
  it('classifies the cutoff boundaries correctly', () => {
    expect(bucketOf('00:00')).toBe('morning');
    expect(bucketOf('11:59')).toBe('morning');
    expect(bucketOf('12:00')).toBe('midday');
    expect(bucketOf('13:59')).toBe('midday');
    expect(bucketOf('14:00')).toBe('afternoon');
    expect(bucketOf('17:59')).toBe('afternoon');
    expect(bucketOf('18:00')).toBe('evening');
    expect(bucketOf('23:59')).toBe('evening');
  });

  it('returns unscheduled for missing or unparseable times', () => {
    expect(bucketOf(undefined)).toBe('unscheduled');
    expect(bucketOf('')).toBe('unscheduled');
    expect(bucketOf('nope')).toBe('unscheduled');
    expect(bucketOf('24:00')).toBe('unscheduled');
    expect(bucketOf('12:60')).toBe('unscheduled');
    expect(bucketOf('9')).toBe('unscheduled');
  });
});

describe('bucket order + labels', () => {
  it('orders buckets chronologically with unscheduled last', () => {
    expect(TIME_BUCKET_ORDER).toEqual([
      'morning',
      'midday',
      'afternoon',
      'evening',
      'unscheduled',
    ]);
  });

  it('has a label for every bucket', () => {
    for (const bucket of TIME_BUCKET_ORDER) {
      expect(TIME_BUCKET_LABELS[bucket]).toBeTruthy();
    }
  });
});
