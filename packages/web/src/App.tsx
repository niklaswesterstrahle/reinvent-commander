// re:Invent Commander — SPA shell (tasks 14.1, 14.2, 14.4, 15.1).
//
// Wires the proven pure logic together into the retro dual-pane TUI:
//   - launch-time event discovery via the backend (no hard-coded eventId),
//   - Catalog_Store hydrate + paginated catalog walk with live progress,
//   - the Query_Engine driven by ONE debounced search box (term matches
//     title/code/abstract/speaker AND the session day) with match/total counts,
//   - the selection reducer and context-aware keymap behind a document-level
//     keyboard engine, with an overlay stack (Escape closes the topmost only),
//   - the session detail overlay with a GetSession abstract fallback.
//
// Phase 2 adds AWS Builder ID sign-in (F2): the catalog walk is gated on being
// signed in, and the right Schedule_Panel shows the attendee's reserved and
// favorited sessions plus personal time, with F4/F5/F7/F8 schedule actions.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AggregatedBulkResult,
  Event,
  PersonalTime,
  PersonalTimeInput,
  QueryState,
  Session,
} from '@reinvent-commander/shared';

import './theme.css';
import {
  ApiClientError,
  associateFavorites,
  cancelReservation,
  createPersonalTime,
  deletePersonalTime,
  disassociateFavorite,
  getSchedule,
  listEvents,
  listSessions,
  login,
  logout,
  reserveSessions,
  updatePersonalTime,
} from './api/client.js';
import { startAuthStatusPoller } from './auth/authStatus.js';
import { isReauthSignal, nextAuthState } from './auth/reauth.js';
import { CatalogStore } from './catalog/catalogStore.js';
import type { PageFetcher, WalkProgress } from './catalog/catalogWalk.js';
import { RateLimitError } from './catalog/catalogWalk.js';
import { selectLaunchEvent } from './catalog/selectEvent.js';
import { DetailDialog } from './components/DetailDialog.js';
import { FunctionBar } from './components/FunctionBar.js';
import { HelpDialog } from './components/HelpDialog.js';
import { Panel } from './components/Panel.js';
import { PersonalTimeDialog } from './components/PersonalTimeDialog.js';
import { SchedulePanel } from './components/SchedulePanel.js';
import { nextSortState, SORT_CYCLE, sortStatusMessage } from './query/sortCycle.js';
import type { SortState } from './query/sortCycle.js';
import { bulkFailureMessage } from './schedule/bulkMessages.js';
import {
  applyFavoriteResult,
  applyReservationResult,
  applySchedule,
  buildScheduleRows,
  emptyScheduleModel,
  removeFavorite,
  removePersonalTime,
  removeReservation,
  type ScheduleModel,
  type ScheduleRow,
} from './schedule/scheduleModel.js';
import {
  emptyOverlayStack,
  functionBar,
  functionKeyIntent,
  pushOverlay,
  resolveEscape,
  type Intent,
  type KeymapContext,
  type OverlayStack,
} from './keymap.js';
import { buildSearchIndex, type SearchIndex } from './query/searchIndex.js';
import { runQuery } from './query/queryEngine.js';
import { buildTreeLevel, DIMENSION_SENTINEL } from './catalog/tree/buildLevel.js';
import {
  onSearchChange,
  parentSelectionIndex,
  showCatalogTreeForTerm,
  type TreeViewState,
} from './catalog/tree/searchCollapse.js';
import {
  buildScheduleTreeLevel,
  type SchedulePath,
} from './schedule/scheduleTree.js';
import {
  initialPanelSelection,
  moveActivePanel,
  switchPanel,
  type Move,
  type PanelSelectionState,
} from './selection.js';
import { useKeyboard } from './useKeyboard.js';

/** Rows paged per PageUp/PageDown and visible-window estimate. */
const PAGE_SIZE = 16;
/** Debounce for the search box, per the <300ms budget over 2,000 sessions. */
const SEARCH_DEBOUNCE_MS = 120;
/** Locale for the catalog cache and GetSession fallback. */
const LOCALE = 'en-US';

type LoadPhase =
  | { kind: 'signedOut' }
  | { kind: 'discovering' }
  | { kind: 'walking'; progress: WalkProgress }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

type Overlay =
  | { id: 'detail'; session: Session }
  | { id: 'help' }
  | { id: 'personalTime'; editing?: PersonalTime };

/** The sign-in prompt shown in the Catalog_Panel while signed out. */
const SIGN_IN_PROMPT = 'Press F2 to sign in with your AWS Builder ID';

/** A page fetcher bound to an event, feeding the Catalog_Store walk. */
function makePageFetcher(eventId: string): PageFetcher {
  return async (req) => {
    try {
      const page = await listSessions(eventId, {
        locale: req.locale,
        includeAbstracts: req.includeAbstracts,
        nextToken: req.nextToken,
      });
      return { items: page.items, totalCount: page.totalCount, nextToken: page.nextToken };
    } catch (err) {
      // Let the walk honor Retry-After on 429; other errors bubble to retry/fail.
      if (err instanceof ApiClientError && err.apiError.status === 429) {
        throw new RateLimitError(err.apiError.message, err.apiError.retryAfterSeconds);
      }
      throw err;
    }
  };
}

