// Function_Bar (task 14.1 / 14.2).
//
// Renders F1-F10 with the context-derived labels from the keymap (the single
// source of truth), so the bar and the actual key bindings can never drift.
// Unbound keys render with the muted "unbound" style and an empty label.
// Clicking a bound label fires its function-key handler (cheap mouse support
// ported from the spike).

import type { FnKey } from '../keymap.js';

export interface FunctionBarProps {
  /** F1..F10 with their context-derived labels. */
  keys: FnKey[];
  /** Fire the given function-key number (1..10). */
  onFunctionKey: (n: number) => void;
}

export function FunctionBar(props: FunctionBarProps): JSX.Element {
  const { keys, onFunctionKey } = props;
  return (
    <div className="func-bar" role="toolbar" aria-label="Function keys">
      {keys.map((fk) => {
        const n = Number(fk.key.slice(1));
        const bound = fk.label.trim().length > 0;
        return (
          <div
            key={fk.key}
            className={`func-key${bound ? '' : ' unbound'}`}
            onClick={() => bound && onFunctionKey(n)}
            aria-label={`${fk.key} ${fk.label || 'unbound'}`}
          >
            <span className="num">{n}</span>
            <span className="label">{fk.label}</span>
          </div>
        );
      })}
    </div>
  );
}
