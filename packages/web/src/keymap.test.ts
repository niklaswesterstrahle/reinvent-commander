import { describe, expect, it } from 'vitest';
import {
  emptyOverlayStack,
  functionBar,
  functionKeyIntent,
  keyToIntent,
  pushOverlay,
  resolveEscape,
  topOverlay,
  type FnKeyNumber,
  type KeymapContext,
} from './keymap.js';

function ctx(overrides: Partial<KeymapContext> = {}): KeymapContext {
  return {
    activePanel: 'catalog',
    openOverlays: [],
    selection: true,
    signedIn: true,
    ...overrides,
  };
}

const FN_NUMBERS: FnKeyNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('Function_Bar label derivation', () => {
  it('derives F1-F10 labels for the catalog panel', () => {
    const bar = functionBar(ctx({ activePanel: 'catalog' }));
    expect(bar.map((f) => f.key)).toEqual([
      'F1',
      'F2',
      'F3',
      'F4',
      'F5',
      'F6',
      'F7',
      'F8',
      'F9',
      'F10',
    ]);
    const byKey = Object.fromEntries(bar.map((f) => [f.key, f.label]));
    expect(byKey.F4).toBe('Fav');
    expect(byKey.F6).toBe(''); // no Tree/List toggle — the tree is the panel
    expect(byKey.F7).toBe(''); // no personal-time create on the catalog panel
    expect(byKey.F8).toBe('');
  });

  it('leaves F6 unbound in both panels (no Tree/List toggle)', () => {
    for (const panel of ['catalog', 'schedule'] as const) {
      const context = ctx({ activePanel: panel });
      const f6 = functionBar(context).find((f) => f.key === 'F6');
      expect(f6?.label).toBe('');
      expect(functionKeyIntent(context, 6)).toBeNull();
      expect(keyToIntent(context, 'F6')).toBeNull();
    }
  });

  it('binds F2 as the global Login/Logout toggle in both panels', () => {
    for (const panel of ['catalog', 'schedule'] as const) {
      const signedOut = ctx({ activePanel: panel, signedIn: false });
      const signedIn = ctx({ activePanel: panel, signedIn: true });

      const outBar = Object.fromEntries(functionBar(signedOut).map((f) => [f.key, f.label]));
      const inBar = Object.fromEntries(functionBar(signedIn).map((f) => [f.key, f.label]));

      // The label flips with signedIn.
      expect(outBar.F2).toBe('Login');
      expect(inBar.F2).toBe('Logout');

      // F2 dispatches FUNC_F2 regardless of signed-in state, in both panels.
      expect(keyToIntent(signedOut, 'F2')).toBe('FUNC_F2');
      expect(keyToIntent(signedIn, 'F2')).toBe('FUNC_F2');
      expect(functionKeyIntent(signedOut, 2)).toBe('FUNC_F2');
      expect(functionKeyIntent(signedIn, 2)).toBe('FUNC_F2');
    }
  });

  it('reflects /auth/status: F2 is Login signed-out, Logout signed-in, never disabled', () => {
    for (const panel of ['catalog', 'schedule'] as const) {
      const signedOut = ctx({ activePanel: panel, signedIn: false });
      const signedIn = ctx({ activePanel: panel, signedIn: true });

      const outF2 = functionBar(signedOut).find((f) => f.key === 'F2');
      const inF2 = functionBar(signedIn).find((f) => f.key === 'F2');
      expect(outF2?.label).toBe('Login');
      expect(inF2?.label).toBe('Logout');

      // Never "disabled": F2 always resolves to an intent in either state.
      expect(functionKeyIntent(signedOut, 2)).toBe('FUNC_F2');
      expect(functionKeyIntent(signedIn, 2)).toBe('FUNC_F2');
    }
  });

  it('labels update on panel switch (catalog -> schedule)', () => {
    const catalog = functionBar(ctx({ activePanel: 'catalog' }));
    const schedule = functionBar(ctx({ activePanel: 'schedule' }));

    const cat = Object.fromEntries(catalog.map((f) => [f.key, f.label]));
    const sch = Object.fromEntries(schedule.map((f) => [f.key, f.label]));

    // Catalog shows Favorite on F4; Schedule shows New/Delete personal time.
    expect(cat.F4).toBe('Fav');
    expect(sch.F4).toBe('');
    expect(cat.F7).toBe('');
    expect(sch.F7).toBe('New +');
    expect(cat.F8).toBe('');
    expect(sch.F8).toBe('Del');

    // The two bars differ, proving labels track the active panel.
    expect(catalog).not.toEqual(schedule);
  });

  it('keeps labels and bindings in lockstep (empty label iff no intent)', () => {
    for (const panel of ['catalog', 'schedule'] as const) {
      const context = ctx({ activePanel: panel });
      const bar = functionBar(context);
      for (const n of FN_NUMBERS) {
        const label = bar[n - 1].label;
        const intent = functionKeyIntent(context, n);
        if (label === '') {
          expect(intent).toBeNull();
        } else {
          expect(intent).toBe(`FUNC_F${n}`);
        }
      }
    }
  });

  it('dispatches a function key only when the bar shows a label', () => {
    const catalog = ctx({ activePanel: 'catalog' });
    expect(keyToIntent(catalog, 'F4')).toBe('FUNC_F4'); // Fav bound
    expect(keyToIntent(catalog, 'F7')).toBeNull(); // unbound on catalog

    const schedule = ctx({ activePanel: 'schedule' });
    expect(keyToIntent(schedule, 'F7')).toBe('FUNC_F7'); // New + bound
    expect(keyToIntent(schedule, 'F4')).toBeNull(); // unbound on schedule
  });
});

