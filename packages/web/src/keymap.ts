// @reinvent-commander/web — keyboard-intent model (pure logic, task 3.3)
//
// A context-aware keymap keyed on { activePanel, openOverlays, selection,
// signedIn } that produces intents, derives the F1-F10 Function_Bar labels
// from the SAME keymap (so labels and bindings cannot drift), and models the
// overlay stack so Escape resolves to the topmost overlay only. Ported and
// extended from the proven spike (spike/src/keymap.ts).
//
// Folder navigation (Requirement 17): both panels ARE folder trees — there is
// no List/Tree toggle, so F6 is left unbound. Backspace — or the ".." entry
// followed by Enter — ascends one level in the tree; the ASCEND intent is
// emitted only when no overlay is open (guarded like Escape) so Backspace never
// steals focus from a dialog. Left-arrow is intentionally left UNBOUND so it
// never clashes with cursor movement / text editing in the search box.

import type { PanelId } from './selection.js';

/**
 * Every intent the keyboard engine can emit. Movement, activation, the ten
 * function keys, Tab (panel switch), and Escape (close topmost overlay).
 */
export type Intent =
  | 'MOVE_UP'
  | 'MOVE_DOWN'
  | 'PAGE_UP'
  | 'PAGE_DOWN'
  | 'ACTIVATE'
  | 'ASCEND'
  | 'TAB'
  | 'ESCAPE'
  | 'FUNC_F1'
  | 'FUNC_F2'
  | 'FUNC_F3'
  | 'FUNC_F4'
  | 'FUNC_F5'
  | 'FUNC_F6'
  | 'FUNC_F7'
  | 'FUNC_F8'
  | 'FUNC_F9'
  | 'FUNC_F10';

/** The ten function-key numbers, F1..F10. */
export type FnKeyNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** A function-bar entry: its key and the context-derived label. */
export interface FnKey {
  /** "F1" .. "F10". */
  key: string;
  /** Human label; empty string when the key is unbound in this context. */
  label: string;
}

/** The context that selects the active keymap. */
export interface KeymapContext {
  activePanel: PanelId;
  /** Overlay stack, bottom-to-top; the last entry is topmost. */
  openOverlays: readonly string[];
  /** Whether a row is currently selected (a selection exists). */
  selection: boolean;
  /** Whether the attendee is signed in. */
  signedIn: boolean;
}

/** A function-key binding: its intent and the label to show. */
interface FnBinding {
  intent: Extract<
    Intent,
    | 'FUNC_F1'
    | 'FUNC_F2'
    | 'FUNC_F3'
    | 'FUNC_F4'
    | 'FUNC_F5'
    | 'FUNC_F6'
    | 'FUNC_F7'
    | 'FUNC_F8'
    | 'FUNC_F9'
    | 'FUNC_F10'
  >;
  label: string;
}

const FUNC_INTENT: Record<FnKeyNumber, FnBinding['intent']> = {
  1: 'FUNC_F1',
  2: 'FUNC_F2',
  3: 'FUNC_F3',
  4: 'FUNC_F4',
  5: 'FUNC_F5',
  6: 'FUNC_F6',
  7: 'FUNC_F7',
  8: 'FUNC_F8',
  9: 'FUNC_F9',
  10: 'FUNC_F10',
};

/** An unbound slot: an empty label and no bound intent. */
const UNBOUND = '' as const;

/**
 * Resolve the function-bar bindings for the given context. This is the single
 * source of truth: both {@link functionBar} (labels) and {@link keyToIntent}
 * (bindings) read from it, so a label can never advertise a key that does not
 * dispatch, and vice versa.
 *
 * Labels follow the proven spike: Catalog offers Favorite + Reserve; Schedule
 * offers Reserve + New/Delete personal time. Keys that are not meaningful in a
 * context get an empty label and no intent.
 */
function fnBindings(ctx: KeymapContext): Record<FnKeyNumber, string> {
  // F2 is the global sign-in/out toggle, bound in BOTH panels. Its label
  // flips with the signed-in state so the attendee always sees the action the
  // key will perform (Requirements 3.16, 3.17, 7.1).
  const loginLabel = ctx.signedIn ? 'Logout' : 'Login';

  const catalog: Record<FnKeyNumber, string> = {
    1: 'Help',
    2: loginLabel,
    3: 'View',
    4: 'Fav',
    5: 'Resrv',
    6: UNBOUND,
    7: UNBOUND,
    8: UNBOUND,
    9: 'Sort',
    10: 'Quit',
  };

  const schedule: Record<FnKeyNumber, string> = {
    1: 'Help',
    2: loginLabel,
    3: 'View',
    4: UNBOUND,
    5: 'Resrv',
    6: UNBOUND,
    7: 'New +',
    8: 'Del',
    9: 'Sort',
    10: 'Quit',
  };

  return ctx.activePanel === 'catalog' ? catalog : schedule;
}

