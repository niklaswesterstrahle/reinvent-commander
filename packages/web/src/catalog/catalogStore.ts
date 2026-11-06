// Catalog_Store with IndexedDB persistence and atomic replace (Task 4.3)
//
// Holds the full session catalog in an in-memory `Map<sessionId, Session>`,
// backed by an IndexedDB-persisted copy keyed by `eventId + locale`. The store
// exposes:
//   - hydrate(): load the persisted snapshot into memory on launch so the
//     previously cached catalog shows before any refresh completes (Req 4.5)
//   - refresh(): run a complete catalog walk and, only after it completes,
//     ATOMICALLY replace the in-memory map and the persisted record in one
//     operation; a failed walk leaves prior contents unchanged (Req 4.6, 4.7)
//   - get()/has()/size: lookup-by-id over the in-memory map
//   - lastRefreshedAt: epoch ms of the last successful refresh
//
// IndexedDB access is encapsulated behind a small `CatalogPersistence` port so
// the store's atomic-replace logic can be unit-tested without a browser; the
// default implementation uses `globalThis.indexedDB`.

import type { CatalogCacheRecord, Session } from '@reinvent-commander/shared';
import { walkCatalog, type PageFetcher, type WalkProgress } from './catalogWalk.js';

/** Persistence port the store reads/writes its cache record through. */
export interface CatalogPersistence {
  /** Load the persisted record for a key, or undefined if none exists. */
  load(eventId: string, locale: string): Promise<CatalogCacheRecord | undefined>;
  /** Persist (replace) the record for its `eventId + locale` key. */
  save(record: CatalogCacheRecord): Promise<void>;
}

/** Status surfaced by {@link CatalogStore.refresh}. */
export type RefreshStatus =
  | { completed: true; totalCount: number; sessionCount: number }
  | { completed: false; error: unknown };

export interface RefreshOptions {
  fetcher: PageFetcher;
  onProgress?: (progress: WalkProgress) => void;
  includeAbstracts?: boolean;
  /** Clock for `lastRefreshedAt`; injectable for tests. Defaults to Date.now. */
  now?: () => number;
}

const IDB_NAME = 'reinvent-commander';
const IDB_VERSION = 1;
const STORE_NAME = 'catalog';

/** Compose the persistence key from eventId + locale. */
function cacheKey(eventId: string, locale: string): string {
  return `${eventId}::${locale}`;
}

/**
 * The in-memory + persisted catalog cache for one `eventId + locale`. Construct
 * one per event/locale the UI browses.
 */
export class CatalogStore {
  readonly eventId: string;
  readonly locale: string;

  private readonly persistence: CatalogPersistence;
  private sessions = new Map<string, Session>();
  private totalCount = 0;
  private lastRefreshed: number | null = null;

  constructor(eventId: string, locale: string, persistence?: CatalogPersistence) {
    this.eventId = eventId;
    this.locale = locale;
    this.persistence = persistence ?? new IndexedDbCatalogPersistence();
  }

  /** Number of sessions currently held in memory. */
  get size(): number {
    return this.sessions.size;
  }

  /** totalCount reported by the last completed walk/hydration. */
  get count(): number {
    return this.totalCount;
  }

  /** Epoch ms of the last successful refresh/hydration, or null if never. */
  get lastRefreshedAt(): number | null {
    return this.lastRefreshed;
  }

  /** Look up a session by id. */
  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /** Whether a sessionId is present in the cache. */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** All cached sessions in insertion order. */
  all(): Session[] {
    return [...this.sessions.values()];
  }

  /**
   * Load the persisted snapshot (if any) into memory. Used on launch so the
   * previously cached catalog is available before a refresh runs. Returns true
   * when a record was found and hydrated.
   */
  async hydrate(): Promise<boolean> {
    const record = await this.persistence.load(this.eventId, this.locale);
    if (!record) return false;
    this.commit(record.sessions, record.totalCount, record.lastRefreshedAt);
    return true;
  }

  /**
   * Run a complete catalog walk and atomically replace the cache on success.
   * On any walk failure the previous contents are left untouched and the
   * returned status reports `completed: false` (Requirements 4.6, 4.7).
   */
  async refresh(options: RefreshOptions): Promise<RefreshStatus> {
    const { fetcher, onProgress, includeAbstracts = true, now = Date.now } = options;

    let result;
    try {
      result = await walkCatalog({
        fetcher,
        onProgress,
        includeAbstracts,
        locale: this.locale,
      });
    } catch (error) {
      // Walk did not complete: prior catalog stays intact (Requirement 4.7).
      return { completed: false, error };
    }

    const refreshedAt = now();
    const record: CatalogCacheRecord = {
      eventId: this.eventId,
      locale: this.locale,
      sessions: result.sessions,
      totalCount: result.totalCount,
      lastRefreshedAt: refreshedAt,
    };

    // Persist first; only mutate in-memory state once the durable write
    // succeeds so a storage failure also leaves prior contents unchanged.
    await this.persistence.save(record);
    this.commit(result.sessions, result.totalCount, refreshedAt);

    return {
      completed: true,
      totalCount: result.totalCount,
      sessionCount: result.sessions.length,
    };
  }

  /** Replace in-memory state in a single step (the atomic swap). */
  private commit(sessions: Session[], totalCount: number, refreshedAt: number): void {
    const next = new Map<string, Session>();
    for (const session of sessions) next.set(session.sessionId, session);
    this.sessions = next;
    this.totalCount = totalCount;
    this.lastRefreshed = refreshedAt;
  }
}

/**
 * IndexedDB-backed {@link CatalogPersistence}. Stores one record per
 * `eventId + locale` key in a single object store. Used in the browser; tests
 * inject an in-memory fake or a fake-indexeddb-backed instance.
 */
export class IndexedDbCatalogPersistence implements CatalogPersistence {
  private readonly factory: IDBFactory;

  constructor(factory?: IDBFactory) {
    const resolved = factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!resolved) {
      throw new Error('IndexedDB is not available in this environment');
    }
    this.factory = resolved;
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async load(eventId: string, locale: string): Promise<CatalogCacheRecord | undefined> {
    const db = await this.openDb();
    try {
      return await new Promise<CatalogCacheRecord | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(cacheKey(eventId, locale));
        req.onsuccess = () => {
          const row = req.result as (CatalogCacheRecord & { key: string }) | undefined;
          if (!row) {
            resolve(undefined);
            return;
          }
          const { key: _key, ...record } = row;
          resolve(record);
        };
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  async save(record: CatalogCacheRecord): Promise<void> {
    const db = await this.openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        tx.objectStore(STORE_NAME).put({
          key: cacheKey(record.eventId, record.locale),
          ...record,
        });
      });
    } finally {
      db.close();
    }
  }
}
