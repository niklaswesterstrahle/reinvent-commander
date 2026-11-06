// Unit tests for the Catalog_Store (Task 4.4)
//
// Asserts that a successful walk atomically replaces the store, that a
// mid-walk page error preserves the previous catalog and surfaces a
// refresh-did-not-complete status (Requirements 4.6, 4.7), and that
// hydrate/persist round-trip through IndexedDB keyed by eventId + locale
// (Requirements 4.5, 12.3, 12.4). Also covers the walk's retry/429/timeout
// policy (Requirements 4.1, 4.2).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { CatalogCacheRecord, Session } from '@reinvent-commander/shared';
import {
  CatalogStore,
  IndexedDbCatalogPersistence,
  type CatalogPersistence,
} from './catalogStore.js';
import {
  CatalogWalkError,
  MAX_RETRIES,
  RateLimitError,
  walkCatalog,
  type PageFetcher,
  type PageResult,
} from './catalogWalk.js';

function session(id: string): Session {
  return { sessionId: id, title: `Session ${id}` };
}

/** In-memory persistence fake for the atomic-replace unit tests. */
class MemoryPersistence implements CatalogPersistence {
  private records = new Map<string, CatalogCacheRecord>();
  saveCount = 0;

  async load(eventId: string, locale: string): Promise<CatalogCacheRecord | undefined> {
    return this.records.get(`${eventId}::${locale}`);
  }

  async save(record: CatalogCacheRecord): Promise<void> {
    this.saveCount += 1;
    this.records.set(`${record.eventId}::${record.locale}`, record);
  }
}

/** Single-page fetcher: returns the given items as the only (terminal) page. */
function singlePageFetcher(items: Session[], totalCount = items.length): PageFetcher {
  return () => Promise.resolve({ items, totalCount } satisfies PageResult);
}

describe('CatalogStore atomic replace and preserve-on-failure', () => {
  it('replaces the store contents after a complete walk', async () => {
    const persistence = new MemoryPersistence();
    const store = new CatalogStore('evt-1', 'en-US', persistence);

    const status = await store.refresh({
      fetcher: singlePageFetcher([session('a'), session('b')], 2),
      now: () => 1_000,
    });

    expect(status).toEqual({ completed: true, totalCount: 2, sessionCount: 2 });
    expect(store.size).toBe(2);
    expect(store.get('a')).toEqual(session('a'));
    expect(store.lastRefreshedAt).toBe(1_000);
    expect(persistence.saveCount).toBe(1);
  });

  it('fully swaps contents on a subsequent successful refresh', async () => {
    const store = new CatalogStore('evt-1', 'en-US', new MemoryPersistence());

    await store.refresh({ fetcher: singlePageFetcher([session('a'), session('b')]) });
    await store.refresh({ fetcher: singlePageFetcher([session('c')]) });

    expect(store.size).toBe(1);
    expect(store.has('a')).toBe(false);
    expect(store.has('b')).toBe(false);
    expect(store.get('c')).toEqual(session('c'));
  });

  it('preserves the previous catalog when a mid-walk page errors', async () => {
    const store = new CatalogStore('evt-1', 'en-US', new MemoryPersistence());

    // Seed a good catalog.
    await store.refresh({
      fetcher: singlePageFetcher([session('a'), session('b')]),
      now: () => 500,
    });

    // A refresh whose second page always errors: first page returns items +
    // nextToken, the next page rejects on every attempt so the walk fails.
    let call = 0;
    const flakyFetcher: PageFetcher = (req) => {
      if (!req.nextToken) {
        call += 1;
        return Promise.resolve({
          items: [session('x')],
          totalCount: 99,
          nextToken: 'p2',
        });
      }
      return Promise.reject(new Error('page 2 upstream failure'));
    };

    const status = await store.refresh({ fetcher: flakyFetcher, now: () => 999 });

    expect(status.completed).toBe(false);
    if (status.completed === false) {
      expect(status.error).toBeInstanceOf(CatalogWalkError);
    }
    // Prior catalog is untouched: contents, count, and timestamp unchanged.
    expect(store.size).toBe(2);
    expect(store.get('a')).toEqual(session('a'));
    expect(store.get('b')).toEqual(session('b'));
    expect(store.has('x')).toBe(false);
    expect(store.lastRefreshedAt).toBe(500);
    // The failing first page was attempted MAX_RETRIES+1 times... but it is the
    // SECOND page that fails; the first page succeeds exactly once.
    expect(call).toBe(1);
  });

  it('leaves an empty store empty when the first refresh fails', async () => {
    const store = new CatalogStore('evt-1', 'en-US', new MemoryPersistence());
    const failing: PageFetcher = () => Promise.reject(new Error('down'));

    const status = await store.refresh({ fetcher: failing });

    expect(status.completed).toBe(false);
    expect(store.size).toBe(0);
    expect(store.lastRefreshedAt).toBeNull();
  });
});

