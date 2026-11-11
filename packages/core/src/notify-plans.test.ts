// Who gets which push, and what it says: the notify-* Edge Functions'
// decisions (supabase/functions/_shared/notify-plans.ts). The functions only
// load rows and send, so a break here is a silent one: nobody gets a reminder.
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_TIMEZONE,
  assignedTaskPush,
  binNightCollection,
  binNightPush,
  binNightReaders,
  calendarHref,
  commentSnippet,
  dueTaskPush,
  dueWindow,
  eventReaders,
  eventReminderPush,
  expoMessage,
  formatTaskTime,
  isStaleWebPushStatus,
  leaveDueReaders,
  leavePush,
  readExpoTickets,
  taskCommentPush,
  zoneOrFallback,
  type BinPlanRow,
  type DueTask,
  type LeaveEvent,
} from '../../../supabase/functions/_shared/notify-plans';
import { SNOOZE_KINDS, snoozeCategoryId, snoozeKindFromCategory } from './notification-snooze';

const ALL = new Set(['household', 'calendar', 'costs', 'documents', 'bins']);
const NO_TASKS = new Set(['calendar', 'costs', 'documents']);

function task(over: Partial<DueTask> = {}): DueTask {
  return {
    id: 't1',
    group_id: 'g1',
    template_key: null,
    title: 'Mow the lawn',
    due_date: '2026-11-10',
    due_time: null,
    assigned_to: 'ann',
    assignees: ['ann'],
    ...over,
  };
}

describe('due task reminders', () => {
  it('reads today and tomorrow as UTC dates, across a month end', () => {
    expect(dueWindow(new Date('2026-11-30T23:30:00Z'))).toEqual({ today: '2026-11-30', tomorrow: '2026-12-01' });
    expect(dueWindow(new Date('2026-12-31T00:00:00Z'))).toEqual({ today: '2026-12-31', tomorrow: '2027-01-01' });
  });

  it('says today or tomorrow, with the time when there is one', () => {
    expect(dueTaskPush(task(), '2026-11-10', ALL)?.payload.body).toBe('Mow the lawn is due today');
    expect(dueTaskPush(task({ due_date: '2026-11-11', due_time: '18:05:00' }), '2026-11-10', ALL)?.payload.body).toBe(
      'Mow the lawn is due tomorrow at 6:05pm',
    );
  });

  it('formats times on a 12 hour clock', () => {
    expect(formatTaskTime('00:15')).toBe('12:15am');
    expect(formatTaskTime('12:00:00')).toBe('12:00pm');
    expect(formatTaskTime('9:30')).toBe('9:30am');
    expect(formatTaskTime('23:59')).toBe('11:59pm');
    expect(formatTaskTime('soon')).toBe('soon');
  });

  it('goes to everyone on the task', () => {
    const plan = dueTaskPush(task({ assigned_to: 'ann', assignees: ['ann', 'ben', 'cat'] }), '2026-11-10', ALL);
    expect(plan?.to).toEqual(['ann', 'ben', 'cat']);
  });

  it('goes only to the one person an older app set, over a stale list', () => {
    expect(dueTaskPush(task({ assigned_to: 'dan', assignees: ['ann', 'ben'] }), '2026-11-10', ALL)?.to).toEqual(['dan']);
  });

  it('sends nothing with nobody on the task', () => {
    expect(dueTaskPush(task({ assigned_to: null, assignees: [] }), '2026-11-10', ALL)).toBeNull();
  });

  it('carries the task snooze buttons, a stable tag and the task link', () => {
    const plan = dueTaskPush(task(), '2026-11-10', ALL);
    expect(plan?.payload).toMatchObject({ title: 'Task reminder', tag: 'due-t1', url: '/tasks?focus=t1', snooze: 'task' });
  });

  it('sends nothing for a task while Tasks is off', () => {
    expect(dueTaskPush(task(), '2026-11-10', NO_TASKS)).toBeNull();
  });

  it('still reminds about a bill with Tasks off, as a plain reminder that opens Costs', () => {
    const plan = dueTaskPush(task({ template_key: 'cost-reminder:abc:due' }), '2026-11-10', NO_TASKS);
    expect(plan?.payload.title).toBe('Reminder');
    expect(plan?.payload.url).toMatch(/^\/costs/);
  });
});

