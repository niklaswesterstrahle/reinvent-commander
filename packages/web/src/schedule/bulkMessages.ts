// Schedule — bulk-failure-code message mapping
//
// Maps each documented BulkFailureCode to a specific, human-readable message
// the UI shows for a per-session favorite/reservation failure. For
// `scheduleConflict`, the conflicting sessionIds (when present) are appended so
// the attendee can see what the session overlaps. Any unknown/undocumented
// code collapses to a generic refusal message.

import type { BulkFailure, BulkFailureCode } from '@reinvent-commander/shared';

/** The specific message for each documented {@link BulkFailureCode}. */
const MESSAGE_BY_CODE: Record<BulkFailureCode, string> = {
  alreadyFavorited: 'This session is already in your favorites.',
  notFavorited: 'This session is not in your favorites.',
  sessionFull: 'This session is full and cannot be reserved.',
  scheduleConflict: 'This session conflicts with another item on your schedule.',
  alreadyScheduled: 'This session is already reserved.',
  insufficientAccess: 'Your registration does not grant access to this session.',
  timePassed: 'This session has already started or ended.',
  sessionNotReservable: 'This session is not reservable.',
  other: 'This session could not be updated.',
};

/** The message used when a failure carries an unknown/undocumented code. */
export const GENERIC_BULK_FAILURE_MESSAGE =
  'This session could not be updated. Please try again.';

/** Whether a wire `code` is a documented {@link BulkFailureCode}. */
function isKnownCode(code: string): code is BulkFailureCode {
  return Object.prototype.hasOwnProperty.call(MESSAGE_BY_CODE, code);
}

/**
 * Human-readable message for a {@link BulkFailure}. Documented codes map to a
 * specific message; `scheduleConflict` appends the conflicting sessionIds when
 * present. Unknown codes fall back to {@link GENERIC_BULK_FAILURE_MESSAGE}.
 */
export function bulkFailureMessage(failure: BulkFailure): string {
  if (!isKnownCode(failure.code)) {
    return GENERIC_BULK_FAILURE_MESSAGE;
  }
  const base = MESSAGE_BY_CODE[failure.code];
  if (failure.code === 'scheduleConflict' && failure.conflictsWith?.length) {
    return `${base} Conflicts with: ${failure.conflictsWith.join(', ')}.`;
  }
  return base;
}
