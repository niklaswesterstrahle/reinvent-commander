// Paginated catalog walk (pure logic, Task 4.1)
//
// Walks the Event Catalog by requesting successive pages of up to 250 sessions
// from an INJECTED page fetcher, following `nextToken` until a page returns
// none. The module performs no network I/O itself: the caller supplies a
// `PageFetcher`, so the walk stays a pure, deterministic function of its
// inputs and is testable against a mocked page source.
//
// Behavior (Requirements 4.1-4.4):
//   - request pages of up to `PAGE_SIZE` (250) items, follow `nextToken`,
//     stop when a page response carries no `nextToken`
//   - fetch pages SEQUENTIALLY (never in parallel)
//   - dedupe accumulated sessions by `sessionId` (first occurrence wins)
//   - report retrieved/totalCount progress after each page
//   - on HTTP 429, honor `Retry-After` (seconds) and retry, up to MAX_RETRIES
//   - on any other error or a 30s timeout, retry up to MAX_RETRIES, then FAIL
//     the walk (leaving any prior cache untouched — the caller only commits on
//     a successful, complete walk)

import type { Session } from '@reinvent-commander/shared';

/** Maximum items requested per page (Requirement 4.1). */
export const PAGE_SIZE = 250;

/** Per-page timeout before a request is treated as failed (Requirement 4.2). */
export const PAGE_TIMEOUT_MS = 30_000;

/**
 * Maximum number of RETRIES for a single page after its first attempt fails,
 * i.e. up to 3 retries => up to 4 total attempts (Requirement 4.2).
 */
export const MAX_RETRIES = 3;

/** Default Retry-After (seconds) used when a 429 supplies none/invalid. */
export const DEFAULT_RETRY_AFTER_SECONDS = 5;

/** Arguments passed to the injected fetcher for a single page request. */
export interface PageRequest {
  /** Opaque cursor from the previous page; absent for the first page. */
  nextToken?: string;
  /** Items requested per page. Always {@link PAGE_SIZE} for the walk. */
  limit: number;
  /** One-time full-cache walk requests abstracts inline (Requirement 4). */
  includeAbstracts: boolean;
  /** BCP-47 locale for the catalog. */
  locale?: string;
}

/** One page of the catalog as returned by the injected fetcher. */
export interface PageResult {
  items: Session[];
  /** Total sessions in the catalog, as reported by the API. */
  totalCount: number;
  /** Cursor for the next page; absent on the last page. */
  nextToken?: string;
}

/**
 * A page fetcher the walk calls once per page. It MUST reject on transport
 * failure, time out, or non-2xx status. For HTTP 429 it SHOULD reject with a
 * {@link RateLimitError} so the walk can honor `Retry-After`.
 */
export type PageFetcher = (req: PageRequest) => Promise<PageResult>;

/** Progress reported after each page is accumulated (Requirement 4.3). */
export interface WalkProgress {
  /** Unique sessions accumulated so far. */
  retrieved: number;
  /** totalCount reported by the most recent page. */
  totalCount: number;
}

/** Error the fetcher throws on HTTP 429 so the walk can honor Retry-After. */
export class RateLimitError extends Error {
  /** Retry-After value in whole seconds, when the response supplied one. */
  readonly retryAfterSeconds?: number;
  constructor(message = 'rate limited', retryAfterSeconds?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Error thrown when the walk exhausts retries for a page and fails. */
export class CatalogWalkError extends Error {
  /** The underlying error from the final failed attempt, if any. */
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CatalogWalkError';
    this.cause = cause;
  }
}

/** Options controlling a single walk, with injectable timing for tests. */
export interface WalkOptions {
  fetcher: PageFetcher;
  /** Reported after every page; receives a snapshot it must not mutate. */
  onProgress?: (progress: WalkProgress) => void;
  includeAbstracts?: boolean;
  locale?: string;
  /**
   * Delay helper for Retry-After backoff. Injected so tests incur no real
   * wait. Defaults to a real `setTimeout`-based sleep.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Per-page timeout in ms. Defaults to {@link PAGE_TIMEOUT_MS}. The walk
   * races the fetcher against this timeout; a timed-out page is retried.
   */
  timeoutMs?: number;
}

/** Outcome of a completed walk. */
export interface WalkResult {
  /** All unique sessions, in first-seen order. */
  sessions: Session[];
  /** totalCount from the final page. */
  totalCount: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve a Retry-After (seconds) to a non-negative delay, else the default. */
function retryAfterMs(seconds: number | undefined): number {
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds) * 1000;
  }
  return DEFAULT_RETRY_AFTER_SECONDS * 1000;
}

/**
 * Race a page fetch against a timeout. Rejects with a timeout error when the
 * fetcher does not settle within `timeoutMs`. The timer is always cleared.
 */
function fetchWithTimeout(
  fetcher: PageFetcher,
  req: PageRequest,
  timeoutMs: number,
): Promise<PageResult> {
  return new Promise<PageResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`catalog page request timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    fetcher(req).then(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Fetch a single page with retry/backoff. A 429 is honored via Retry-After; a
 * timeout or any other error is retried. After {@link MAX_RETRIES} retries are
 * exhausted the page (and thus the walk) fails with {@link CatalogWalkError}.
 */
async function fetchPageWithRetry(
  req: PageRequest,
  timeoutMs: number,
  fetcher: PageFetcher,
  sleep: (ms: number) => Promise<void>,
): Promise<PageResult> {
  let lastError: unknown;
  // Attempt index 0 is the first try; indices 1..MAX_RETRIES are retries.
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fetchWithTimeout(fetcher, req, timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES) break;
      if (err instanceof RateLimitError) {
        await sleep(retryAfterMs(err.retryAfterSeconds));
      }
      // Non-429 errors/timeouts retry immediately (no mandated backoff).
    }
  }
  throw new CatalogWalkError(
    `catalog page request failed after ${MAX_RETRIES + 1} attempts`,
    lastError,
  );
}

/**
 * Run the full paginated catalog walk. Resolves with every unique session once
 * a page returns no `nextToken`; rejects with {@link CatalogWalkError} if any
 * page cannot be fetched within its retry budget. Pages are fetched strictly
 * one at a time.
 */
export async function walkCatalog(options: WalkOptions): Promise<WalkResult> {
  const {
    fetcher,
    onProgress,
    includeAbstracts = true,
    locale,
    sleep = defaultSleep,
    timeoutMs = PAGE_TIMEOUT_MS,
  } = options;

  const order: string[] = [];
  const bySessionId = new Map<string, Session>();
  let totalCount = 0;
  let nextToken: string | undefined;

  // Sequential loop: each page waits for the previous one to resolve.
  for (;;) {
    const req: PageRequest = {
      nextToken,
      limit: PAGE_SIZE,
      includeAbstracts,
      ...(locale !== undefined ? { locale } : {}),
    };

    const page = await fetchPageWithRetry(req, timeoutMs, fetcher, sleep);
    totalCount = page.totalCount;

    for (const session of page.items) {
      if (!bySessionId.has(session.sessionId)) {
        bySessionId.set(session.sessionId, session);
        order.push(session.sessionId);
      }
    }

    onProgress?.({ retrieved: bySessionId.size, totalCount });

    if (!page.nextToken) break;
    nextToken = page.nextToken;
  }

  return {
    sessions: order.map((id) => bySessionId.get(id)!),
    totalCount,
  };
}
