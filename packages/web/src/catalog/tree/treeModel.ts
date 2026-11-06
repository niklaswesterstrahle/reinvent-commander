// Catalog_Tree — rendered tree level data model.
//
// A rendered level is an ordered list of entries: an optional ".." parent row
// (ascend), then folder rows (sorted by label), then session-file leaf rows.
// Folders always precede files. A breadcrumb describes the path from the root
// to the current level. These are plain data shapes with no React dependency;
// buildLevel.ts produces them and the UI layer renders them.

import type { Session } from '@reinvent-commander/shared';
import type { DimensionId } from './dimensions.js';

/**
 * A single entry in a rendered tree level:
 *   - `parent` — the ".." ascend row (only on non-root levels),
 *   - `folder` — a sub-folder for a dimension value (or time bucket), with its
 *     session count,
 *   - `file`   — a Session_File leaf.
 */
export type TreeEntry =
  | { kind: 'parent' }
  | { kind: 'folder'; dimension: DimensionId; value: string; label: string; count: number }
  | { kind: 'file'; session: Session };

/** One rendered level of the tree: its ordered entries and a path breadcrumb. */
export interface TreeLevel {
  /** Parent (if any), then folders sorted by label, then session files. */
  entries: TreeEntry[];
  /** Human path labels from the root, e.g. ['root', 'Day', 'Mon Nov 30']. */
  breadcrumb: string[];
}
