// Help overlay (F1) — the keyboard reference, ported from the spike.

export interface HelpDialogProps {
  pageSize: number;
  onClose: () => void;
}

export function HelpDialog(props: HelpDialogProps): JSX.Element {
  const { pageSize, onClose } = props;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">Help — Keys</div>
        <div className="dialog-body">
          <div className="field">
            <span className="k">Up / Down</span>Move selection
          </div>
          <div className="field">
            <span className="k">PgUp / PgDn</span>Page by {pageSize}
          </div>
          <div className="field">
            <span className="k">Tab</span>Switch active panel
          </div>
          <div className="field">
            <span className="k">Enter / F3</span>View session detail
          </div>
          <div className="field">
            <span className="k">F4</span>Add to favorites
          </div>
          <div className="field">
            <span className="k">F5</span>Reserve seat
          </div>
          <div className="field">
            <span className="k">F9</span>Cycle sort field + direction
          </div>
          <div className="field">
            <span className="k">F10</span>Quit
          </div>
          <div className="field">
            <span className="k">Enter</span>Tree: open a folder / a session
          </div>
          <div className="field">
            <span className="k">Backspace / ..</span>Tree: go up one level
          </div>
          <div className="field">
            <span className="k">Breadcrumb</span>Shows root → current folder
          </div>
          <div className="field">
            <span className="k">Esc</span>Close overlay
          </div>
          <div className="field">
            <span className="k">Click</span>Select · Double-click: open
          </div>
          <div className="field">
            <span className="k">Search</span>title / code / abstract / speaker / day (monday, dec 1,
            2026-12-01) — collapses the tree to a flat list
          </div>
        </div>
        <div className="dialog-footer">Press Enter or Esc to close</div>
      </div>
    </div>
  );
}
