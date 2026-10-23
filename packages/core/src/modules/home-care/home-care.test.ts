import { describe, expect, it } from 'vitest';
import {
  addMonthsISO,
  careDonePatch,
  careDue,
  careDueGroups,
  careEveryLabel,
  careJobFromSuggestion,
  careOverview,
  careReminderDue,
  careRoomGroups,
  careSeasonGroups,
  careSkipPatch,
  careStatePatch,
  careSuggestionsFor,
  careUndoDonePatch,
  CARE_LOG_MAX,
  CARE_SUGGESTIONS,
  firstDueDate,
  monthBeforeSeason,
  nextDueAfter,
  openSuggestionsByArea,
  seasonOfMonth,
  wantsReminder,
  type CareJob,
} from './home-care';
import { parseReminderKey, reminderKey } from '../../reminders';
import { taskOwnerModule, taskOpenHref } from '../../task-modules';

function job(over: Partial<CareJob> = {}): CareJob {
  return {
    id: 'j1',
    group_id: 'g1',
    title: 'Clean aircon filters',
    area: 'climate',
    room: 'Living',
    suggestion_id: 'aircon-filter',
    state: 'active',
    every_n: 3,
    every_unit: 'month',
    season_month: null,
    next_due: '2026-11-01',
    last_done: null,
    assigned_to: null,
    remind: true,
    remind_days_before: 0,
    notes: null,
    done_log: [],
    created_by: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    deleted: false,
    ...over,
  };
}

describe('seasons', () => {
  it('puts "before summer" in November down south and May up north', () => {
    expect(monthBeforeSeason('summer', true)).toBe(11);
    expect(monthBeforeSeason('summer', false)).toBe(5);
    expect(monthBeforeSeason('winter', true)).toBe(5);
    expect(monthBeforeSeason('spring', true)).toBe(8);
  });

  it('knows which season a month is in', () => {
    expect(seasonOfMonth(1, true)).toBe('summer');
    expect(seasonOfMonth(10, true)).toBe('spring');
    expect(seasonOfMonth(1, false)).toBe('winter');
  });
});

