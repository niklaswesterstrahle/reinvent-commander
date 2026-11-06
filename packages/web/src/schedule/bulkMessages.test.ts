// Unit test for bulk-failure-code message mapping: every documented code maps
// to a specific message, scheduleConflict includes the conflicting ids, and an
// unknown code falls back to the generic refusal message.

import { describe, expect, it } from 'vitest';
import type { BulkFailureCode } from '@reinvent-commander/shared';

import { GENERIC_BULK_FAILURE_MESSAGE, bulkFailureMessage } from './bulkMessages.js';

const KNOWN_CODES: BulkFailureCode[] = [
  'sessionNotReservable',
  'scheduleConflict',
  'alreadyScheduled',
  'sessionFull',
  'insufficientAccess',
  'timePassed',
  'alreadyFavorited',
  'notFavorited',
  'other',
];

describe('bulkFailureMessage', () => {
  it('maps every documented code to a specific, non-generic message', () => {
    const seen = new Set<string>();
    for (const code of KNOWN_CODES) {
      const message = bulkFailureMessage({ sessionId: 's1', code });
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toBe(GENERIC_BULK_FAILURE_MESSAGE);
      seen.add(message);
    }
    // Each known code has a distinct message.
    expect(seen.size).toBe(KNOWN_CODES.length);
  });

  it('appends the conflicting sessionIds for scheduleConflict', () => {
    const message = bulkFailureMessage({
      sessionId: 's1',
      code: 'scheduleConflict',
      conflictsWith: ['s2', 's3'],
    });
    expect(message).toContain('s2');
    expect(message).toContain('s3');
  });

  it('omits the conflict suffix when scheduleConflict has no ids', () => {
    const message = bulkFailureMessage({ sessionId: 's1', code: 'scheduleConflict' });
    expect(message).not.toContain('Conflicts with:');
  });

  it('falls back to the generic message for an unknown code', () => {
    expect(bulkFailureMessage({ sessionId: 's1', code: 'somethingNew' })).toBe(
      GENERIC_BULK_FAILURE_MESSAGE,
    );
  });
});
