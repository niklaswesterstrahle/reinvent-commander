import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  initialPanelSelection,
  moveActivePanel,
  nextIndex,
  switchPanel,
  type Move,
} from './selection.js';

const MOVES: readonly Move[] = [
  'up',
  'down',
  'pageUp',
  'pageDown',
  'home',
  'end',
];

// Feature: reinvent-commander, Property 1
//
// Property 1: Selection movement stays in bounds and clamps at edges.
// Validates Requirements 2.1, 2.2, 2.5, 2.6, 2.10, 2.11.
describe('Feature: reinvent-commander, Property 1', () => {
  it('selection movement stays in bounds and clamps at the edges', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }), // non-empty row count N
        fc.nat(), // candidate current index (clamped into range below)
        fc.constantFrom(...MOVES),
        fc.integer({ min: 1, max: 500 }), // page size
        (rowCount, rawIndex, move, pageSize) => {
          const last = rowCount - 1;
          const currentIndex = rawIndex % rowCount; // in [0, N-1]
          const result = nextIndex({
            rowCount,
            currentIndex,
            move,
            pageSize,
          });

          // Always in bounds.
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(last);

          // Up/page-up never goes below 0 and never moves forward.
          if (move === 'up' || move === 'pageUp') {
            expect(result).toBeLessThanOrEqual(currentIndex);
          }
          // Down/page-down never goes above N-1 and never moves backward.
          if (move === 'down' || move === 'pageDown') {
            expect(result).toBeGreaterThanOrEqual(currentIndex);
          }
          if (move === 'home') expect(result).toBe(0);
          if (move === 'end') expect(result).toBe(last);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('leaves state unchanged on an empty panel (rowCount 0)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.constantFrom(...MOVES),
        fc.integer({ min: 1, max: 500 }),
        (currentIndex, move, pageSize) => {
          const result = nextIndex({
            rowCount: 0,
            currentIndex,
            move,
            pageSize,
          });
          expect(result).toBe(currentIndex);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('panel-switch selection state', () => {
  it('retains and restores each panel its own last-selected index across Tab', () => {
    const base = initialPanelSelection('catalog');

    // Move the catalog selection down a few rows.
    const afterCatalog = moveActivePanel(
      moveActivePanel(base, 'down', 100),
      'pageDown',
      100,
    );
    expect(afterCatalog.indices.catalog).toBeGreaterThan(0);
    const catalogIndex = afterCatalog.indices.catalog;

    // Tab to schedule; schedule starts at its own remembered index (0).
    const onSchedule = switchPanel(afterCatalog);
    expect(onSchedule.activePanel).toBe('schedule');
    expect(onSchedule.indices.schedule).toBe(0);
    // Catalog index is preserved while schedule is active.
    expect(onSchedule.indices.catalog).toBe(catalogIndex);

    // Move schedule selection, then Tab back to catalog.
    const scheduleMoved = moveActivePanel(onSchedule, 'end', 50);
    expect(scheduleMoved.indices.schedule).toBe(49);

    const backToCatalog = switchPanel(scheduleMoved);
    expect(backToCatalog.activePanel).toBe('catalog');
    // Catalog restores its own remembered index.
    expect(backToCatalog.indices.catalog).toBe(catalogIndex);
    // Schedule keeps its index for the next switch.
    expect(backToCatalog.indices.schedule).toBe(49);
  });

  it('moving the active panel never mutates the inactive panel index', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MOVES),
        fc.integer({ min: 1, max: 1000 }),
        (move, rowCount) => {
          const start = initialPanelSelection('schedule');
          const scheduleBefore = start.indices.catalog; // inactive panel
          const next = moveActivePanel(start, move, rowCount);
          expect(next.indices.catalog).toBe(scheduleBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});