describe('assigned to you', () => {
  const base = { id: 't1', group_id: 'g1', template_key: null, title: 'Fix the gate' };

  it('tells only the people newly on the task', () => {
    const plan = assignedTaskPush(
      { ...base, assigned_to: 'ann', assignees: ['ann', 'ben', 'cat'] },
      { assigned_to: 'ann', assignees: ['ann'] },
      ALL,
    );
    expect(plan?.to).toEqual(['ben', 'cat']);
    expect(plan?.payload).toMatchObject({ title: 'New task assigned', body: 'Fix the gate', tag: 'assigned-t1', snooze: 'task' });
  });

  it('tells everyone on a new task', () => {
    expect(assignedTaskPush({ ...base, assigned_to: 'ann', assignees: ['ann', 'ben'] }, undefined, ALL)?.to).toEqual(['ann', 'ben']);
  });

  it('sends nothing when someone is only taken off', () => {
    expect(assignedTaskPush({ ...base, assigned_to: 'ann', assignees: ['ann'] }, { assigned_to: 'ann', assignees: ['ann', 'ben'] }, ALL)).toBeNull();
  });

  it('sends nothing when the list is only reordered', () => {
    expect(
      assignedTaskPush({ ...base, assigned_to: 'ben', assignees: ['ben', 'ann'] }, { assigned_to: 'ann', assignees: ['ann', 'ben'] }, ALL),
    ).toBeNull();
  });

  it('has a fallback body for an untitled task, and stays quiet with Tasks off', () => {
    expect(assignedTaskPush({ ...base, title: '', assigned_to: 'ann' }, null, ALL)?.payload.body).toBe('A task was assigned to you');
    expect(assignedTaskPush({ ...base, assigned_to: 'ann' }, null, NO_TASKS)).toBeNull();
  });
});

describe('new comment', () => {
  const t = { id: 't1', group_id: 'g1', template_key: null, title: 'Paint the fence', assigned_to: 'ann', assignees: ['ann', 'ben'] };

  it('goes to everyone on the task and earlier commenters, never the writer', () => {
    const plan = taskCommentPush(t, { user_id: 'ben', content: 'Done the first coat' }, ['cat', 'ben', null, 'cat'], ALL);
    expect(plan?.to.sort()).toEqual(['ann', 'cat']);
    expect(plan?.payload).toMatchObject({ title: 'New comment: Paint the fence', body: 'Done the first coat', tag: 'comment-t1' });
  });

  it('sends nothing when the writer is the only person involved', () => {
    expect(taskCommentPush({ ...t, assigned_to: 'ann', assignees: ['ann'] }, { user_id: 'ann', content: 'note' }, ['ann'], ALL)).toBeNull();
  });

  it('sends nothing with Tasks off', () => {
    expect(taskCommentPush(t, { user_id: 'cat', content: 'hi' }, [], NO_TASKS)).toBeNull();
  });

  it('cuts a long comment to 80 characters', () => {
    const long = 'x'.repeat(120);
    expect(commentSnippet(long)).toHaveLength(80);
    expect(commentSnippet(long).endsWith('…')).toBe(true);
    expect(commentSnippet('  short  ')).toBe('short');
    expect(commentSnippet(null)).toBe('');
  });
});

describe('event readers', () => {
  it('is the household for a shared event, without repeats', () => {
    expect(eventReaders({ private: false, created_by: 'ann' }, ['ann', 'ben', 'ann'])).toEqual(['ann', 'ben']);
  });

  it('is only the maker of a private event', () => {
    expect(eventReaders({ private: true, created_by: 'ann' }, ['ann', 'ben'])).toEqual(['ann']);
    expect(eventReaders({ private: true, created_by: null }, ['ann', 'ben'])).toEqual([]);
  });
});

