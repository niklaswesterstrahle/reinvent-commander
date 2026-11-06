// @reinvent-commander/web — selection math (pure logic, task 3.1)
//
// A pure selection reducer for the dual-panel TUI: move/page/clamp over a row
// count, and a panel-switch model so each panel retains and restores its own
// last-selected index when Tab moves focus between panels. Ported and extended
// from the proven spike (spike/src/selection.ts).

/** A panel in the dual-panel shell. */
export type PanelId = 'catalog' | 'schedule';

/** A single selection movement. */
export type Move = 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end';

/**
 * Pure selection reducer. Returns the next selection index for a panel of
 * `rowCount` rows whose current selection is `currentIndex`, after applying
 * `move`.
 *
 * - `up`/`pageUp` clamp at 0 and never go below it.
 * - `down`/`pageDown` clamp at `rowCount - 1` and never go above it.
 * - A page equals `pageSize`, the count of visible rows.
 * - When `rowCount` is 0 the panel is empty, so state is left unchanged
 *   (returns `currentIndex`).
 */
export function nextIndex(args: {
  rowCount: number;
  currentIndex: number;
  move: Move;
  /** Visible-row count; one page of movement. Defaults to 10. */
  pageSize?: number;
}): number {
  const { rowCount, currentIndex, move, pageSize = 10 } = args;
  // Empty panel: nothing to select, leave state unchanged.
  if (rowCount <= 0) return currentIndex;

  const last = rowCount - 1;
  const clamp = (n: number): number => Math.max(0, Math.min(last, n));

  switch (move) {
    case 'up':
      return clamp(currentIndex - 1);
    case 'down':
      return clamp(currentIndex + 1);
    case 'pageUp':
      return clamp(currentIndex - pageSize);
    case 'pageDown':
      return clamp(currentIndex + pageSize);
    case 'home':
      return 0;
    case 'end':
      return last;
    default:
      return clamp(currentIndex);
  }
}

/**
 * Panel-switch state: the active panel plus each panel's last-selected index.
 * Tab toggles the active panel and restores that panel's remembered index.
 */
export interface PanelSelectionState {
  activePanel: PanelId;
  /** Last-selected index per panel; preserved across Tab switches. */
  indices: Record<PanelId, number>;
}

/** The two panels, in Tab order. */
const PANELS: readonly PanelId[] = ['catalog', 'schedule'];

/** Initial panel-selection state: Catalog active, both panels at row 0. */
export function initialPanelSelection(
  activePanel: PanelId = 'catalog',
): PanelSelectionState {
  return {
    activePanel,
    indices: { catalog: 0, schedule: 0 },
  };
}

/** The panel Tab would switch to from `panel`. */
export function otherPanel(panel: PanelId): PanelId {
  return panel === 'catalog' ? 'schedule' : 'catalog';
}

/**
 * Apply a `move` to the active panel's selection, clamping against that panel's
 * row count. Returns a new state; the inactive panel's remembered index is
 * untouched.
 */
export function moveActivePanel(
  state: PanelSelectionState,
  move: Move,
  rowCount: number,
  pageSize = 10,
): PanelSelectionState {
  const active = state.activePanel;
  const next = nextIndex({
    rowCount,
    currentIndex: state.indices[active],
    move,
    pageSize,
  });
  if (next === state.indices[active]) return state;
  return {
    ...state,
    indices: { ...state.indices, [active]: next },
  };
}

/**
 * Switch the active panel (Tab). The newly active panel restores its own
 * last-selected index; the previously active panel keeps its index for when
 * Tab returns. State-only — this does not re-clamp against the destination
 * panel's current row count; callers re-clamp on the next move.
 */
export function switchPanel(state: PanelSelectionState): PanelSelectionState {
  const nextActive = otherPanel(state.activePanel);
  if (nextActive === state.activePanel) return state;
  return { ...state, activePanel: nextActive };
}

export { PANELS };
