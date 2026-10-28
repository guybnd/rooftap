import { defineModule, REACH_REASONS } from '../../module-manifest';

export const googleCalendarModule = defineModule({
  id: 'google-calendar',
  label: 'Google Calendar',
  description: 'Sends tasks and viewings to Google Calendar and shows your Google events.',
  iconId: 'calendar-sync',
  defaultEnabled: false,
  requires: ['calendar'],
  enhances: ['household', 'search'],
  tables: {
    google_calendar_connections: { reach: { none: REACH_REASONS.account } },
    google_calendar_events: { reach: { none: 'Google events the Calendar shows; reached through Calendar in the app.' } },
    google_calendar_pushed_events: { reach: { none: REACH_REASONS.server } },
  },
  noTools: 'Sync only. The events it brings in reach the Assistant through Calendar.',
});
