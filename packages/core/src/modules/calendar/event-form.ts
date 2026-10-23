// The calendar's event form, shared by both apps' event editors: what a new or
// existing event opens with, and the event a filled form saves as. Each app
// keeps its own fields, fill-from-link flow, toasts and tickets.
import type { EventCategory, GroupEvent } from '../../types';
import { localDateOf, localDateTimeToISO, localTimeOf, todayISO } from '../../date-utils';
import type { EventFormFields } from './event-import';
import { eventReminderDays } from './event-reminders';
import type { TravelMode } from './event-travel';

export interface EventForm extends EventFormFields {
  private: boolean;
  reminder_days: number[];
  /** Dollars on the form; the Budget keeps cents. */
  cost: number | null;
  travel_mode: TravelMode | null;
}

export interface EventFormDefaults {
  /** YYYY-MM-DD a new event starts on (else today). */
  defaultDate?: string;
  /** HH:MM a new event starts at (else 9 AM). */
  defaultTime?: string;
  /** The event's Budget line, in cents. */
  costCents?: number | null;
  /** The household's home is set: a new event starts on Drive for time to leave. */
  hasHome: boolean;
}

/** The form an event opens with: the event's own values, or a new event's defaults. */
export function initialEventForm(event: GroupEvent | null | undefined, defaults: EventFormDefaults): EventForm {
  const { defaultDate, defaultTime, costCents = null, hasHome } = defaults;
  return {
    title: event?.title || '',
    category: (event?.category ?? 'general') as EventCategory,
    private: event?.private ?? false,
    start_date: event ? localDateOf(event.starts_at) : defaultDate || todayISO(),
    start_time: event ? localTimeOf(event.starts_at) : defaultTime || '09:00',
    end_date: event?.ends_at ? localDateOf(event.ends_at) : '',
    end_time: event?.ends_at ? localTimeOf(event.ends_at) : '',
    is_all_day: event?.is_all_day ?? false,
    location: event?.location || '',
    notes: event?.notes || '',
    reminder_days: eventReminderDays(event ?? {}),
    cost: costCents != null ? costCents / 100 : null,
    travel_mode: event ? event.travel_mode ?? null : hasHome ? 'drive' : null,
  };
}

export interface EventSaveContext {
  /** The event being edited, or null for a new one. */
  event: GroupEvent | null | undefined;
  groupId: string;
  /** The id a new event takes. */
  newId: string;
  /** The 'calendar.budget' module feature: off, no Budget line. */
  showBudget: boolean;
  /** The travel lookup's answer: `undefined` while loading, `null` when unknown. */
  travelMinutes: number | null | undefined;
}

/**
 * The event a form saves as, and its Budget line in cents (null = none).
 * Null when the form has no title. A trip whose lookup is still loading keeps
 * the saved minutes while its place and mode haven't changed.
 */
export function eventFromForm(form: EventForm, ctx: EventSaveContext): { event: GroupEvent; costCents: number | null } | null {
  const title = form.title.trim();
  if (!title) return null;
  const { event, travelMinutes } = ctx;
  const startDate = form.start_date || todayISO();
  const travelMode = form.is_all_day ? null : form.travel_mode;
  const travel_minutes = !travelMode
    ? null
    : typeof travelMinutes === 'number'
      ? travelMinutes
      : travelMinutes === undefined && travelMode === event?.travel_mode && form.location.trim() === (event?.location ?? '')
        ? event?.travel_minutes ?? null
        : null;
  const fields = {
    title,
    category: form.category,
    starts_at: localDateTimeToISO(startDate, form.is_all_day ? '00:00' : form.start_time || '09:00'),
    ends_at: !form.is_all_day && form.end_date && form.end_time ? localDateTimeToISO(form.end_date, form.end_time) : null,
    is_all_day: form.is_all_day,
    location: form.location.trim() || null,
    notes: form.notes.trim() || null,
    private: form.private,
    reminder_days: form.reminder_days,
    travel_mode: travelMode,
    travel_minutes,
  };
  const costCents = ctx.showBudget && form.cost ? Math.round(form.cost * 100) : null;
  if (event) return { event: { ...event, ...fields }, costCents };
  return {
    event: {
      id: ctx.newId,
      group_id: ctx.groupId,
      created_by: null, // useStoreHelpers.writeRow fills this from currentUserId
      ...fields,
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    },
    costCents,
  };
}