export function App(): JSX.Element {
  // --- Auth state ---------------------------------------------------------
  const [signedIn, setSignedIn] = useState(false);

  // --- Catalog load state -------------------------------------------------
  const [event, setEvent] = useState<Event | null>(null);
  const [phase, setPhase] = useState<LoadPhase>({ kind: 'signedOut' });
  const [sessions, setSessions] = useState<Session[]>([]);
  // Real catalog session count (ListSessions totalCount), used for the header
  // tagline. Falls back to the loaded-session count when totalCount is absent.
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const storeRef = useRef<CatalogStore | null>(null);

  // --- Schedule state -----------------------------------------------------
  const [schedule, setSchedule] = useState<ScheduleModel>(() => emptyScheduleModel());

  // --- Query state --------------------------------------------------------
  const [term, setTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [sort, setSort] = useState<SortState>(() => SORT_CYCLE[0]);
  const { field: sortField, dir: sortDir } = sort;

  // --- Catalog folder-tree state (Requirement 17) -------------------------
  // The Catalog_Panel is ALWAYS the folder tree (no List/Tree toggle); a search
  // term is the only thing that collapses it to a flat result. This holds the
  // current tree path + a path saved while a search collapses the tree.
  const [treeView, setTreeView] = useState<TreeViewState>(() => ({ path: [], savedPath: null }));

  // --- Schedule day-folder tree state (Requirement 17, FEAT-003) ----------
  // The Schedule_Panel is ALWAYS the day-folder tree (Day is the only
  // dimension, no toggle); the path is at most one day folder deep.
  const [schedulePath, setSchedulePath] = useState<SchedulePath>(() => []);

  // --- Selection / overlays / status -------------------------------------
  const [selection, setSelection] = useState<PanelSelectionState>(() => initialPanelSelection());
  const [overlays, setOverlays] = useState<OverlayStack>(() => emptyOverlayStack());
  const [overlayData, setOverlayData] = useState<Overlay[]>([]);
  const [status, setStatus] = useState(SIGN_IN_PROMPT);

  // Generation guard: a sign-out (or re-sign-in) invalidates any in-flight
  // catalog walk so a late page cannot repopulate a cleared catalog.
  const loadGenRef = useRef(0);

  // Poll GET /auth/status; the SPA learns its signed-in state from the backend
  // (which holds the tokens) and never sees token material itself. On return
  // from the OAuth callback (/?auth=ok) force an immediate poll so the catalog
  // walk + schedule load start right away; on /?auth=failed surface a retry
  // prompt. Either way the query param is stripped so a reload is clean.
  useEffect(() => {
    const poller = startAuthStatusPoller((authStatus) => setSignedIn(authStatus.signedIn));

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const auth = params.get('auth');
      if (auth === 'ok') {
        void poller.refresh();
      } else if (auth === 'failed') {
        setStatus('Sign-in failed. Press F2 to try again.');
      }
      if (auth !== null && typeof window.history !== 'undefined') {
        window.history.replaceState({}, '', window.location.pathname);
      }
    }

    return () => poller.stop();
  }, []);

  // Treat the backend's re-auth signal (a 401 / AuthenticationRequiredException
  // from ANY /api call) as authoritative "signed out now": flip the signed-in
  // state so the gating effect clears the catalog + schedule and shows the F2
  // prompt. Returns true when it handled the error (the caller should stop).
  const handleApiError = useCallback((err: unknown): boolean => {
    if (isReauthSignal(err)) {
      setSignedIn((prev) => nextAuthState({ signedIn: prev }, err).signedIn);
      return true;
    }
    return false;
  }, []);

  // Clear the catalog + schedule and return to the F2 prompt.
  const resetToSignedOut = useCallback(() => {
    loadGenRef.current += 1;
    storeRef.current = null;
    setEvent(null);
    setSessions([]);
    setTotalCount(null);
    setSchedule(emptyScheduleModel());
    setPhase({ kind: 'signedOut' });
    setStatus(SIGN_IN_PROMPT);
  }, []);

  // Gate loading on sign-in. While signed out nothing is loaded; on sign-in we
  // discover the event, load the schedule FIRST (so the attendee's personal
  // data renders immediately), then walk the slow catalog. A sign-out bumps the
  // generation so a late page is dropped.
  useEffect(() => {
    if (!signedIn) {
      resetToSignedOut();
      return;
    }

    const gen = (loadGenRef.current += 1);
    const live = (): boolean => loadGenRef.current === gen;

    async function launch(): Promise<void> {
      setPhase({ kind: 'discovering' });
      setStatus('Discovering events…');

      let events: Event[];
      try {
        events = await listEvents();
      } catch (err) {
        if (handleApiError(err)) return;
        if (live()) setPhase({ kind: 'error', message: describeError(err) });
        return;
      }
      if (!live()) return;

      const chosen = selectLaunchEvent(events);
      if (!chosen) {
        setPhase({ kind: 'error', message: 'No events were returned by the catalog.' });
        return;
      }
      setEvent(chosen);
      setStatus(`Loading ${chosen.name}…`);

      const store = new CatalogStore(chosen.eventId, LOCALE);
      storeRef.current = store;

      // Load the attendee's SCHEDULE FIRST, before the slow catalog walk, so
      // their reserved/favorited/personal-time items render right away. Session
      // titles may not be resolvable yet (the catalog is still loading): the
      // Schedule_Panel shows those items with the start-time stamp, seat label
      // and the raw sessionId, and re-resolves the titles automatically once
      // the walk completes (buildScheduleRows re-runs on the `sessions` and
      // `catalogComplete` changes). This does NOT block the catalog walk below.
      try {
        const loaded = await getSchedule(chosen.eventId);
        if (live()) setSchedule((prior) => applySchedule(prior, loaded));
      } catch (err) {
        if (handleApiError(err)) return;
        // A failed GetSchedule leaves the schedule unchanged (empty on launch).
        if (live()) setStatus(`Schedule unavailable: ${describeError(err)}`);
      }
      if (!live()) return;

      // Show any previously cached catalog immediately (best-effort).
      try {
        if (await store.hydrate()) {
          if (live()) {
            setSessions(store.all());
            if (store.count > 0) setTotalCount(store.count);
          }
        }
      } catch {
        // IndexedDB may be unavailable; a fresh walk still populates the store.
      }

      if (!live()) return;
      setPhase({ kind: 'walking', progress: { retrieved: store.size, totalCount: store.count } });

      const result = await store.refresh({
        fetcher: makePageFetcher(chosen.eventId),
        onProgress: (progress) => {
          if (live()) {
            setPhase({ kind: 'walking', progress });
            if (progress.totalCount > 0) setTotalCount(progress.totalCount);
          }
        },
      });

      if (!live()) return;
      if (result.completed) {
        setSessions(store.all());
        setTotalCount(result.totalCount > 0 ? result.totalCount : store.size);
        setPhase({ kind: 'ready' });
        setStatus(`Loaded ${result.sessionCount} sessions. Tab switches panels. F1 for help.`);
      } else if (isReauthSignal(result.error)) {
        // A walk page 401'd: the session is gone. Transition to signed-out so
        // the catalog clears and the F2 prompt is shown (no cached catalog).
        handleApiError(result.error);
        return;
      } else if (store.size > 0) {
        // A refresh failed but a cached catalog is shown; keep it usable.
        setPhase({ kind: 'ready' });
        setStatus(`Showing cached catalog — refresh failed: ${describeError(result.error)}`);
      } else {
        setPhase({ kind: 'error', message: describeError(result.error) });
        return;
      }
    }

    void launch();
    return () => {
      // A re-render of this effect (sign-out) invalidates the running launch.
      loadGenRef.current += 1;
    };
  }, [signedIn, resetToSignedOut, handleApiError]);

  // Debounce the search term (~120ms) before it reaches the Query_Engine.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedTerm(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [term]);

  // Build the search index once per catalog load.
  const index: SearchIndex = useMemo(() => buildSearchIndex(sessions), [sessions]);

  // Run the Query_Engine on each query-state change.
  const queryState: QueryState = useMemo(
    () => ({ term: debouncedTerm, categories: {}, facets: {}, sortField, sortDir }),
    [debouncedTerm, sortField, sortDir],
  );
  const result = useMemo(() => runQuery(index, queryState), [index, queryState]);

  const catalogRows = result.rows;

  // Whether the catalog panel is currently showing the folder tree. The tree is
  // the panel: it ALWAYS renders, except while a non-empty search collapses it
  // to the flat Query_Engine result across all folders (17.1, 17.8).
  const termActive = debouncedTerm.trim() !== '';
  const showCatalogTree = showCatalogTreeForTerm(debouncedTerm);

  // Save/restore the tree path as the search term's emptiness changes: typing
  // saves the current level and collapses to flat; clearing restores the level.
  useEffect(() => {
    setTreeView((view) => onSearchChange(view, termActive));
  }, [termActive]);

  // Build the current tree level from the Query_Engine for the active path.
  const catalogTreeLevel = useMemo(
    () => buildTreeLevel(index, treeView.path, { sortField, sortDir }),
    [index, treeView.path, sortField, sortDir],
  );

  // Schedule rows: fold the schedule model through the CatalogStore for titles,
  // placeholders for ids absent from the catalog, and conflict indicators.
  //
  // The schedule is loaded and rendered BEFORE the (slow) catalog walk, so a
  // session title may not be resolvable yet. `catalogComplete` lets the pure
  // builder show the raw sessionId (not a "not in catalog" placeholder) while
  // the walk is still in flight; because this memo also depends on `sessions`,
  // it rebuilds — re-resolving titles automatically — once the walk populates
  // the store and calls setSessions. The dependency on `phase.kind` flips the
  // unresolved copy to the true placeholder only after the walk completes.
  const catalogComplete = phase.kind === 'ready';
  const scheduleRows: ScheduleRow[] = useMemo(() => {
    const store = storeRef.current;
    const lookup = (id: string): Session | undefined => store?.get(id);
    return buildScheduleRows(schedule, lookup, catalogComplete);
  }, [schedule, sessions, catalogComplete]);

  // The reserved sessionIds as a Set, so the Catalog_Panel shows a seat the
  // attendee holds as "reserved" (green) — not only the Schedule_Panel. Built
  // once per schedule change from the schedule's reserved array.
  const reservedIds = useMemo(() => new Set(schedule.reserved), [schedule]);

  // The earliest conference date present in the loaded catalog, used to seed the
  // personal-time dialog's date field (YYYY-MM-DD). Derived from the data, not
  // hard-coded; undefined until the catalog has sessions with dates.
  const defaultPersonalTimeDate = useMemo(() => {
    let earliest: string | undefined;
    for (const s of sessions) {
      const d = s.sessionTime?.date;
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && (earliest === undefined || d < earliest)) {
        earliest = d;
      }
    }
    return earliest;
  }, [sessions]);

  // The schedule panel is ALWAYS the day-folder tree (no toggle, and no search
  // box over the schedule), so the day-folder tree always renders.
  const showScheduleTree = true;

  // Build the schedule day-folder level for the active path.
  const scheduleTreeLevel = useMemo(
    () => buildScheduleTreeLevel(scheduleRows, schedulePath),
    [scheduleRows, schedulePath],
  );

  const catalogLength = showCatalogTree ? catalogTreeLevel.entries.length : catalogRows.length;
  const scheduleLength = scheduleTreeLevel.entries.length;
  const activeLength =
    selection.activePanel === 'catalog' ? catalogLength : scheduleLength;
  const catalogIdx = selection.indices.catalog;
  const scheduleIdx = selection.indices.schedule;
  // The selected catalog entry. In tree mode the session is resolved only when
  // the selected entry is a Session_File (folders / ".." carry no session), so
  // favorite/reserve/detail operate on the resolved session regardless of the
  // folder path (17.7). In list mode it is the flat row at the index.
  const selectedCatalogEntry = showCatalogTree
    ? catalogTreeLevel.entries[catalogIdx]
    : undefined;
  const selectedCatalogSession: Session | undefined = showCatalogTree
    ? selectedCatalogEntry?.kind === 'file'
      ? selectedCatalogEntry.session
      : undefined
    : catalogRows[catalogIdx];
  // The selected schedule entry/row. The ScheduleRow is resolved only when the
  // selected entry is an item (day folders / ".." carry no row), so F4/F5/F7/F8
  // continue to operate on the selected item regardless of the day-folder path
  // (17.11–17.14).
  const selectedScheduleEntry = scheduleTreeLevel.entries[scheduleIdx];
  const selectedScheduleRow: ScheduleRow | undefined =
    selectedScheduleEntry?.kind === 'item' ? selectedScheduleEntry.row : undefined;

  // The session the detail overlay / F-key actions target, resolved from the
  // active panel. On the schedule panel the row's resolved session (if any).
  const selectedSession: Session | undefined =
    selection.activePanel === 'catalog' ? selectedCatalogSession : selectedScheduleRow?.session;

  // Whether a row (of any kind) is selected in the active panel — drives the
  // keymap `selection` flag and Enter activation.
  const hasSelection =
    selection.activePanel === 'catalog'
      ? showCatalogTree
        ? selectedCatalogEntry !== undefined
        : selectedCatalogSession !== undefined
      : selectedScheduleEntry !== undefined;

  const topOverlay = overlayData[overlayData.length - 1];

  // --- Overlay helpers ----------------------------------------------------
  const openOverlay = useCallback((o: Overlay) => {
    setOverlays((stack) => pushOverlay(stack, o.id));
    setOverlayData((data) => [...data, o]);
  }, []);

  const closeTopOverlay = useCallback(() => {
    setOverlays((stack) => resolveEscape(stack).stack);
    setOverlayData((data) => data.slice(0, -1));
  }, []);

  const openDetail = useCallback(() => {
    if (selectedSession) openOverlay({ id: 'detail', session: selectedSession });
  }, [selectedSession, openOverlay]);

  /** Open a schedule row: a session-backed row shows its detail; a personal-time
   *  row opens the edit dialog. */
  const openScheduleRow = useCallback(
    (row: ScheduleRow) => {
      if (row.kind === 'personalTime' && row.personalTime) {
        openOverlay({ id: 'personalTime', editing: row.personalTime });
      } else if (row.session) {
        openOverlay({ id: 'detail', session: row.session });
      }
    },
    [openOverlay],
  );

  // --- Function keys ------------------------------------------------------
  const cycleSort = useCallback(() => {
    // F9 is the only sort control (keyboard-first): each press advances through
    // field + direction (code asc/desc, title asc/desc, day asc/desc, track
    // asc/desc, wrap). The status line reflects the current field and direction.
    setSort((cur) => {
      const next = nextSortState(cur);
      setStatus(sortStatusMessage(next));
      return next;
    });
    resetSelection('catalog');
  }, []);

  const resetSelection = useCallback((panel: 'catalog' | 'schedule') => {
    setSelection((s) => ({ ...s, indices: { ...s.indices, [panel]: 0 } }));
  }, []);

  // --- Folder-tree navigation (Requirement 17) ----------------------------
  // Both panels are permanent folder trees (no List/Tree toggle), so there is
  // no view-toggle action — only descend / ascend / activate.

  /** Descend into the folder at `index` of the current tree level. */
  const descendFolder = useCallback(
    (index: number) => {
      const entry = catalogTreeLevel.entries[index];
      if (!entry || entry.kind !== 'folder') return;
      setTreeView((view) => {
        const prev = view.path;
        // Descending a dimension-pick folder (root sentinel) sets the active
        // dimension; descending a value folder at the sentinel level replaces
        // that trailing sentinel with the chosen value. Every other descent
        // appends the chosen (dimension, value) step.
        const last = prev[prev.length - 1];
        const base =
          last && last.value === DIMENSION_SENTINEL ? prev.slice(0, -1) : prev;
        return { ...view, path: [...base, { dimension: entry.dimension, value: entry.value }] };
      });
      resetSelection('catalog');
    },
    [catalogTreeLevel.entries, resetSelection],
  );

  /** Ascend one level (via ".." or Backspace), restoring selection to the folder left. */
  const ascendFolder = useCallback(() => {
    if (!showCatalogTree) return;
    setTreeView((view) => {
      if (view.path.length === 0) return view;
      const left = view.path[view.path.length - 1];
      const parentPath = view.path.slice(0, -1);
      // Rebuild the parent level to find the row of the folder just left so
      // selection returns to it (17.5) rather than resetting to the top.
      const parentLevel = buildTreeLevel(index, parentPath, { sortField, sortDir });
      const restore = parentSelectionIndex(parentLevel.entries, left.dimension, left.value);
      setSelection((s) => ({ ...s, indices: { ...s.indices, catalog: restore } }));
      return { ...view, path: parentPath };
    });
  }, [showCatalogTree, index, sortField, sortDir]);

  /** Enter on a tree entry: folder descends, ".." ascends, file opens detail. */
  const activateTreeEntry = useCallback(
    (index: number) => {
      const entry = catalogTreeLevel.entries[index];
      if (!entry) return;
      if (entry.kind === 'parent') ascendFolder();
      else if (entry.kind === 'folder') descendFolder(index);
      else openOverlay({ id: 'detail', session: entry.session });
    },
    [catalogTreeLevel.entries, ascendFolder, descendFolder, openOverlay],
  );

  // --- Schedule day-folder navigation (Requirement 17, FEAT-003) ----------

  /** Descend into the day folder at `index` of the schedule tree level. */
  const descendScheduleFolder = useCallback(
    (index: number) => {
      const entry = scheduleTreeLevel.entries[index];
      if (!entry || entry.kind !== 'folder') return;
      setSchedulePath([entry.day]);
      resetSelection('schedule');
    },
    [scheduleTreeLevel.entries, resetSelection],
  );

  /** Ascend to the schedule day-folder root, re-selecting the folder just left. */
  const ascendScheduleFolder = useCallback(() => {
    if (!showScheduleTree) return;
    setSchedulePath((path) => {
      if (path.length === 0) return path;
      const leftDay = path[0];
      // Rebuild the root level to find the day folder's row so selection returns
      // to it rather than resetting to the top (17.5 parity for the schedule).
      const root = buildScheduleTreeLevel(scheduleRows, []);
      const restore = root.entries.findIndex(
        (e) => e.kind === 'folder' && e.day === leftDay,
      );
      setSelection((s) => ({
        ...s,
        indices: { ...s.indices, schedule: restore === -1 ? 0 : restore },
      }));
      return [];
    });
  }, [showScheduleTree, scheduleRows]);

  /** Enter on a schedule-tree entry: day folder descends, ".." ascends, item opens. */
  const activateScheduleTreeEntry = useCallback(
    (index: number) => {
      const entry = scheduleTreeLevel.entries[index];
      if (!entry) return;
      if (entry.kind === 'parent') ascendScheduleFolder();
      else if (entry.kind === 'folder') descendScheduleFolder(index);
      else openScheduleRow(entry.row);
    },
    [scheduleTreeLevel.entries, ascendScheduleFolder, descendScheduleFolder, openScheduleRow],
  );

  // --- Auth toggle (F2) ---------------------------------------------------
  const toggleAuth = useCallback(async () => {
    if (signedIn) {
      try {
        await logout();
      } catch {
        // Even a failed logout call clears local state; the backend also clears.
      }
      setSignedIn(false); // triggers resetToSignedOut via the gating effect
      setStatus('Signed out.');
      return;
    }
    // A full-document navigation to /auth/login starts the OAuth redirect.
    login();
  }, [signedIn]);

  // --- Schedule actions (F4/F5/F7/F8) -------------------------------------

  /** Guard: require sign-in; otherwise prompt and leave state unchanged. */
  const requireSignedIn = useCallback((): boolean => {
    if (!signedIn) {
      setStatus(SIGN_IN_PROMPT);
      return false;
    }
    return true;
  }, [signedIn]);

  /** Format one aggregated bulk outcome into a per-code status message. */
  const describeBulk = useCallback((verb: string, result: AggregatedBulkResult): string => {
    const parts: string[] = [];
    if (result.successful.length > 0) parts.push(`${verb} ${result.successful.length}.`);
    for (const failure of result.failed) {
      parts.push(bulkFailureMessage(failure));
    }
    return parts.join(' ') || `Nothing to ${verb.toLowerCase()}.`;
  }, []);

  // After any schedule mutation (favorite, reservation, personal time), re-fetch
  // the authoritative schedule from the server so the Schedule_Panel reflects
  // server truth (ids, conflicts, availability) rather than only the optimistic
  // local update. Best-effort: a failed refresh leaves the optimistic state in
  // place and does not surface an error of its own.
  const refreshSchedule = useCallback(async () => {
    if (!event) return;
    try {
      const loaded = await getSchedule(event.eventId);
      setSchedule((prior) => applySchedule(prior, loaded));
    } catch {
      // Keep the optimistic update; the next action or re-login will reconcile.
    }
  }, [event]);

  const addFavorite = useCallback(async () => {
    if (!requireSignedIn()) return;
    if (!event || !selectedCatalogSession) {
      setStatus('Select a catalog session to favorite.');
      return;
    }
    const id = selectedCatalogSession.sessionId;
    try {
      const result = await associateFavorites(event.eventId, [id]);
      setSchedule((prior) => applyFavoriteResult(prior, result));
      setStatus(describeBulk('Favorited', result));
      await refreshSchedule();
    } catch (err) {
      if (handleApiError(err)) return;
      // A transport failure leaves favorites unchanged.
      setStatus(`Could not favorite: ${describeError(err)}`);
    }
  }, [requireSignedIn, event, selectedCatalogSession, describeBulk, handleApiError, refreshSchedule]);

  const reserve = useCallback(async () => {
    if (!requireSignedIn()) return;
    if (!event || !selectedCatalogSession) {
      setStatus('Select a catalog session to reserve.');
      return;
    }
    const s = selectedCatalogSession;
    // Reservation is gated on reservability + seat band: a non-reservable
    // session, or a walk-up / unavailable band, is blocked with a status.
    if (!s.isReservable) {
      setStatus('This session is not reservable.');
      return;
    }
    if (s.seatAvailability === 'walkUp' || s.seatAvailability === 'unavailable') {
      setStatus(
        s.seatAvailability === 'walkUp'
          ? 'This session is walk-up only and cannot be reserved.'
          : 'This session has no seats available.',
      );
      return;
    }
    try {
      const result = await reserveSessions(event.eventId, [s.sessionId]);
      setSchedule((prior) => applyReservationResult(prior, result));
      setStatus(describeBulk('Reserved', result));
      await refreshSchedule();
    } catch (err) {
      if (handleApiError(err)) return;
      setStatus(`Could not reserve: ${describeError(err)}`);
    }
  }, [requireSignedIn, event, selectedCatalogSession, describeBulk, handleApiError, refreshSchedule]);

  const openPersonalTime = useCallback(() => {
    if (!requireSignedIn()) return;
    // On the schedule panel, F7 edits the selected personal-time row; elsewhere
    // (or with no personal-time row selected) it creates a new block.
    const row = selectedScheduleRow;
    const editing =
      selection.activePanel === 'schedule' && row?.kind === 'personalTime'
        ? row.personalTime
        : undefined;
    openOverlay({ id: 'personalTime', editing });
  }, [requireSignedIn, selectedScheduleRow, selection.activePanel, openOverlay]);

  const submitPersonalTime = useCallback(
    async (input: PersonalTimeInput, editing?: PersonalTime) => {
      if (!event) return;
      closeTopOverlay();
      try {
        if (editing) {
          await updatePersonalTime(event.eventId, editing.personalTimeId, input);
          setStatus('Personal time updated.');
        } else {
          await createPersonalTime(event.eventId, input);
          setStatus('Personal time added.');
        }
        // Reload the schedule so the server-assigned id / edit is reflected.
        await refreshSchedule();
      } catch (err) {
        if (handleApiError(err)) return;
        setStatus(`Could not save personal time: ${describeError(err)}`);
      }
    },
    [event, closeTopOverlay, handleApiError, refreshSchedule],
  );

  /** F8 on the schedule panel removes the selected item. */
  const removeSelected = useCallback(async () => {
    if (!requireSignedIn()) return;
    if (!event || !selectedScheduleRow) {
      setStatus('Select a schedule item to remove.');
      return;
    }
    const row = selectedScheduleRow;
    try {
      if (row.kind === 'reserved') {
        await cancelReservation(event.eventId, row.id);
        setSchedule((prior) => removeReservation(prior, row.id));
        setStatus('Reservation cancelled.');
      } else if (row.kind === 'favorite') {
        await disassociateFavorite(event.eventId, row.id);
        setSchedule((prior) => removeFavorite(prior, row.id));
        setStatus('Removed from favorites.');
      } else {
        await deletePersonalTime(event.eventId, row.id);
        setSchedule((prior) => removePersonalTime(prior, row.id));
        setStatus('Personal time deleted.');
      }
      await refreshSchedule();
    } catch (err) {
      if (handleApiError(err)) return;
      setStatus(`Could not remove item: ${describeError(err)}`);
    }
  }, [requireSignedIn, event, selectedScheduleRow, handleApiError, refreshSchedule]);

  const handleFunctionKey = useCallback(
    (n: number) => {
      switch (n) {
        case 1:
          if (topOverlay?.id === 'help') closeTopOverlay();
          else openOverlay({ id: 'help' });
          return;
        case 2:
          void toggleAuth();
          return;
        case 3:
          openDetail();
          return;
        case 4:
          void addFavorite();
          return;
        case 5:
          void reserve();
          return;
        case 6:
          // F6 is unbound: the folder tree is the panel, with no List/Tree
          // toggle. handleFunctionKey is only reached for keys the keymap binds
          // (functionKeyIntent returns null for F6), so this is unreachable —
          // kept exhaustive for the switch.
          return;
        case 7:
          openPersonalTime();
          return;
        case 8:
          void removeSelected();
          return;
        case 9:
          cycleSort();
          return;
        case 10:
          setStatus('F10 would confirm quit.');
          return;
        default:
          return;
      }
    },
    [
      topOverlay,
      closeTopOverlay,
      openOverlay,
      openDetail,
      cycleSort,
      toggleAuth,
      addFavorite,
      reserve,
      openPersonalTime,
      removeSelected,
    ],
  );

  // --- Keymap context + document-level engine -----------------------------
  const keymapContext: KeymapContext = useMemo(
    () => ({
      activePanel: selection.activePanel,
      openOverlays: overlays.overlays,
      selection: hasSelection,
      signedIn,
    }),
    [selection.activePanel, overlays.overlays, hasSelection, signedIn],
  );

  const contextRef = useRef(keymapContext);
  contextRef.current = keymapContext;
  const getContext = useCallback(() => contextRef.current, []);

  const dispatch = useCallback(
    (intent: Intent, key: string) => {
      switch (intent) {
        case 'MOVE_UP':
        case 'MOVE_DOWN':
        case 'PAGE_UP':
        case 'PAGE_DOWN': {
          if (overlayData.length > 0) return;
          const move: Move =
            intent === 'MOVE_UP'
              ? 'up'
              : intent === 'MOVE_DOWN'
                ? 'down'
                : intent === 'PAGE_UP'
                  ? 'pageUp'
                  : 'pageDown';
          setSelection((s) => moveActivePanel(s, move, activeLength, PAGE_SIZE));
          return;
        }
        case 'TAB':
          if (overlayData.length > 0) return;
          setSelection((s) => switchPanel(s));
          return;
        case 'ACTIVATE':
          if (overlayData.length > 0) {
            closeTopOverlay();
          } else if (selection.activePanel === 'catalog' && showCatalogTree) {
            // In tree mode Enter descends a folder, ascends on "..", or opens a
            // file's detail — resolved from the selected entry (17.4/17.5/17.10).
            activateTreeEntry(selection.indices.catalog);
          } else if (selection.activePanel === 'schedule' && showScheduleTree) {
            // Schedule day-folder tree: Enter descends a day, ascends on "..",
            // or opens the selected item (17.11–17.14).
            activateScheduleTreeEntry(selection.indices.schedule);
          } else {
            openDetail();
          }
          return;
        case 'ASCEND':
          // Backspace ascends one tree level in whichever panel's tree is active
          // (no-op outside a folder tree).
          if (overlayData.length === 0) {
            if (selection.activePanel === 'catalog' && showCatalogTree) ascendFolder();
            else if (selection.activePanel === 'schedule' && showScheduleTree) {
              ascendScheduleFolder();
            }
          }
          return;
        case 'ESCAPE':
          closeTopOverlay();
          return;
        default: {
          // Function-key intents: resolve the number and dispatch.
          const m = /^FUNC_F(\d{1,2})$/.exec(intent);
          if (m && functionKeyIntent(contextRef.current, Number(m[1]) as never)) {
            handleFunctionKey(Number(m[1]));
          }
          void key;
          return;
        }
      }
    },
    [
      overlayData.length,
      activeLength,
      closeTopOverlay,
      openDetail,
      handleFunctionKey,
      selection.activePanel,
      selection.indices.catalog,
      selection.indices.schedule,
      showCatalogTree,
      showScheduleTree,
      activateTreeEntry,
      ascendFolder,
      activateScheduleTreeEntry,
      ascendScheduleFolder,
    ],
  );

  useKeyboard(getContext, dispatch);

  // --- Derived display ----------------------------------------------------
  const bar = functionBar(keymapContext);
  // Prefer the real catalog totalCount; fall back to the loaded-session count.
  const sessionCount = totalCount ?? (sessions.length > 0 ? sessions.length : null);
  const tagline = useMemo(() => buildTagline(phase, sessionCount), [phase, sessionCount]);

  const catalogEmptyMsg = useMemo(() => {
    if (phase.kind === 'signedOut') return SIGN_IN_PROMPT;
    if (phase.kind === 'error') return phase.message;
    if (phase.kind === 'discovering' || phase.kind === 'walking') return 'Loading catalog…';
    return debouncedTerm.trim() ? 'No sessions match your search.' : 'No sessions in the catalog.';
  }, [phase, debouncedTerm]);

  return (
    <div className="screen">
      <div className="top-bar">
        <span className="title">re:Invent Commander</span>
        <span className="tagline">{tagline}</span>
      </div>

      <div className="search-line">
        <span className="search-label">Search:&nbsp;</span>
        <input
          className="search-input"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            resetSelection('catalog');
          }}
          placeholder="title / code / abstract / speaker / day (try: monday, tue, dec 1)"
          aria-label="Search sessions"
        />
      </div>

      <div className="panels">
        <Panel
          title=" re:Invent Session Catalog "
          active={selection.activePanel === 'catalog'}
          rows={catalogRows}
          selectedIdx={selection.indices.catalog}
          onSelect={(i) =>
            setSelection((s) => ({
              ...s,
              activePanel: 'catalog',
              indices: { ...s.indices, catalog: i },
            }))
          }
          onOpen={(session) => openOverlay({ id: 'detail', session })}
          emptyMsg={catalogEmptyMsg}
          view={showCatalogTree ? 'tree' : 'list'}
          treeLevel={catalogTreeLevel}
          onTreeActivate={activateTreeEntry}
          reservedIds={reservedIds}
        />
        <SchedulePanel
          title=" My Schedule "
          active={selection.activePanel === 'schedule'}
          signedIn={signedIn}
          selectedIdx={selection.indices.schedule}
          onSelect={(i) =>
            setSelection((s) => ({
              ...s,
              activePanel: 'schedule',
              indices: { ...s.indices, schedule: i },
            }))
          }
          treeLevel={scheduleTreeLevel}
          onTreeActivate={activateScheduleTreeEntry}
        />
      </div>

      <div className="status-line">{status}</div>

      <FunctionBar keys={bar} onFunctionKey={handleFunctionKey} />

      {topOverlay?.id === 'detail' && event && (
        <DetailDialog
          session={topOverlay.session}
          eventId={event.eventId}
          locale={LOCALE}
          reserved={reservedIds.has(topOverlay.session.sessionId)}
          onClose={closeTopOverlay}
        />
      )}
      {topOverlay?.id === 'help' && <HelpDialog pageSize={PAGE_SIZE} onClose={closeTopOverlay} />}
      {topOverlay?.id === 'personalTime' && (
        <PersonalTimeDialog
          editing={topOverlay.editing}
          defaultDate={defaultPersonalTimeDate}
          onSubmit={(input) => void submitPersonalTime(input, topOverlay.editing)}
          onClose={closeTopOverlay}
        />
      )}
    </div>
  );
}