describe('event reminders', () => {
  const event = { id: 'e1', starts_at: '2026-11-12T08:00:00Z' };

  it('opens the event day on the reader’s own clock', () => {
    expect(calendarHref(event.starts_at, 'Australia/Sydney')).toBe('/calendar?date=2026-11-12');
    expect(calendarHref('2026-11-12T20:00:00Z', 'Australia/Sydney')).toBe('/calendar?date=2026-11-13');
    expect(calendarHref('2026-11-12T20:00:00Z', 'America/New_York')).toBe('/calendar?date=2026-11-12');
  });

  it('adds the forecast as its own sentence', () => {
    const p = eventReminderPush(event, 1, 'Australia/Sydney', { title: 'Swim', body: 'Tomorrow at 7:00pm' }, 'showers, 18°');
    expect(p.body).toBe('Tomorrow at 7:00pm. Showers, 18°');
    expect(eventReminderPush(event, 1, 'Australia/Sydney', { title: 'Swim', body: 'Tomorrow' }, null).body).toBe('Tomorrow');
  });

  it('tags each reminder day apart and carries the start for snooze', () => {
    const week = eventReminderPush(event, 7, 'Australia/Sydney', { title: 'a', body: 'b' }, null);
    const day = eventReminderPush(event, 1, 'Australia/Sydney', { title: 'a', body: 'b' }, null);
    expect(week.tag).toBe('event-e1-7');
    expect(day.tag).toBe('event-e1-1');
    expect(day).toMatchObject({ snooze: 'event', startsAt: event.starts_at });
  });
});

describe('leave by', () => {
  // Starts 9:00 UTC with a 30 minute drive: leave at 8:20 (10 minute buffer).
  const event: LeaveEvent = {
    id: 'e1',
    title: 'Dentist',
    starts_at: '2026-11-10T09:00:00Z',
    location: ' 1 Main St ',
    travel_mode: 'drive',
    travel_minutes: 30,
    private: false,
    created_by: 'ann',
  };

  it('pushes each reader on their own lead time', () => {
    const now = new Date('2026-11-10T07:16:00Z'); // 64 minutes before leaving
    const settings = new Map([
      ['ann', { leave_alert_minutes: 60 }],
      ['ben', { leave_alert_minutes: 30 }],
    ]);
    expect(leaveDueReaders(event, ['ann', 'ben', 'cat'], settings, new Map(), now)).toEqual(['ann', 'cat']);
  });

  it('pushes once per start time, and again after the event moves', () => {
    const now = new Date('2026-11-10T07:50:00Z');
    expect(leaveDueReaders(event, ['ann'], new Map(), new Map([['ann', '2026-11-10T09:00:00Z']]), now)).toEqual([]);
    expect(leaveDueReaders(event, ['ann'], new Map(), new Map([['ann', '2026-11-10T08:00:00Z']]), now)).toEqual(['ann']);
  });

  it('pushes nobody once the event has started, or with no travel time', () => {
    expect(leaveDueReaders(event, ['ann'], new Map(), new Map(), new Date('2026-11-10T09:00:00Z'))).toEqual([]);
    expect(leaveDueReaders({ ...event, travel_minutes: null }, ['ann'], new Map(), new Map(), new Date('2026-11-10T08:00:00Z'))).toEqual(
      [],
    );
  });

  it('writes the push in the reader’s time zone, falling back when it is unknown', () => {
    const p = leavePush(event, { timezone: 'Australia/Sydney' });
    expect(p).toMatchObject({ title: 'Leave by 7:20pm for Dentist', tag: 'leave-e1', snooze: 'leave', url: '/calendar?date=2026-11-10' });
    expect(p.body).toBe('30 min by car to 1 Main St, starts 8:00pm');
    expect(leavePush(event, { timezone: 'Not/AZone' }).title).toBe(leavePush(event, undefined).title);
  });
});

describe('time zones', () => {
  it('keeps a real zone and falls back for a missing or broken one', () => {
    expect(zoneOrFallback('Europe/Berlin')).toBe('Europe/Berlin');
    expect(zoneOrFallback(null)).toBe(FALLBACK_TIMEZONE);
    expect(zoneOrFallback('')).toBe(FALLBACK_TIMEZONE);
    expect(zoneOrFallback('Mars/Olympus')).toBe(FALLBACK_TIMEZONE);
  });
});

