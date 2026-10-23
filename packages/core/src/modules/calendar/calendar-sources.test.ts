import { describe, expect, it } from 'vitest';
import { ALL_MODULE_IDS, type ModuleId } from '../../modules';
import { isFeatureEnabled } from '../../module-features';
import type { GoogleCalendarEventWithAttribution } from '../../types';
import { calendarAddPhrase, hideViewingSuggestions, type CalendarSources } from './calendar-sources';

function sourcesFor(enabled: ReadonlySet<string>): CalendarSources {
  return {
    tasks: isFeatureEnabled('calendar.tasks', enabled),
    viewings: isFeatureEnabled('calendar.viewings', enabled),
  };
}

function gcalEvent(id: string, state: GoogleCalendarEventWithAttribution['state']): GoogleCalendarEventWithAttribution {
  return {
    id,
    user_id: 'u1',
    gcal_event_id: `g-${id}`,
    gcal_calendar_id: 'primary',
    title: id,
    description: null,
    location: null,
    starts_at: '2026-10-18T09:00:00.000Z',
    ends_at: null,
    is_all_day: false,
    html_link: null,
    visibility: 'private',
    matched_apartment_id: null,
    state,
    imported_appointment_id: null,
    imported_task_id: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };
}

const PULLED = [gcalEvent('a', 'synced'), gcalEvent('b', 'suggested'), gcalEvent('c', 'imported')];
const allOn = new Set<string>(ALL_MODULE_IDS);

describe('calendar sources (module-features.ts)', () => {
  it('with every module on, offers everything and keeps suggestions', () => {
    const sources = sourcesFor(allOn);
    expect(calendarAddPhrase(sources)).toBe('an appointment, event, or to-do');
    expect(hideViewingSuggestions(PULLED, sources.viewings)).toBe(PULLED);
  });

  // Each module off in turn: only the source that needs it disappears.
  it.each(ALL_MODULE_IDS)('turning %s off drops only what needs it', (off: ModuleId) => {
    const sources = sourcesFor(new Set(ALL_MODULE_IDS.filter((m) => m !== off)));
    const tasksGone = off === 'household' || off === 'calendar';
    const viewingsGone = off === 'search' || off === 'calendar';

    const phrase = calendarAddPhrase(sources);
    expect(phrase.includes('to-do')).toBe(!tasksGone);
    expect(phrase.includes('appointment')).toBe(!viewingsGone);
    expect(phrase.includes('event')).toBe(true);

    const states = hideViewingSuggestions(PULLED, sources.viewings).map((ev) => ev.state);
    expect(states).toEqual(viewingsGone ? ['synced', 'synced', 'imported'] : ['synced', 'suggested', 'imported']);
  });

  it.each([
    [{ tasks: true, viewings: true }, 'an appointment, event, or to-do'],
    [{ tasks: false, viewings: true }, 'an appointment or event'],
    [{ tasks: true, viewings: false }, 'an event or to-do'],
    [{ tasks: false, viewings: false }, 'an event'],
  ])('phrase for %o', (sources, expected) => {
    expect(calendarAddPhrase(sources)).toBe(expected);
  });

  it('never drops or reorders pulled events, and leaves the input untouched', () => {
    const out = hideViewingSuggestions(PULLED, false);
    expect(out.map((ev) => ev.id)).toEqual(['a', 'b', 'c']);
    expect(PULLED[1].state).toBe('suggested');
  });
});
