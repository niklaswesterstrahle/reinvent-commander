// Schedule_Panel renderer (Task 16.1, Requirement 17).
//
// Renders the signed-in attendee's schedule as an ALWAYS-ON day-folder tree:
// day folders on top (derived from each item's date, Unscheduled last), a ".."
// parent to ascend, a breadcrumb path, and the day's reserved/favorite/
// personal-time items within when descended. Item rows are driven entirely by
// the pure `scheduleModel` rows (titles looked up in the CatalogStore,
// placeholders for sessions absent from the catalog, and a conflict indicator
// on any overlapping item). There is no flat-list mode and no Tree/List toggle —
// the folder structure is the panel. While signed out it shows the F2 sign-in
// prompt.

import type { ScheduleRow } from '../schedule/scheduleModel.js';
import type { ScheduleTreeEntry, ScheduleTreeLevel } from '../schedule/scheduleTree.js';
import { scheduleStartStamp } from '../schedule/scheduleTree.js';
import { seatDisplay } from './seat.js';

/** The visible label for each schedule row group. */
const KIND_LABEL: Record<ScheduleRow['kind'], string> = {
  reserved: 'RSV',
  favorite: 'FAV',
  personalTime: 'TIME',
};

export interface SchedulePanelProps {
  title: string;
  active: boolean;
  /** Whether the attendee is signed in; drives the empty prompt. */
  signedIn: boolean;
  selectedIdx: number;
  onSelect: (index: number) => void;
  /** The built day-folder level to render (entries + breadcrumb). */
  treeLevel: ScheduleTreeLevel;
  /** Activate the tree entry at `index`: a day folder descends, '..' ascends, an item opens. */
  onTreeActivate: (index: number) => void;
}

export function SchedulePanel(props: SchedulePanelProps): JSX.Element {
  const { title, active, signedIn, selectedIdx, onSelect, treeLevel, onTreeActivate } = props;

  const emptyMsg = signedIn
    ? 'Your schedule is empty. F4 favorites a catalog session, F5 reserves, F7 adds personal time.'
    : 'Press F2 to sign in with your AWS Builder ID.';

  // The Schedule_Panel is ALWAYS a day-folder tree: a breadcrumb + small
  // non-virtualized entry list (day folders on top, then items within a day).
  const { entries, breadcrumb } = treeLevel;
  return (
    <div className={`panel${active ? ' active' : ''}`} role="grid" aria-label={title.trim()}>
      <div className="panel-title">{title}</div>
      <div className="breadcrumb">{breadcrumb.join(' / ')}</div>
      <div className="col-head" role="row">
        <span className="cell code">Code</span>
        <span className="cell title">Title</span>
        <span className="cell when">When</span>
        <span className="cell conflict" title="Conflict with another scheduled item">⚠</span>
        <span className="cell seat">Seats</span>
      </div>
      <div className="rows">
        {entries.length === 0 ? (
          <div className="empty">{emptyMsg}</div>
        ) : (
          entries.map((entry, index) => (
            <ScheduleTreeRowView
              key={treeKeyFor(entry, index)}
              entry={entry}
              selected={index === selectedIdx}
              onSelect={() => onSelect(index)}
              onOpen={() => onTreeActivate(index)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** A stable React key for a schedule-tree entry. */
function treeKeyFor(entry: ScheduleTreeEntry, index: number): string {
  switch (entry.kind) {
    case 'parent':
      return 'parent';
    case 'folder':
      return `folder:${entry.day}`;
    case 'item':
      return `item:${entry.row.kind}:${entry.row.id}:${index}`;
  }
}

/** Renders one schedule-tree entry: a ".." parent, a day folder, or an item row. */
function ScheduleTreeRowView(props: {
  entry: ScheduleTreeEntry;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}): JSX.Element {
  const { entry, selected, onSelect, onOpen } = props;
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
    <ScheduleRowView row={entry.row} selected={selected} onSelect={onSelect} onOpen={onOpen} />
  );
}

function ScheduleRowView(props: {
  row: ScheduleRow;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}): JSX.Element {
  const { row, selected, onSelect, onOpen } = props;
  // A reserved schedule row is, by definition, a seat the attendee holds, so it
  // reads "reserved" in green via the shared helper; other rows (a favorite, a
  // placeholder) carry no seat cell. Personal-time rows have no session.
  const seat = row.session ? seatDisplay(row.session, row.kind === 'reserved') : undefined;
  return (
    <div
      className={`row${selected ? ' selected' : ''}`}
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <span className="cell code">{KIND_LABEL[row.kind]}</span>
      <span className={`cell title${row.placeholder ? ' unbound' : ''}`}>{row.title}</span>
      <span className="cell when">{scheduleStartStamp(row)}</span>
      <span className="cell conflict" title={row.conflict ? 'Conflicts with another item' : ''}>
        {row.conflict ? '⚠' : ''}
      </span>
      <span className={`cell seat ${seat?.className ?? ''}`}>{seat?.text ?? ''}</span>
    </div>
  );
}
