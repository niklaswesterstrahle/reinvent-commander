// Schedule — personal-time input validation (Task 8.1)
//
// Pure, per-field validation of a PersonalTimeInput before it is sent to the
// backend. The rules mirror the documented personal-time contract: the end
// must be strictly after the start, both on the SAME calendar date, the
// duration a whole 5-minute increment; title 1–128; description required
// 1–250; location 1–255 when present. Returns a per-field map of messages so
// the UI can surface errors inline.

import type { PersonalTimeInput } from '@reinvent-commander/shared';
import { parseWallClock } from './datetime.js';

/** The fields a personal-time validation message can attach to. */
export type PersonalTimeField =
  | 'startDateTime'
  | 'endDateTime'
  | 'title'
  | 'description'
  | 'location';

/** Per-field validation messages; an empty object means the input is valid. */
export type PersonalTimeErrors = Partial<Record<PersonalTimeField, string>>;

/** Duration increment personal time must align to, in minutes. */
export const PERSONAL_TIME_INCREMENT_MINUTES = 5;

export const TITLE_MAX = 128;
export const DESCRIPTION_MAX = 250;
export const LOCATION_MAX = 255;

/**
 * Validate a {@link PersonalTimeInput}. Returns a map from field to the first
 * failing message for that field; a valid input yields an empty map. Use
 * {@link isPersonalTimeValid} for a boolean.
 */
export function validatePersonalTime(input: PersonalTimeInput): PersonalTimeErrors {
  const errors: PersonalTimeErrors = {};

  const start = parseWallClock(input.startDateTime);
  const end = parseWallClock(input.endDateTime);

  if (!start) {
    errors.startDateTime = 'Start must be a wall-clock date and time (YYYY-MM-DDTHH:MM:00).';
  }
  if (!end) {
    errors.endDateTime = 'End must be a wall-clock date and time (YYYY-MM-DDTHH:MM:00).';
  }

  if (start && end) {
    const sameDate =
      start.year === end.year && start.month === end.month && start.day === end.day;
    if (!sameDate) {
      errors.endDateTime = 'Start and end must be on the same calendar date.';
    } else if (end.totalMinutes <= start.totalMinutes) {
      errors.endDateTime = 'End must be after start.';
    } else if ((end.totalMinutes - start.totalMinutes) % PERSONAL_TIME_INCREMENT_MINUTES !== 0) {
      errors.endDateTime = `Duration must be a whole ${PERSONAL_TIME_INCREMENT_MINUTES}-minute increment.`;
    }
  }

  const title = input.title ?? '';
  if (title.length < 1 || title.length > TITLE_MAX) {
    errors.title = `Title must be 1–${TITLE_MAX} characters.`;
  }

  const description = input.description ?? '';
  if (description.length < 1 || description.length > DESCRIPTION_MAX) {
    errors.description = `Description is required and must be 1–${DESCRIPTION_MAX} characters.`;
  }

  if (input.location !== undefined) {
    if (input.location.length < 1 || input.location.length > LOCATION_MAX) {
      errors.location = `Location must be 1–${LOCATION_MAX} characters when provided.`;
    }
  }

  return errors;
}

/** Whether a {@link PersonalTimeInput} passes every validation rule. */
export function isPersonalTimeValid(input: PersonalTimeInput): boolean {
  return Object.keys(validatePersonalTime(input)).length === 0;
}
