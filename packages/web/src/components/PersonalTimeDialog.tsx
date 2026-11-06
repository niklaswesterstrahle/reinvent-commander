// Personal-time create/edit dialog (Task 16.3).
//
// The F7 overlay for adding or editing a block of personal time. It collects a
// title, description (required), optional location, and a date + start/end
// times, formats the two timestamps as wall-clock "YYYY-MM-DDTHH:MM:00" with no
// trailing Z/offset (FEAT-001 datetime), and validates the whole input
// client-side (FEAT-001 personalTimeValidation) BEFORE calling onSubmit. On a
// validation failure the dialog shows per-field messages and preserves every
// entered value so nothing is lost. The same date is used for start and end,
// matching the same-calendar-date rule.

import { useMemo, useState } from 'react';
import type { PersonalTime, PersonalTimeInput } from '@reinvent-commander/shared';
import { formatWallClock, parseWallClock } from '../schedule/datetime.js';
import {
  validatePersonalTime,
  type PersonalTimeErrors,
} from '../schedule/personalTimeValidation.js';

export interface PersonalTimeDialogProps {
  /** The block being edited, or undefined when creating a new one. */
  editing?: PersonalTime;
  /** Default date (YYYY-MM-DD) to seed a NEW block, e.g. the event's first day. */
  defaultDate?: string;
  /** Submit the validated input; the parent performs the create/update call. */
  onSubmit: (input: PersonalTimeInput) => void;
  onClose: () => void;
}

/** The dialog's own form fields (pre-formatting into wall-clock strings). */
interface FormState {
  title: string;
  description: string;
  location: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** Seed the form from an edited block, splitting its wall-clock strings. */
function initialForm(editing?: PersonalTime, defaultDate?: string): FormState {
  if (!editing) {
    // New block: pre-fill the date (event's first day if known) and sensible
    // default times so a keyboard user can submit with minimal typing.
    return {
      title: '',
      description: '',
      location: '',
      date: defaultDate ?? '',
      startTime: '12:00',
      endTime: '13:00',
    };
  }
  const start = parseWallClock(editing.startDateTime);
  const end = parseWallClock(editing.endDateTime);
  return {
    title: editing.title,
    description: editing.description,
    location: editing.location ?? '',
    date: start ? isoDate(start) : '',
    startTime: start ? hhmm(start) : '',
    endTime: end ? hhmm(end) : '',
  };
}

function isoDate(p: { year: number; month: number; day: number }): string {
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(
    p.day,
  ).padStart(2, '0')}`;
}

function hhmm(p: { hour: number; minute: number }): string {
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Combine the form's date + a HH:MM time into a wall-clock timestamp, or ''. */
function toWallClock(date: string, time: string): string {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return '';
  return formatWallClock({
    year: Number(dm[1]),
    month: Number(dm[2]),
    day: Number(dm[3]),
    hour: Number(tm[1]),
    minute: Number(tm[2]),
  });
}

/** Build the PersonalTimeInput the validator and backend consume. */
function toInput(form: FormState): PersonalTimeInput {
  const input: PersonalTimeInput = {
    startDateTime: toWallClock(form.date, form.startTime),
    endDateTime: toWallClock(form.date, form.endTime),
    title: form.title,
    description: form.description,
  };
  if (form.location.trim().length > 0) input.location = form.location;
  return input;
}

export function PersonalTimeDialog(props: PersonalTimeDialogProps): JSX.Element {
  const { editing, defaultDate, onSubmit, onClose } = props;
  const [form, setForm] = useState<FormState>(() => initialForm(editing, defaultDate));
  const [errors, setErrors] = useState<PersonalTimeErrors>({});

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((f) => ({ ...f, [key]: value }));

  const input = useMemo(() => toInput(form), [form]);

  const submit = (): void => {
    const found = validatePersonalTime(input);
    if (Object.keys(found).length > 0) {
      // Keep every entered value; just surface the per-field messages.
      setErrors(found);
      return;
    }
    setErrors({});
    onSubmit(input);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{editing ? 'Edit Personal Time' : 'New Personal Time'}</div>
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="field">
            <span className="k">Title</span>
            <input
              className="search-input"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              aria-label="Personal time title"
              autoFocus
            />
          </label>
          {errors.title && <div className="field error">{errors.title}</div>}

          <label className="field">
            <span className="k">Description</span>
            <input
              className="search-input"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              aria-label="Personal time description"
            />
          </label>
          {errors.description && <div className="field error">{errors.description}</div>}

          <label className="field">
            <span className="k">Location</span>
            <input
              className="search-input"
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              aria-label="Personal time location"
            />
          </label>
          {errors.location && <div className="field error">{errors.location}</div>}

          <label className="field">
            <span className="k">Date</span>
            <input
              className="search-input"
              type="text"
              inputMode="numeric"
              placeholder="YYYY-MM-DD"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
              aria-label="Personal time date (YYYY-MM-DD)"
            />
          </label>
          {errors.startDateTime && <div className="field error">{errors.startDateTime}</div>}

          <label className="field">
            <span className="k">Start</span>
            <input
              className="search-input"
              type="text"
              inputMode="numeric"
              placeholder="HH:MM"
              value={form.startTime}
              onChange={(e) => set('startTime', e.target.value)}
              aria-label="Personal time start (HH:MM, 24-hour)"
            />
          </label>

          <label className="field">
            <span className="k">End</span>
            <input
              className="search-input"
              type="text"
              inputMode="numeric"
              placeholder="HH:MM"
              value={form.endTime}
              onChange={(e) => set('endTime', e.target.value)}
              aria-label="Personal time end (HH:MM, 24-hour)"
            />
          </label>
          {errors.endDateTime && <div className="field error">{errors.endDateTime}</div>}
          {/* Hidden submit so Enter in any field submits the form. */}
          <button type="submit" className="visually-hidden" aria-hidden="true" tabIndex={-1}>
            Save
          </button>
        </form>
        <div className="dialog-footer">Enter to save &nbsp;·&nbsp; Esc to cancel</div>
      </div>
    </div>
  );
}