describe('CatalogStore IndexedDB persistence (hydrate keyed by eventId + locale)', () => {
  let persistence: IndexedDbCatalogPersistence;

  beforeEach(() => {
    persistence = new IndexedDbCatalogPersistence(new IDBFactory());
  });

  it('hydrates a persisted snapshot into memory before any refresh', async () => {
    const writer = new CatalogStore('evt-1', 'en-US', persistence);
    await writer.refresh({
      fetcher: singlePageFetcher([session('a'), session('b')]),
      now: () => 4_242,
    });

    // A fresh store over the same key hydrates the persisted catalog.
    const reader = new CatalogStore('evt-1', 'en-US', persistence);
    const hydrated = await reader.hydrate();

    expect(hydrated).toBe(true);
    expect(reader.size).toBe(2);
    expect(reader.get('a')).toEqual(session('a'));
    expect(reader.lastRefreshedAt).toBe(4_242);
  });

  it('isolates records by eventId + locale key', async () => {
    const enStore = new CatalogStore('evt-1', 'en-US', persistence);
    await enStore.refresh({ fetcher: singlePageFetcher([session('en')]) });

    // Same event, different locale => no hydration.
    const frStore = new CatalogStore('evt-1', 'fr-FR', persistence);
    expect(await frStore.hydrate()).toBe(false);
    expect(frStore.size).toBe(0);

    // Different event, same locale => no hydration.
    const otherEvent = new CatalogStore('evt-2', 'en-US', persistence);
    expect(await otherEvent.hydrate()).toBe(false);
  });

  it('reports no hydration when nothing is persisted', async () => {
    const store = new CatalogStore('evt-none', 'en-US', persistence);
    expect(await store.hydrate()).toBe(false);
  });
});

describe('catalog walk retry and rate-limit policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a transient page error and then succeeds', async () => {
    let attempts = 0;
    const fetcher: PageFetcher = () => {
      attempts += 1;
      if (attempts < 3) return Promise.reject(new Error('transient'));
      return Promise.resolve({ items: [session('a')], totalCount: 1 });
    };

    const result = await walkCatalog({ fetcher, sleep: async () => {} });
    expect(attempts).toBe(3);
    expect(result.sessions).toEqual([session('a')]);
  });

  it('fails the walk after exhausting retries', async () => {
    let attempts = 0;
    const fetcher: PageFetcher = () => {
      attempts += 1;
      return Promise.reject(new Error('always down'));
    };

    await expect(walkCatalog({ fetcher, sleep: async () => {} })).rejects.toBeInstanceOf(
      CatalogWalkError,
    );
    // First attempt + MAX_RETRIES retries.
    expect(attempts).toBe(MAX_RETRIES + 1);
  });

  it('honors Retry-After seconds on a 429 before retrying', async () => {
    let attempts = 0;
    const fetcher: PageFetcher = () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new RateLimitError('429', 7));
      return Promise.resolve({ items: [session('a')], totalCount: 1 });
    };

    const delays: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      delays.push(ms);
      return Promise.resolve();
    };

    const result = await walkCatalog({ fetcher, sleep });
    expect(delays).toEqual([7_000]);
    expect(result.sessions).toEqual([session('a')]);
  });

  it('uses the default backoff when a 429 supplies no Retry-After', async () => {
    let attempts = 0;
    const fetcher: PageFetcher = () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new RateLimitError());
      return Promise.resolve({ items: [session('a')], totalCount: 1 });
    };

    const delays: number[] = [];
    const result = await walkCatalog({
      fetcher,
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    expect(delays).toEqual([5_000]);
    expect(result.sessions).toEqual([session('a')]);
  });

  it('treats a page that never resolves within the timeout as failed and retries', async () => {
    let attempts = 0;
    const fetcher: PageFetcher = () => {
      attempts += 1;
      if (attempts === 1) {
        // Never resolves: the timeout must reject this attempt.
        return new Promise<PageResult>(() => {});
      }
      return Promise.resolve({ items: [session('a')], totalCount: 1 });
    };

    const walk = walkCatalog({ fetcher, sleep: async () => {}, timeoutMs: 30_000 });
    // Advance past the 30s per-page timeout to trip the first attempt.
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await walk;

    expect(attempts).toBe(2);
    expect(result.sessions).toEqual([session('a')]);
  });
});
