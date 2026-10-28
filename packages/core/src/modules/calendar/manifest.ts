import { defineModule, REACH_REASONS } from '../../module-manifest';

export const calendarModule = defineModule({
  id: 'calendar',
  label: 'Calendar',
  description: 'Household events and everything with a date, in one view.',
  iconId: 'calendar-days',
  defaultEnabled: true,
  enhances: ['household', 'search'],
  section: {
    label: 'Calendar',
    shortLabel: 'Calendar',
    basePath: '/calendar',
    acceptsShares: true,
    navItems: [
      { href: '/calendar', label: 'Calendar', iconId: 'calendar-days', accent: true },
    ],
    hue: 'sky',
  },
  tables: {
    events: { reach: { tools: ['get_upcoming_calendar_events', 'create_event', 'update_event', 'delete_event', 'get_agenda'] }, sync: ['calendar'] },
    event_leave_notices: { reach: { none: REACH_REASONS.server } },
  },
  tools: [
    { name: 'get_upcoming_calendar_events', kind: 'read' },
    { name: 'create_event', kind: 'write' },
    { name: 'update_event', kind: 'write' },
    { name: 'delete_event', kind: 'write' },
  ],
  settings: ['google-calendar'],
});