describe('bin night', () => {
  const plan: BinPlanRow = {
    group_id: 'g1',
    push_at: '21:00',
    rotation: null,
    rotation_anchor: null,
    out_for: null,
    timezone: 'Australia/Sydney',
  };
  // 10:30 UTC is 9:30 pm in Sydney (AEDT, UTC+11) on 10 Nov.
  const after = new Date('2026-11-10T10:30:00Z');
  const before = new Date('2026-11-10T09:30:00Z');

  it('waits for the push time, then pushes for tomorrow', () => {
    expect(binNightCollection(plan, before)).toBeNull();
    expect(binNightCollection(plan, after)).toBe('2026-11-11');
  });

  it('stays quiet once the bins are marked out, or with no push time', () => {
    expect(binNightCollection({ ...plan, out_for: '2026-11-11' }, after)).toBeNull();
    expect(binNightCollection({ ...plan, out_for: '2026-11-04' }, after)).toBe('2026-11-11');
    expect(binNightCollection({ ...plan, push_at: null }, after)).toBeNull();
  });

  it('uses the fallback zone for a broken one instead of failing the run', () => {
    expect(binNightCollection({ ...plan, timezone: 'Nope/Nope' }, after)).toBe('2026-11-11');
  });

  it('goes to whoever’s turn it is, or everyone with no rotation', () => {
    expect(binNightReaders(plan, '2026-11-11', ['ann', 'ben', 'ann'])).toEqual(['ann', 'ben']);
    const rota = { ...plan, rotation: ['ann', 'ben'], rotation_anchor: '2026-11-04' };
    expect(binNightReaders(rota, '2026-11-04', ['ann', 'ben'])).toEqual(['ann']);
    expect(binNightReaders(rota, '2026-11-11', ['ann', 'ben'])).toEqual(['ben']);
    expect(binNightReaders(rota, '2026-11-18', [])).toEqual(['ann']);
  });

  it('names the bins and carries the bins snooze buttons', () => {
    expect(binNightPush('g1', '2026-11-11', [{ name: 'Rubbish' }, { name: 'Recycling' }])).toEqual({
      title: 'Bins out tonight',
      body: 'Rubbish and recycling, collected tomorrow morning.',
      url: '/bins',
      tag: 'bins-g1-2026-11-11',
      snooze: 'bins',
    });
  });
});

describe('delivery to phones and browsers', () => {
  it('gives each reminder kind its own snooze buttons on the phone', () => {
    for (const kind of SNOOZE_KINDS) {
      const m = expoMessage('tok', { title: 'a', body: 'b', url: '/x', tag: 't', snooze: kind });
      expect(m.categoryId).toBe(snoozeCategoryId(kind));
      expect(snoozeKindFromCategory(m.categoryId)).toBe(kind);
    }
  });

  it('leaves the buttons off a push with no snooze kind', () => {
    expect(expoMessage('tok', { title: 'a', body: 'b', url: '/x', tag: 't' })).not.toHaveProperty('categoryId');
  });

  it('sends the link the phone opens on a tap, and an event’s start', () => {
    expect(expoMessage('tok', { title: 'a', body: 'b', url: '/tasks?focus=1', tag: 't' }).data).toEqual({ url: '/tasks?focus=1' });
    expect(expoMessage('tok', { title: 'a', body: 'b', url: '/calendar', tag: 't', startsAt: '2026-11-12T08:00:00Z' }).data).toEqual({
      url: '/calendar',
      startsAt: '2026-11-12T08:00:00Z',
    });
  });

  it('prunes only tokens Expo says are gone', () => {
    const read = readExpoTickets(
      ['a', 'b', 'c', 'd'],
      [
        { status: 'ok' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', details: { error: 'MessageRateExceeded' } },
        { status: 'ok' },
      ],
    );
    expect(read.sent).toBe(2);
    expect(read.stale).toEqual(['b']);
    expect(read.failed).toHaveLength(1);
  });

  it('copes with fewer tickets than tokens', () => {
    expect(readExpoTickets(['a', 'b'], [])).toEqual({ sent: 0, stale: [], failed: [] });
  });

  it('prunes a browser subscription only when the push service says it is gone', () => {
    expect(isStaleWebPushStatus(404)).toBe(true);
    expect(isStaleWebPushStatus(410)).toBe(true);
    expect(isStaleWebPushStatus(429)).toBe(false);
    expect(isStaleWebPushStatus(500)).toBe(false);
    expect(isStaleWebPushStatus(undefined)).toBe(false);
  });
});
