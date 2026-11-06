// Catalog_Tree row renderer (Requirement 17).
//
// Renders a built TreeLevel's entries — a ".." ascend row, folder rows with a
// leading "[DIR]" glyph + label + session count, and Session_File leaf rows
// that reuse the Catalog_Panel's cell layout (Code / Title / Track / Day /
// Time / Seats). Tree levels are small (one dimension's values, a day's time
// buckets, or one folder's sessions), so this is a plain non-virtualized list
// — unlike the flat list which must virtualize the full ~2,000-session catalog.
// Selection math mirrors the flat Panel's: a single `selectedIdx` over the
// entry array, with `onSelect(index)` and `onOpen(index)` callbacks.

import type { Session } from '@reinvent-commander/shared';
import { formatDayLabel } from '../query/dayMatching.js';
import { displayTitle } from '../query/searchIndex.js';
import type { TreeEntry } from '../catalog/tree/treeModel.js';
import { seatDisplay } from './seat.js';

export interface TreeRowsProps {
  entries: TreeEntry[];
  selectedIdx: number;
  onSelect: (index: number) => void;
  /** Activate the entry at `index`: a folder/parent descends/ascends, a file opens. */
  onOpen: (index: number) => void;
  /** The attendee's reserved sessionIds, so a held seat shows "reserved" here too. */
  reservedIds: Set<string>;
}

export function TreeRows(props: TreeRowsProps): JSX.Element {
  const { entries, selectedIdx, onSelect, onOpen, reservedIds } = props;
  return (
    <>
      {entries.map((entry, index) => (
        <TreeRowView
          key={keyFor(entry, index)}
          entry={entry}
          selected={index === selectedIdx}
          onSelect={() => onSelect(index)}
          onOpen={() => onOpen(index)}
          reservedIds={reservedIds}
        />
      ))}
    </>
  );
}

/** A stable React key for an entry (folders key on dimension+value, files on id). */
function keyFor(entry: TreeEntry, index: number): string {
  switch (entry.kind) {
    case 'parent':
      return 'parent';
    case 'folder':
      return `folder:${entry.dimension}:${entry.value}`;
    case 'file':
      return `file:${entry.session.sessionId}:${index}`;
  }
}

function TreeRowView(props: {
  entry: TreeEntry;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  reservedIds: Set<string>;
}): JSX.Element {
  const { entry, selected, onSelect, onOpen, reservedIds } = props;
  const selectedClass = selected ? ' selected' : '';

  if (entry.kind === 'parent') {
    return (
      <div
        className={`row tree-row tree-parent${selectedClass}`}
        role="row"
        aria-selected={selected}
        onClick={onSelect}
        onDoubleClick={onOpen}
      >
        <span className="cell tree-name">.. (up one level)</span>
      </div>
    );
  }

  if (entry.kind === 'folder') {
    return (
      <div
        className={`row tree-row tree-folder${selectedClass}`}
        role="row"
        aria-selected={selected}
        onClick={onSelect}
        onDoubleClick={onOpen}
      >
        <span className="cell tree-glyph">[DIR]</span>
        <span className="cell tree-name">{entry.label}</span>
        <span className="cell tree-count">{entry.count}</span>
      </div>
    );
  }

  return (
    <FileRow
      session={entry.session}
      selected={selected}
      onSelect={onSelect}
      onOpen={onOpen}
      reservedIds={reservedIds}
    />
  );
}

function FileRow(props: {
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