/** Turn any thrown value into a user-facing message, with 403/404 clarity. */
function describeError(err: unknown): string {
  if (err instanceof ApiClientError) {
    const { status, code, message } = err.apiError;
    // The live Events API gates a registration-required catalog with 401
    // ("Sign in to continue") and some events with 403 EventAuthRequiredException.
    // After the signed-out transition this is rarely shown for 401, but the copy
    // must never mention build phases — it directs the attendee to sign in.
    if (
      status === 401 ||
      status === 403 ||
      code === 'EventAuthRequiredException' ||
      code === 'AuthenticationRequiredException'
    ) {
      return `${SIGN_IN_PROMPT}.`;
    }
    if (status === 404) {
      return 'The requested event or catalog was not found (404).';
    }
    return message;
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred while loading the catalog.';
}

/**
 * The compact tagline shown in the top bar. The real catalog session count is
 * shown exactly once, formatted with a thousands separator; before the count
 * is known a neutral placeholder is shown rather than a hard-coded number.
 */
function buildTagline(phase: LoadPhase, sessionCount: number | null): string {
  switch (phase.kind) {
    case 'signedOut':
      return 'Press F2 to sign in with your AWS Builder ID.';
    case 'discovering':
      return 'Discovering events…';
    case 'walking': {
      const { retrieved, totalCount } = phase.progress;
      return totalCount > 0
        ? `Loading catalog… ${retrieved}/${totalCount}`
        : `Loading catalog… ${retrieved}`;
    }
    case 'ready':
      return sessionCount !== null && sessionCount > 0
        ? `${sessionCount.toLocaleString('en-US')} sessions. Two panels. Zero nonsense.`
        : 'Sessions. Two panels. Zero nonsense.';
    case 'error':
      return 'Catalog unavailable.';
  }
}
