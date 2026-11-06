// @reinvent-commander/backend — bulk batching + aggregation (Task 12.6)
//
// The AWS Events bulk favorite/reservation calls accept 1–10 unique sessionIds.
// The SPA may ask to favorite/reserve an arbitrary set, so the backend dedupes
// the input to a unique set, partitions it into pairwise-disjoint chunks of
// 1–10 whose union is exactly that unique set, runs each chunk, and aggregates
// the per-batch BulkResults into a single AggregatedBulkResult with nothing
// lost.

import type { AggregatedBulkResult, BulkResult } from '@reinvent-commander/shared';

/** Maximum sessionIds per upstream bulk call. */
export const MAX_BULK_BATCH_SIZE = 10;

/**
 * Dedupe `sessionIds` (preserving first-seen order) and partition into
 * pairwise-disjoint chunks of size 1–{@link MAX_BULK_BATCH_SIZE} whose union is
 * exactly the unique set. An empty or all-duplicate input yields no chunks.
 */
export function chunkSessionIds(
  sessionIds: readonly string[],
  batchSize = MAX_BULK_BATCH_SIZE,
): string[][] {
  const size = Math.max(1, Math.floor(batchSize));
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of sessionIds) {
    if (typeof id !== 'string' || id.length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    chunks.push(unique.slice(i, i + size));
  }
  return chunks;
}

/**
 * Concatenate per-batch {@link BulkResult}s into one {@link AggregatedBulkResult}.
 * Preserves every `successful` id and every `failed` entry across batches.
 */
export function aggregateBulkResults(results: readonly BulkResult[]): AggregatedBulkResult {
  const aggregated: AggregatedBulkResult = { successful: [], failed: [] };
  for (const result of results) {
    if (Array.isArray(result.successful)) aggregated.successful.push(...result.successful);
    if (Array.isArray(result.failed)) aggregated.failed.push(...result.failed);
  }
  return aggregated;
}

/**
 * Run `runBatch` over each disjoint chunk of the deduped `sessionIds` and
 * aggregate. Batches run sequentially to keep upstream load bounded.
 */
export async function runBatched(
  sessionIds: readonly string[],
  runBatch: (batch: string[]) => Promise<BulkResult>,
  batchSize = MAX_BULK_BATCH_SIZE,
): Promise<AggregatedBulkResult> {
  const chunks = chunkSessionIds(sessionIds, batchSize);
  const results: BulkResult[] = [];
  for (const chunk of chunks) {
    results.push(await runBatch(chunk));
  }
  return aggregateBulkResults(results);
}
