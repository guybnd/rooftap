import { describe, expect, it } from 'vitest';
import {
  anchorRepeatRule,
  approxRepeatDays,
  firstRepeatDate,
  formatRepeatRule,
  nextRepeat,
  nextRepeatDate,
  parseRepeatRule,
  repeatRuleLabel,
  taskRepeatLabel,
} from './repeat-rule';
import { applyTaskCompletion } from './household-tasks';
import type { HouseholdTask } from '../../types';

const rule = (text: string) => {
  const r = parseRepeatRule(text);
  if (!r) throw new Error(`bad rule ${text}`);
  return r;
};

/** The next `n` dates after `from`. */
function chain(text: string, from: string, n: number): string[] {
  const r = rule(text);
  const out: string[] = [];
  let at: string | null = from;
  for (let i = 0; i < n && at; i++) {
    at = nextRepeatDate(r, at);
    if (at) out.push(at);
  }
  return out;
}

describe('parseRepeatRule', () => {
  it('reads the rules Google Calendar writes', () => {
    expect(rule('RRULE:FREQ=MONTHLY;BYMONTHDAY=1')).toEqual({ freq: 'MONTHLY', interval: 1, byMonthDay: 1 });
    expect(rule('FREQ=MONTHLY;BYDAY=1SU')).toEqual({ freq: 'MONTHLY', interval: 1, byNthDay: { nth: 1, day: 'SU' } });
    expect(rule('FREQ=MONTHLY;BYDAY=SU;BYSETPOS=1')).toEqual({ freq: 'MONTHLY', interval: 1, byNthDay: { nth: 1, day: 'SU' } });
    expect(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TH,MO;WKST=MO')).toEqual({ freq: 'WEEKLY', interval: 2, byDay: ['MO', 'TH'] });
    expect(rule('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH').byNthDay).toEqual({ nth: 4, day: 'TH' });
    expect(rule('FREQ=DAILY;UNTIL=20270301T000000Z').until).toBe('2027-03-01');
    expect(rule('FREQ=DAILY;COUNT=5').count).toBe(5);
  });

  it('refuses what it cannot follow, rather than guessing', () => {
    for (const bad of [
      '',
      'FREQ=HOURLY',
      'FREQ=MONTHLY;BYMONTHDAY=0',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
      'FREQ=WEEKLY;BYDAY=1MO',
      'FREQ=MONTHLY;BYYEARDAY=5',
      'FREQ=WEEKLY;INTERVAL=0',
      'FREQ=MONTHLY;BYDAY=6SU',
      'nonsense',
    ]) {
      expect(parseRepeatRule(bad)).toBeNull();
    }
  });

  it('writes back what it read', () => {
    for (const text of [
      'FREQ=MONTHLY;BYMONTHDAY=1',
      'FREQ=MONTHLY;BYDAY=1SU',
      'FREQ=MONTHLY;BYMONTHDAY=-1',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH',
      'FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=1;COUNT=3',
      'FREQ=DAILY;UNTIL=20270301',
    ]) {
      expect(formatRepeatRule(rule(text))).toBe(text);
    }
  });
});

describe('nextRepeatDate', () => {
  it('lands on the 1st of every month', () => {
    expect(chain('FREQ=MONTHLY;BYMONTHDAY=1', '2026-11-01', 4)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01']);
  });

  it('lands on the first Sunday of every month', () => {
    expect(chain('FREQ=MONTHLY;BYDAY=1SU', '2026-11-01', 3)).toEqual(['2026-12-06', '2027-01-03', '2027-02-07']);
  });

  it('lands on the last day of every month, leap years too', () => {
    expect(chain('FREQ=MONTHLY;BYMONTHDAY=-1', '2027-12-31', 3)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('lands on the last Friday', () => {
    expect(chain('FREQ=MONTHLY;BYDAY=-1FR', '2026-10-30', 2)).toEqual(['2026-11-27', '2026-12-25']);
  });

  it('skips a month without the day, as a calendar does', () => {
    expect(chain('FREQ=MONTHLY;BYMONTHDAY=31', '2026-10-31', 2)).toEqual(['2026-12-31', '2027-01-31']);
  });

  it('every 3 months', () => {
    expect(chain('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15', '2026-01-15', 2)).toEqual(['2026-04-15', '2026-07-15']);
  });

  it('every 2 weeks on Monday and Thursday', () => {
    // 2 Nov 2026 is a Monday.
    expect(chain('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH', '2026-11-02', 4)).toEqual(['2026-11-05', '2026-11-16', '2026-11-19', '2026-11-30']);
  });

  it('every weekday', () => {
    // 30 Oct 2026 is a Friday.
    expect(chain('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-10-30', 2)).toEqual(['2026-11-02', '2026-11-03']);
    expect(chain('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', '2026-10-30', 2)).toEqual(['2026-11-02', '2026-11-03']);
  });

  it('yearly, by date and by nth weekday', () => {
    expect(chain('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', '2028-02-29', 1)).toEqual(['2032-02-29']);
    expect(chain('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', '2026-11-26', 1)).toEqual(['2027-11-25']);
  });

  it('stops after UNTIL', () => {
    expect(chain('FREQ=MONTHLY;BYMONTHDAY=1;UNTIL=20270101', '2026-11-01', 5)).toEqual(['2026-12-01', '2027-01-01']);
  });

  it('a bare monthly rule takes its day from the date it counts from', () => {
    expect(chain('FREQ=MONTHLY', '2026-11-01', 2)).toEqual(['2026-12-01', '2027-01-01']);
  });
});

describe('nextRepeat', () => {
  it('rolls forward past missed months, never into the past', () => {
    expect(nextRepeat(rule('FREQ=MONTHLY;BYMONTHDAY=1'), '2026-06-01', '2026-10-29')).toEqual({
      dueDate: '2026-11-01',
      rule: rule('FREQ=MONTHLY;BYMONTHDAY=1'),
    });
  });

  it('counts COUNT down and ends on the last one', () => {
    const r = rule('FREQ=WEEKLY;BYDAY=MO;COUNT=2');
    const next = nextRepeat(r, '2026-11-02', '2026-11-02');
    expect(next?.dueDate).toBe('2026-11-09');
    expect(next?.rule.count).toBe(1);
    expect(nextRepeat(next!.rule, '2026-11-09', '2026-11-09')).toBeNull();
  });
});

describe('anchorRepeatRule and firstRepeatDate', () => {
  it('fills a bare rule from the first due date', () => {
    expect(anchorRepeatRule(rule('FREQ=MONTHLY'), '2026-11-01').byMonthDay).toBe(1);
    expect(anchorRepeatRule(rule('FREQ=WEEKLY'), '2026-11-01').byDay).toEqual(['SU']);
    expect(anchorRepeatRule(rule('FREQ=YEARLY'), '2026-11-01')).toMatchObject({ byMonth: 11, byMonthDay: 1 });
  });

  it('finds the first date on or after a day', () => {
    expect(firstRepeatDate(rule('FREQ=MONTHLY;BYMONTHDAY=1'), '2026-10-29')).toBe('2026-11-01');
    expect(firstRepeatDate(rule('FREQ=MONTHLY;BYMONTHDAY=1'), '2026-11-01')).toBe('2026-11-01');
    expect(firstRepeatDate(rule('FREQ=MONTHLY;BYDAY=1SU'), '2026-11-02')).toBe('2026-12-06');
  });
});

describe('labels and day counts', () => {
  it('says the rule in words', () => {
    expect(repeatRuleLabel(rule('FREQ=MONTHLY;BYMONTHDAY=1'))).toBe('Monthly on the 1st');
    expect(repeatRuleLabel(rule('FREQ=MONTHLY;BYMONTHDAY=22'))).toBe('Monthly on the 22nd');
    expect(repeatRuleLabel(rule('FREQ=MONTHLY;BYDAY=1SU'))).toBe('Monthly on the first Sunday');
    expect(repeatRuleLabel(rule('FREQ=MONTHLY;BYMONTHDAY=-1'))).toBe('Monthly on the last day');
    expect(repeatRuleLabel(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH'))).toBe('Fortnightly on Mon, Thu');
    expect(repeatRuleLabel(rule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'))).toBe('Every weekday');
    expect(repeatRuleLabel(rule('FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=1'))).toBe('Yearly on 1 November');
    expect(repeatRuleLabel(rule('FREQ=DAILY;UNTIL=20270301'))).toBe('Daily, until 1 Mar 2027');
    expect(repeatRuleLabel(rule('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1;COUNT=4'))).toBe('Every 3 months on the 1st, 4 times left');
  });

  it('keeps a rough day count for apps without rules', () => {
    expect(approxRepeatDays(rule('FREQ=MONTHLY;BYMONTHDAY=1'))).toBe(30);
    expect(approxRepeatDays(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH'))).toBe(7);
    expect(approxRepeatDays(rule('FREQ=YEARLY'))).toBe(365);
  });

  it('a task without a rule keeps its old label', () => {
    expect(taskRepeatLabel({ recurrence_days: 14 })).toBe('Fortnightly');
    expect(taskRepeatLabel({ recurrence_days: 30, repeat_rule: 'FREQ=MONTHLY;BYMONTHDAY=1' })).toBe('Monthly on the 1st');
    expect(taskRepeatLabel({ recurrence_days: null })).toBeNull();
  });
});

describe('applyTaskCompletion with a rule', () => {
  const task = (over: Partial<HouseholdTask>): HouseholdTask =>
    ({
      id: 't1', group_id: 'g', title: 'Send out invoice', due_date: '2026-11-01', due_time: null,
      offset_days: null, recurrence_days: 30, done: false, completed_at: null, assigned_to: 'u',
      private: false, template_key: null, notes: null, sort_order: 0, priority: 'medium', deleted: false,
      created_at: '', updated_at: '', ...over,
    }) as HouseholdTask;

  it('makes the next one on the 1st, carrying the rule', () => {
    const { createNextOccurrence } = applyTaskCompletion(task({ repeat_rule: 'FREQ=MONTHLY;BYMONTHDAY=1' }), true, {
      nextId: 'n',
    });
    // From 1 Nov the next is 1 Dec at the earliest; rolled forward past today when the test runs later.
    expect(createNextOccurrence?.due_date?.slice(8)).toBe('01');
    expect(createNextOccurrence?.repeat_rule).toBe('FREQ=MONTHLY;BYMONTHDAY=1');
    expect(createNextOccurrence?.recurrence_days).toBe(30);
  });

  it('makes no next one when the rule has run out', () => {
    const { createNextOccurrence } = applyTaskCompletion(task({ repeat_rule: 'FREQ=MONTHLY;BYMONTHDAY=1;COUNT=1' }), true, {
      nextId: 'n',
    });
    expect(createNextOccurrence).toBeNull();
  });

  it('a task without a rule carries no repeat_rule field', () => {
    const { createNextOccurrence } = applyTaskCompletion(task({}), true, { nextId: 'n' });
    expect(createNextOccurrence).not.toBeNull();
    expect('repeat_rule' in createNextOccurrence!).toBe(false);
  });
});
