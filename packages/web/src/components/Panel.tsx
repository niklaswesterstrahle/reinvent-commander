// Catalog_Panel / Schedule_Panel renderer (task 14.1 + 14.4 virtualization).
//
// A dual-pane panel: a centered title bar (highlighted when the panel is
// active), a per-panel column header row (Code / Title / Track / Day / Time /
// Seats), and a virtualized row list. Only the rows within the scroll viewport
// (plus a small overscan) are mounted, so the Catalog_Panel stays responsive
// over the full ~2,000-session catalog while the native scrollbar still
// reflects the whole list via a full-height spacer.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Session } from '@reinvent-commander/shared';
import { formatDayLabel } from '../query/dayMatching.js';
import { displayTitle } from '../query/searchIndex.js';
import type { TreeLevel } from '../catalog/tree/treeModel.js';
import { TreeRows } from './TreeRows.js';
import { seatDisplay } from './seat.js';

/** Fixed row height in px, matching the monospace line box. */
const ROW_HEIGHT = 20;
/** Extra rows rendered above/below the viewport to smooth fast scrolling. */
const OVERSCAN = 6;

export interface PanelProps {
  title: string;
  active: boolean;
  rows: Session[];
  selectedIdx: number;
  onSelect: (index: number) => void;
  onOpen: (session: Session) => void;
  emptyMsg: string;
  /** View mode: the folder tree (default) or the flat search-collapsed list. */
  view?: 'list' | 'tree';
  /** The built tree level to render in 'tree' mode (entries + breadcrumb). */
  treeLevel?: TreeLevel;
  /** Activate the tree entry at `index`: folder descends, '..' ascends, file opens. */
  onTreeActivate?: (index: number) => void;
  /** The attendee's reserved sessionIds, so a held seat reads "reserved" here too. */
  reservedIds: Set<string>;
}

export function Panel(props: PanelProps): JSX.Element {
  const { title, active, rows, selectedIdx, onSelect, onOpen, emptyMsg, reservedIds } = props;
  const view = props.view ?? 'tree';

  // The Catalog_Panel is ALWAYS the folder tree; the flat ListPanel is used
  // ONLY while a search term collapses the tree to a flat Query_Engine result
  // across all folders (App passes view='list' then, 'tree' otherwise). The
  // tree and list views are distinct child components so that swapping `view`
  // on a single Panel instance swaps the mounted child rather than changing the
  // hook count of this component (Rules of Hooks).
  if (view === 'tree' && props.treeLevel) {
    const { entries, breadcrumb } = props.treeLevel;
    const onTreeActivate = props.onTreeActivate ?? (() => {});
    return (
      <div className={`panel${active ? ' active' : ''}`} role="grid" aria-label={title.trim()}>
        <div className="panel-title">{title}</div>
        <div className="breadcrumb">{breadcrumb.join(' / ')}</div>
        <div className="rows">
          {entries.length === 0 ? (
            <div className="empty">{emptyMsg}</div>
          ) : (
            <TreeRows
              entries={entries}
              selectedIdx={selectedIdx}
              onSelect={onSelect}
              onOpen={onTreeActivate}
              reservedIds={reservedIds}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <ListPanel
      title={title}
      active={active}
      rows={rows}
      selectedIdx={selectedIdx}
      onSelect={onSelect}
      onOpen={onOpen}
      emptyMsg={emptyMsg}
      reservedIds={reservedIds}
    />
  );
}

interface ListPanelProps {
  title: string;
  active: boolean;
  rows: Session[];
  selectedIdx: number;
  onSelect: (index: number) => void;
  onOpen: (session: Session) => void;
  emptyMsg: string;
  reservedIds: Set<string>;
}

/** The flat, virtualized session list. Owns the viewport/scroll hooks. */
function ListPanel(props: ListPanelProps): JSX.Element {
  const { title, active, rows, selectedIdx, onSelect, onOpen, emptyMsg, reservedIds } = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  // Track the viewport height so the visible window is sized to the panel.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = (): void => setViewportHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the selected row scrolled into view as selection moves via keyboard.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || rows.length === 0) return;
    const top = selectedIdx * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < el.scrollTop) {
      el.scrollTop = top;
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = bottom - el.clientHeight;
    }
  }, [selectedIdx, rows.length]);

  const total = rows.length;
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(total, startIndex + visibleCount);
  const window = rows.slice(startIndex, endIndex);

  return (
    <div className={`panel${active ? ' active' : ''}`} role="grid" aria-label={title.trim()}>
      <div className="panel-title">{title}</div>
      <div className="col-head" role="row">
        <span className="cell code">Code</span>
        <span className="cell title">Title</span>
        <span className="cell track">Track</span>
        <span className="cell day">Day</span>
        <span className="cell time">Time</span>
        <span className="cell seat">Seats</span>
      </div>
      <div
        className="rows"
        ref={viewportRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        {total === 0 ? (
          <div className="empty">{emptyMsg}</div>
        ) : (
          <div className="rows-viewport" style={{ height: total * ROW_HEIGHT }}>
            <div className="rows-window" style={{ top: startIndex * ROW_HEIGHT }}>
              {window.map((session, i) => {
                const index = startIndex + i;
                return (
                  <PanelRow
                    key={session.sessionId}
                    session={session}
                    selected={index === selectedIdx}
                    onSelect={() => onSelect(index)}
                    onOpen={() => onOpen(session)}
                    reservedIds={reservedIds}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PanelRow(props: {
  session: Session;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  reservedIds: Set<string>;
}): JSX.Element {
  const { session, selected, onSelect, onOpen, reservedIds } = props;
  const st = session.sessionTime;
  const seat = seatDisplay(session, reservedIds.has(session.sessionId));
  return (
    <div
      className={`row${selected ? ' selected' : ''}`}
      role="row"
      aria-selected={selected}
      style={{ height: ROW_HEIGHT }}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <span className="cell code">{session.abbreviation ?? ''}</span>
      <span className="cell title">{displayTitle(session)}</span>
      <span className="cell track">{session.tracks?.[0] ?? ''}</span>
      <span className="cell day">{formatDayLabel(st?.date)}</span>
      <span className="cell time">{st?.time ?? ''}</span>
      <span className={`cell seat ${seat.className}`}>{seat.text}</span>
    </div>
  );
}