describe('key-to-intent mapping', () => {
  it('maps movement, activation and tab keys', () => {
    const c = ctx();
    expect(keyToIntent(c, 'ArrowUp')).toBe('MOVE_UP');
    expect(keyToIntent(c, 'ArrowDown')).toBe('MOVE_DOWN');
    expect(keyToIntent(c, 'PageUp')).toBe('PAGE_UP');
    expect(keyToIntent(c, 'PageDown')).toBe('PAGE_DOWN');
    expect(keyToIntent(c, 'Tab')).toBe('TAB');
  });

  it('only activates Enter when a row is selected', () => {
    expect(keyToIntent(ctx({ selection: true }), 'Enter')).toBe('ACTIVATE');
    expect(keyToIntent(ctx({ selection: false }), 'Enter')).toBeNull();
  });

  it('emits ESCAPE only when an overlay is open', () => {
    expect(keyToIntent(ctx({ openOverlays: [] }), 'Escape')).toBeNull();
    expect(keyToIntent(ctx({ openOverlays: ['help'] }), 'Escape')).toBe('ESCAPE');
  });

  it('maps Backspace to ASCEND only when no overlay is open', () => {
    expect(keyToIntent(ctx({ openOverlays: [] }), 'Backspace')).toBe('ASCEND');
    expect(keyToIntent(ctx({ openOverlays: ['detail'] }), 'Backspace')).toBeNull();
  });
});

describe('overlay-stack Escape resolution', () => {
  it('Escape targets the topmost overlay only', () => {
    let stack = emptyOverlayStack();
    stack = pushOverlay(stack, 'detail');
    stack = pushOverlay(stack, 'help');
    expect(topOverlay(stack)).toBe('help');

    // First Escape closes only the topmost (help), leaving detail below.
    const first = resolveEscape(stack);
    expect(first.closed).toBe('help');
    expect(first.stack.overlays).toEqual(['detail']);
    expect(topOverlay(first.stack)).toBe('detail');

    // Second Escape closes the now-topmost (detail).
    const second = resolveEscape(first.stack);
    expect(second.closed).toBe('detail');
    expect(second.stack.overlays).toEqual([]);
  });

  it('a no-overlay Escape is a no-op', () => {
    const stack = emptyOverlayStack();
    const result = resolveEscape(stack);
    expect(result.closed).toBeNull();
    expect(result.stack).toBe(stack);
    expect(result.stack.overlays).toEqual([]);
  });
});
