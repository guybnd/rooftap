import { describe, expect, it } from 'vitest';
import {
  applyParsedEvent,
  looksLikeEventLink,
  mergeParsedEventNotes,
  normalizeParsedEvent,
  parsedEventFromIcs,
  parsedEventLocation,
} from './event-import';
import { parseIcs } from './ics-parser';

describe('normalizeParsedEvent', () => {
  it('keeps well-formed fields and drops the rest', () => {
    expect(
      normalizeParsedEvent({
        title: ' Night Market ',
        start_date: '2026-11-04',
        start_time: '17:00',
        end_date: 'next Wednesday',
        end_time: '22:00',
        venue: 'Queen Victoria Market',
        address: null,
        category: 'party',
        price_total: '89.5',
        currency: 'aud',
        ticket_count: 2,
        notes: '',
        source_url: 'javascript:alert(1)',
      })
    ).toEqual({
      title: 'Night Market',
      start_date: '2026-11-04',
      start_time: '17:00',
      venue: 'Queen Victoria Market',
      price_total: 89.5,
      currency: 'AUD',
      ticket_count: 2,
    });
  });

  it('ignores a time without a date, and non-objects', () => {
    expect(normalizeParsedEvent({ start_time: '19:30' })).toEqual({});
    expect(normalizeParsedEvent(null)).toEqual({});
    expect(normalizeParsedEvent('nope')).toEqual({});
  });
});

describe('parsedEventLocation', () => {
  it('joins venue and address without repeating the venue', () => {
    expect(parsedEventLocation({ venue: 'Forum', address: '154 Flinders St, Melbourne' })).toBe('Forum, 154 Flinders St, Melbourne');
    expect(parsedEventLocation({ venue: 'Forum', address: 'Forum Melbourne, 154 Flinders St' })).toBe('Forum Melbourne, 154 Flinders St');
    expect(parsedEventLocation({ venue: 'Queen Victoria Market' })).toBe('Queen Victoria Market');
    expect(parsedEventLocation({})).toBeUndefined();
  });
});

describe('mergeParsedEventNotes', () => {
  it('adds the price, details and link once', () => {
    const details = { notes: 'Doors 7pm. Row F.', price_total: 178, currency: 'AUD', ticket_count: 2, source_url: 'https://tix.example/e/1' };
    const once = mergeParsedEventNotes('Bring cash', details);
    expect(once).toBe('Bring cash\nDoors 7pm. Row F.\nTickets: $178 AUD for 2 tickets\nhttps://tix.example/e/1');
    expect(mergeParsedEventNotes(once, details)).toBe(once);
  });
});

describe('parsedEventFromIcs', () => {
  it('reads a timed event', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Gig\r\nDTSTART:20261026T193000\r\nDTEND:20261026T230000\r\nLOCATION:Forum\\, Melbourne\r\nEND:VEVENT\r\nEND:VCALENDAR';
    expect(parsedEventFromIcs(parseIcs(ics)!, ics)).toEqual({
      title: 'Gig',
      start_date: '2026-10-26',
      start_time: '19:30',
      end_date: '2026-10-26',
      end_time: '23:00',
      address: 'Forum, Melbourne',
    });
  });

  it('reads an all-day event without times', () => {
    const ics = 'BEGIN:VEVENT\nSUMMARY:Festival\nDTSTART;VALUE=DATE:20261108\nDTEND;VALUE=DATE:20261109\nEND:VEVENT';
    expect(parsedEventFromIcs(parseIcs(ics)!, ics)).toEqual({ title: 'Festival', start_date: '2026-11-08' });
  });
});

describe('looksLikeEventLink', () => {
  it('accepts web links only', () => {
    expect(looksLikeEventLink('https://www.ticketek.com.au/shows/show.aspx?sh=GIG')).toBe(true);
    expect(looksLikeEventLink(' http://moshtix.com.au/v2/event/1 ')).toBe(true);
    expect(looksLikeEventLink('Queen Victoria Market')).toBe(false);
    expect(looksLikeEventLink('file:///etc/passwd')).toBe(false);
    expect(looksLikeEventLink('http://localhost:3000')).toBe(false);
  });
});

describe('applyParsedEvent', () => {
  const blank = {
    title: '',
    category: 'general' as const,
    start_date: '2026-10-19',
    start_time: '09:00',
    end_date: '2026-10-19',
    end_time: '10:00',
    is_all_day: false,
    location: '',
    notes: '',
  };

  it('fills a timed event and replaces the old end', () => {
    expect(
      applyParsedEvent(blank, {
        title: 'Gig',
        category: 'social',
        start_date: '2026-10-26',
        start_time: '19:30',
        venue: 'Forum',
        address: '154 Flinders St',
        price_total: 89,
      })
    ).toEqual({
      ...blank,
      title: 'Gig',
      category: 'social',
      start_date: '2026-10-26',
      start_time: '19:30',
      end_date: '',
      end_time: '',
      location: 'Forum, 154 Flinders St',
      notes: 'Tickets: $89',
    });
  });

  it('keeps an end on the start day when only its time is known', () => {
    const out = applyParsedEvent(blank, { start_date: '2026-10-26', start_time: '19:30', end_time: '23:00' });
    expect([out.end_date, out.end_time]).toEqual(['2026-10-26', '23:00']);
  });

  it('makes a date-only event all day and leaves typed fields it found nothing for', () => {
    const out = applyParsedEvent({ ...blank, title: 'Mine', location: 'Home' }, { start_date: '2026-11-08' });
    expect(out).toMatchObject({ title: 'Mine', location: 'Home', start_date: '2026-11-08', is_all_day: true });
  });
});
