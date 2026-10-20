// Fill a calendar event from a link or a ticket (household feedback: "add link
// to event and have it pull details", "or from ticket upload"). The server's
// /api/parse-event reads a page, ticket photo or PDF with AI and answers with a
// ParsedEventDetails; a .ics file is read on the device with parseIcs, no AI.
// Both apps' event forms then apply it with the helpers below.

import type { EventCategory } from './types';
import type { ParsedEvent } from './ics-parser';

/** What a link or ticket told us about an event. Dates and times are the wall clock at the venue. */
export interface ParsedEventDetails {
  title?: string;
  /** YYYY-MM-DD */
  start_date?: string;
  /** HH:MM, 24h. Absent when only the day is known. */
  start_time?: string;
  end_date?: string;
  end_time?: string;
  venue?: string;
  address?: string;
  category?: EventCategory;
  /** What was paid in total, or the ticket price when nothing was bought yet. */
  price_total?: number;
  currency?: string;
  ticket_count?: number;
  /** Anything worth keeping: doors, seat or section, booking reference. */
  notes?: string;
  source_url?: string;
}

const CATEGORIES: EventCategory[] = ['general', 'medical', 'social', 'household', 'finance', 'school', 'travel', 'work'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function text(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function positive(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Keep only well-formed fields from an AI answer (or anything else untrusted). */
export function normalizeParsedEvent(raw: unknown): ParsedEventDetails {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: ParsedEventDetails = {};
  const title = text(r.title, 200);
  if (title) out.title = title;
  if (typeof r.start_date === 'string' && DATE_RE.test(r.start_date)) out.start_date = r.start_date;
  if (out.start_date && typeof r.start_time === 'string' && TIME_RE.test(r.start_time)) out.start_time = r.start_time;
  if (typeof r.end_date === 'string' && DATE_RE.test(r.end_date)) out.end_date = r.end_date;
  if (out.end_date && typeof r.end_time === 'string' && TIME_RE.test(r.end_time)) out.end_time = r.end_time;
  const venue = text(r.venue, 200);
  if (venue) out.venue = venue;
  const address = text(r.address, 300);
  if (address) out.address = address;
  if (typeof r.category === 'string' && (CATEGORIES as string[]).includes(r.category)) out.category = r.category as EventCategory;
  const price = positive(r.price_total);
  if (price !== undefined) out.price_total = Math.round(price * 100) / 100;
  const currency = text(r.currency, 3);
  if (currency && /^[A-Za-z]{3}$/.test(currency)) out.currency = currency.toUpperCase();
  const count = positive(r.ticket_count);
  if (count !== undefined) out.ticket_count = Math.round(count);
  const notes = text(r.notes, 1000);
  if (notes) out.notes = notes;
  const url = text(r.source_url, 2000);
  if (url && /^https?:\/\//i.test(url)) out.source_url = url;
  return out;
}

/** "Venue, address", without repeating the venue when the address already starts with it. */
export function parsedEventLocation(details: ParsedEventDetails): string | undefined {
  const { venue, address } = details;
  if (venue && address) {
    return address.toLowerCase().startsWith(venue.toLowerCase()) ? address : `${venue}, ${address}`;
  }
  return venue ?? address;
}

function formatPrice(details: ParsedEventDetails): string | undefined {
  if (details.price_total === undefined) return undefined;
  const amount = details.price_total.toFixed(2).replace(/\.00$/, '');
  const currency = details.currency ? ` ${details.currency}` : '';
  const count = details.ticket_count && details.ticket_count > 1 ? ` for ${details.ticket_count} tickets` : '';
  return `Tickets: $${amount}${currency}${count}`;
}

/** The event's notes with what the link or ticket added, never repeating a line already there. */
export function mergeParsedEventNotes(existing: string, details: ParsedEventDetails): string {
  const lines = existing.trim() ? existing.trim().split('\n') : [];
  const has = (line: string) => lines.some((l) => l.trim() === line.trim());
  for (const line of [details.notes, formatPrice(details), details.source_url]) {
    if (line && !has(line)) lines.push(line);
  }
  return lines.join('\n');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** A calendar file's event in the same shape. An all-day event has no times. */
export function parsedEventFromIcs(event: ParsedEvent, rawIcs?: string): ParsedEventDetails {
  // parseIcs reads a date-only DTSTART as local midnight; tell it apart by the raw value.
  const allDay = rawIcs ? /DTSTART[^:\n]*:\d{8}\s*$/m.test(rawIcs) || /DTSTART;VALUE=DATE/i.test(rawIcs) : false;
  const out: ParsedEventDetails = {};
  if (event.summary.trim()) out.title = event.summary.trim();
  if (event.dtstart) {
    out.start_date = dateKey(event.dtstart);
    if (!allDay) out.start_time = `${pad2(event.dtstart.getHours())}:${pad2(event.dtstart.getMinutes())}`;
  }
  if (event.dtend && !allDay) {
    out.end_date = dateKey(event.dtend);
    out.end_time = `${pad2(event.dtend.getHours())}:${pad2(event.dtend.getMinutes())}`;
  }
  if (event.location.trim()) out.address = event.location.trim();
  if (event.description.trim()) out.notes = event.description.trim().slice(0, 1000);
  return out;
}

/** Looks like a link the server can read: http(s), with a dotted host. */
export function looksLikeEventLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

/** The event form's fields, as both apps' forms hold them. */
export interface EventFormFields {
  title: string;
  category: EventCategory;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  is_all_day: boolean;
  location: string;
  notes: string;
}

/** The form after filling it from a link or ticket: what was found replaces what was typed, notes are added to. */
export function applyParsedEvent<T extends EventFormFields>(form: T, details: ParsedEventDetails): T {
  const next: T = { ...form };
  if (details.title) next.title = details.title;
  if (details.category) next.category = details.category;
  if (details.start_date) {
    next.start_date = details.start_date;
    next.is_all_day = !details.start_time;
    if (details.start_time) next.start_time = details.start_time;
    // An end from an older fill or a typed one no longer belongs to this start.
    next.end_date = '';
    next.end_time = '';
    if (details.start_time && details.end_time) {
      next.end_date = details.end_date ?? details.start_date;
      next.end_time = details.end_time;
    }
  }
  const location = parsedEventLocation(details);
  if (location) next.location = location;
  next.notes = mergeParsedEventNotes(form.notes, details);
  return next;
}
