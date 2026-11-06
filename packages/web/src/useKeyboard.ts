// Document-level keyboard engine (task 14.2).
//
// Ported from the proven spike (spike/src/useKeyboard.ts) and wired to the real
// context-aware keymap in `keymap.ts`. A single document-level keydown listener
// resolves each physical key to an {@link Intent} through {@link keyToIntent}
// using the *current* keymap context, then dispatches it. Because the keymap is
// the single source of truth, the keys this engine captures are exactly the
// keys the Function_Bar advertises plus navigation/activation/Escape.
//
// Text entry in the search box is preserved: plain character keys produce no
// intent (keyToIntent returns null for them) so they reach the focused input,
// while the TUI still owns arrows, Tab, Enter, Escape, PageUp/PageDown, and
// F1-F10.

import { useEffect } from 'react';
import { keyToIntent, type Intent, type KeymapContext } from './keymap.js';

/**
 * Attach the document-level keyboard engine. `getContext` returns the live
 * keymap context on each keypress (so selection/overlay/panel changes are
 * always reflected), and `dispatch` receives the resolved intent plus the raw
 * physical key (handy for Home/End and future bindings).
 */
export function useKeyboard(
  getContext: () => KeymapContext,
  dispatch: (intent: Intent, key: string) => void,
): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      // When focus is inside a dialog/overlay form field, the TUI must NOT
      // hijack keys: Tab has to move between the dialog's fields and typing must
      // reach the input. Only Escape stays owned so the dialog can be dismissed
      // from a focused field. Without this guard the document-level handler
      // preventDefault()s Tab and the personal-time dialog can only be filled
      // with a mouse. The persistent search box is deliberately NOT guarded —
      // arrows/Tab there still drive the panels as before.
      if (e.key !== 'Escape' && isInOverlayField(e.target)) return;

      const intent = keyToIntent(getContext(), e.key);
      if (!intent) return;

      // The TUI owns these keys; browsers otherwise bind Tab and many F-keys.
      e.preventDefault();
      dispatch(intent, e.key);
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [getContext, dispatch]);
}

/**
 * True when the event target is an editable control (input/textarea/select or
 * a contentEditable element) that lives inside an overlay/dialog. Keys there
 * must reach the field/browser (Tab between fields, typing, arrows) rather than
 * being hijacked by the TUI. The always-present search box is intentionally
 * excluded — it is not inside `.dialog`, so arrows/Tab there still drive panels.
 */
function isInOverlayField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  const editable =
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable;
  if (!editable) return false;
  return target.closest('.dialog, .overlay') !== null;
}
