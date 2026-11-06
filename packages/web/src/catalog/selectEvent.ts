// Launch-time event discovery helper (task 14.4).
//
// The app does NOT hard-code an eventId. It discovers events via ListEvents and
// picks one with this precedence:
//   1. a re:Invent 2026 event, if present (name mentions "re:invent" and the
//      start date is in 2026),
//   2. otherwise the first anonymously accessible event
//      (authenticationRequired === false),
//   3. otherwise the first event in the list.
// Returns undefined only when the list is empty.

import type { Event } from '@reinvent-commander/shared';

/** The year an event starts, parsed from its ISO `startDate`, or undefined. */
function startYear(event: Event): number | undefined {
  const m = /^(\d{4})/.exec(event.startDate ?? '');
  return m ? Number(m[1]) : undefined;
}

/** Does this event look like re:Invent 2026? */
export function isReinvent2026(event: Event): boolean {
  const name = (event.name ?? '').toLowerCase();
  const looksReinvent = name.includes('re:invent') || name.includes('reinvent');
  return looksReinvent && startYear(event) === 2026;
}

/**
 * Choose the event to load on launch from the discovered list. Prefers
 * re:Invent 2026, then an anonymously accessible event, then the first event.
 */
export function selectLaunchEvent(events: readonly Event[]): Event | undefined {
  if (events.length === 0) return undefined;
  const reinvent = events.find(isReinvent2026);
  if (reinvent) return reinvent;
  const anonymous = events.find((e) => e.authenticationRequired === false);
  if (anonymous) return anonymous;
  return events[0];
}