/** Ordered list of function-key numbers, F1..F10. */
const FN_NUMBERS: readonly FnKeyNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * The Function_Bar labels for a context, F1..F10. Derived from the same
 * binding table that drives intent dispatch, so the bar and the bindings can
 * never drift. Unbound keys carry an empty label.
 */
export function functionBar(ctx: KeymapContext): FnKey[] {
  const labels = fnBindings(ctx);
  return FN_NUMBERS.map((n) => ({ key: `F${n}`, label: labels[n] }));
}

/**
 * Map a function-key number to the intent it dispatches in this context, or
 * `null` when the key is unbound (empty label). Shares {@link fnBindings} with
 * {@link functionBar}, so a key dispatches an intent if and only if the bar
 * shows a non-empty label for it.
 */
export function functionKeyIntent(
  ctx: KeymapContext,
  n: FnKeyNumber,
): Intent | null {
  const labels = fnBindings(ctx);
  return labels[n] === UNBOUND ? null : FUNC_INTENT[n];
}

/**
 * The physical keys the engine recognizes, using the KeyboardEvent `key`
 * values (e.g. "ArrowUp", "Enter", "Tab", "Escape", "F1".."F10", "PageUp",
 * "PageDown").
 */
export type PhysicalKey = string;

/**
 * Map a physical key to the intent it produces in the given context, or `null`
 * when the key is unbound. This is the dispatch function the keyboard engine
 * calls on each keydown.
 */
export function keyToIntent(
  ctx: KeymapContext,
  key: PhysicalKey,
): Intent | null {
  switch (key) {
    case 'ArrowUp':
      return 'MOVE_UP';
    case 'ArrowDown':
      return 'MOVE_DOWN';
    case 'PageUp':
      return 'PAGE_UP';
    case 'PageDown':
      return 'PAGE_DOWN';
    case 'Enter':
      // Activation only means something when a row is selected.
      return ctx.selection ? 'ACTIVATE' : null;
    case 'Tab':
      return 'TAB';
    case 'Escape':
      // Escape is a no-op when no overlay is open (see resolveEscape).
      return ctx.openOverlays.length > 0 ? 'ESCAPE' : null;
    case 'Backspace':
      // Backspace ascends one tree level, but only when no overlay is open —
      // otherwise it must reach a dialog's input / be a no-op, never ascend.
      return ctx.openOverlays.length > 0 ? null : 'ASCEND';
    default:
      break;
  }

  const fnMatch = /^F(\d{1,2})$/.exec(key);
  if (fnMatch) {
    const n = Number(fnMatch[1]) as FnKeyNumber;
    if (FN_NUMBERS.includes(n)) {
      return functionKeyIntent(ctx, n);
    }
  }

  return null;
}

// --- Overlay stack -------------------------------------------------------

/**
 * An immutable overlay stack. Overlays are identified by id and ordered
 * bottom-to-top; the last pushed is topmost. Escape resolves to the topmost
 * overlay only, and a no-overlay Escape is a no-op.
 */
export interface OverlayStack {
  /** Bottom-to-top; the last entry is topmost. */
  readonly overlays: readonly string[];
}

/** An empty overlay stack. */
export function emptyOverlayStack(): OverlayStack {
  return { overlays: [] };
}

/** Push an overlay onto the top of the stack. */
export function pushOverlay(stack: OverlayStack, id: string): OverlayStack {
  return { overlays: [...stack.overlays, id] };
}

/** The topmost overlay id, or `null` when the stack is empty. */
export function topOverlay(stack: OverlayStack): string | null {
  return stack.overlays.length > 0
    ? stack.overlays[stack.overlays.length - 1]
    : null;
}

/** Result of resolving an Escape against the overlay stack. */
export interface EscapeResolution {
  /** The overlay Escape closed, or `null` when it was a no-op. */
  closed: string | null;
  /** The stack after resolution (unchanged on a no-op). */
  stack: OverlayStack;
}

/**
 * Resolve an Escape: close the topmost overlay only. When the stack is empty
 * this is a no-op — nothing is closed and the stack is returned unchanged.
 */
export function resolveEscape(stack: OverlayStack): EscapeResolution {
  if (stack.overlays.length === 0) {
    return { closed: null, stack };
  }
  const closed = stack.overlays[stack.overlays.length - 1];
  return {
    closed,
    stack: { overlays: stack.overlays.slice(0, -1) },
  };
}