describe('scheduling', () => {
  it('adds months and clamps the day', () => {
    expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsISO('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('runs an interval from the day it was done', () => {
    expect(nextDueAfter(job(), '2026-10-23')).toBe('2027-01-23');
    expect(nextDueAfter(job({ every_n: 2, every_unit: 'week' }), '2026-10-23')).toBe('2026-11-06');
    expect(nextDueAfter(job({ every_n: 1, every_unit: 'year' }), '2026-10-23')).toBe('2027-10-23');
  });

  it('moves a season job to its month next year', () => {
    expect(nextDueAfter(job({ season_month: 11 }), '2026-11-10')).toBe('2027-11-01');
    expect(nextDueAfter(job({ season_month: 11 }), '2026-10-20')).toBe('2026-11-01');
  });

  it('never makes a new job due on day one', () => {
    expect(firstDueDate(job(), '2026-10-23')).toBe('2026-11-23');
    expect(firstDueDate(job({ every_n: 2, every_unit: 'week' }), '2026-10-23')).toBe('2026-11-06');
    expect(firstDueDate(job({ season_month: 11 }), '2026-10-23')).toBe('2026-11-01');
    expect(firstDueDate(job({ season_month: 10 }), '2026-10-23')).toBe('2027-10-01');
  });

  it('sets the reminder ahead of the job but never in the past', () => {
    expect(careReminderDue(job({ remind_days_before: 7 }), '2026-10-23')).toBe('2026-10-25');
    expect(careReminderDue(job({ remind_days_before: 14 }), '2026-10-23')).toBe('2026-10-23');
    expect(wantsReminder(job())).toBe(true);
    expect(wantsReminder(job({ state: 'paused' }))).toBe(false);
    expect(wantsReminder(job({ remind: false }))).toBe(false);
  });
});

describe('doing a job', () => {
  it('logs it, moves the due date, and can undo', () => {
    const j = job();
    const done = careDonePatch(j, '2026-10-23', 'u1');
    expect(done.next_due).toBe('2027-01-23');
    expect(done.last_done).toBe('2026-10-23');
    expect(done.done_log).toEqual([{ on: '2026-10-23', by: 'u1', prev_due: '2026-11-01' }]);
    const undone = careUndoDonePatch({ ...j, ...done });
    expect(undone).toEqual({ last_done: null, next_due: '2026-11-01', done_log: [] });
    expect(careUndoDonePatch(j)).toBeNull();
  });

  it('keeps the log short', () => {
    let j = job();
    for (let i = 0; i < CARE_LOG_MAX + 5; i++) j = { ...j, ...careDonePatch(j, '2026-10-23', null) };
    expect(j.done_log).toHaveLength(CARE_LOG_MAX);
  });

  it('skips to the following due date without logging', () => {
    expect(careSkipPatch(job(), '2026-10-23')).toEqual({ next_due: '2027-02-01' });
    expect(careSkipPatch(job({ next_due: '2026-09-01' }), '2026-10-23')).toEqual({ next_due: '2027-01-23' });
  });

  it('gives a resumed job a due date that is not in the past', () => {
    expect(careStatePatch(job({ state: 'paused', next_due: '2026-01-01' }), 'active', '2026-10-23')).toEqual({
      state: 'active',
      next_due: '2026-11-23',
    });
    expect(careStatePatch(job(), 'hidden', '2026-10-23')).toEqual({ state: 'hidden' });
  });
});

describe('labels', () => {
  it('says how often', () => {
    expect(careEveryLabel(job(), true)).toBe('every 3 months');
    expect(careEveryLabel(job({ every_n: 1, every_unit: 'year' }), true)).toBe('yearly');
    expect(careEveryLabel(job({ season_month: 11 }), true)).toBe('before summer');
    expect(careEveryLabel(job({ season_month: 11 }), false)).toBe('before winter');
    expect(careEveryLabel(job({ season_month: 1 }), true)).toBe('every Jan');
  });

  it('says when, relatively', () => {
    expect(careDue(job({ next_due: '2026-10-13' }), '2026-10-23')).toEqual({ tone: 'overdue', text: '1 week overdue' });
    expect(careDue(job({ next_due: '2026-10-22' }), '2026-10-23')).toEqual({ tone: 'overdue', text: '1 day overdue' });
    expect(careDue(job({ next_due: '2026-10-24' }), '2026-10-23')).toEqual({ tone: 'soon', text: 'Tomorrow' });
    expect(careDue(job({ next_due: '2026-11-12' }), '2026-10-23')).toEqual({ tone: 'later', text: '12 Nov' });
    expect(careDue(job({ next_due: '2026-12-01', season_month: 12 }), '2026-10-23')).toEqual({ tone: 'later', text: 'Dec' });
    expect(careDue(job({ next_due: '2027-03-01' }), '2026-10-23')).toEqual({ tone: 'later', text: 'Mar 2027' });
  });
});

describe('views', () => {
  const jobs = [
    job({ id: 'a', next_due: '2026-10-16', room: 'Living' }),
    job({ id: 'b', title: 'Test smoke alarms', next_due: '2026-10-30', room: null }),
    job({ id: 'c', title: 'Clear the gutters', next_due: '2026-12-01', room: 'Outside', season_month: 11 }),
    job({ id: 'd', state: 'paused', next_due: '2026-10-24' }),
    job({ id: 'e', state: 'hidden' }),
    job({ id: 'f', deleted: true }),
  ];

  it('counts the Hero and the states', () => {
    expect(careOverview(jobs, '2026-10-23')).toEqual({ dueThisMonth: 2, overdue: 1, active: 3, paused: 1, hidden: 1 });
  });

  it('splits the due list', () => {
    const g = careDueGroups(jobs, '2026-10-23');
    expect(g.soon.map((j) => j.id)).toEqual(['a', 'b']);
    expect(g.later.map((j) => j.id)).toEqual(['c']);
  });

  it('groups by room, overdue rooms first', () => {
    expect(careRoomGroups(jobs, '2026-10-23').map((r) => [r.room, r.jobs.length])).toEqual([
      ['Living', 1],
      ['Outside', 1],
      ['Whole house', 1],
    ]);
  });

  it('walks four seasons from the current one, overdue joining it', () => {
    const groups = careSeasonGroups(jobs, '2026-10-23', true);
    expect(groups.map((g) => [g.season, g.from])).toEqual([
      ['spring', '2026-09-01'],
      ['summer', '2026-12-01'],
      ['autumn', '2027-03-01'],
      ['winter', '2027-06-01'],
    ]);
    expect(groups[0].jobs.map((j) => j.id)).toEqual(['a', 'b']);
    expect(groups[1].jobs.map((j) => j.id)).toEqual(['c']);
    expect(groups[0].current).toBe(true);
  });
});

describe('suggestions', () => {
  it('keeps the first-run picks few', () => {
    expect(CARE_SUGGESTIONS.filter((s) => s.preticked).length).toBeLessThanOrEqual(3);
    expect(new Set(CARE_SUGGESTIONS.map((s) => s.id)).size).toBe(CARE_SUGGESTIONS.length);
  });

  it('offers termite inspections in Australia only', () => {
    expect(careSuggestionsFor('AU').some((s) => s.id === 'termite-inspection')).toBe(true);
    expect(careSuggestionsFor('DE').some((s) => s.id === 'termite-inspection')).toBe(false);
  });

  it('turns a suggestion into a job and stops offering it, hidden ones included', () => {
    const s = CARE_SUGGESTIONS.find((x) => x.id === 'gutters')!;
    const fields = careJobFromSuggestion(s, true, '2026-10-23');
    expect(fields.season_month).toBe(11);
    expect(fields.next_due).toBe('2026-11-01');
    expect(fields.remind).toBe(true);
    const hidden = careJobFromSuggestion(CARE_SUGGESTIONS.find((x) => x.id === 'pool-fence')!, true, '2026-10-23', 'hidden');
    expect(hidden.next_due).toBeNull();
    const open = openSuggestionsByArea(
      [job({ suggestion_id: 'gutters' }), job({ id: 'p', suggestion_id: 'pool-fence', state: 'hidden' })],
      'AU',
    ).flatMap((g) => g.suggestions.map((x) => x.id));
    expect(open).not.toContain('gutters');
    expect(open).not.toContain('pool-fence');
    expect(open).toContain('pool-water');
  });
});

describe('reminders', () => {
  it('keys a job reminder by job and due date, owned by Home care', () => {
    const key = reminderKey('care', 'job-1', '2026-11-01');
    expect(key).toBe('care-reminder:job-1:2026-11-01');
    expect(parseReminderKey(key)).toEqual({ kind: 'care', originId: 'job-1', sub: '2026-11-01' });
    expect(taskOwnerModule({ template_key: key })).toBe('home-care');
    expect(taskOpenHref({ id: 't', template_key: key }, new Set(['setup', 'home-care']))).toBe('/setup?view=care');
    expect(taskOpenHref({ id: 't', template_key: key }, new Set(['setup']))).toBeNull();
  });
});
