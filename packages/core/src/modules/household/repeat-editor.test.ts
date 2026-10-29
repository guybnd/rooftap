import { describe, expect, it } from 'vitest';
import {
  repeatChoices,
  repeatDraftFrom,
  repeatFollowDue,
  repeatMonthModeOptions,
  repeatPreview,
  repeatRuleFromDraft,
  repeatSaveFields,
  repeatValueLabel,
  selectedRepeatChoice,
  repeatDateLabel,
} from './repeat-editor';
import { formatRepeatRule } from './repeat-rule';

const TODAY = '2026-10-29';

describe('repeatChoices', () => {
  it('builds the list from the due date, like Google Calendar', () => {
    // 1 Nov 2026 is a Sunday.
    expect(repeatChoices('2026-11-01', TODAY, true).map((c) => c.label)).toEqual([
      'Does not repeat',
      'Daily',
      'Weekly on Sunday',
      'Fortnightly on Sunday',
      'Monthly on the 1st',
      'Monthly on the first Sunday',
      'Yearly on 1 November',
      'Every weekday',
    ]);
  });

  it('offers the last day on a month end, and the last weekday for a fifth one', () => {
    const labels = repeatChoices('2026-10-31', TODAY, true).map((c) => c.label);
    expect(labels).toContain('Monthly on the last day');
    expect(labels).toContain('Monthly on the last Saturday');
  });

  it('falls back to day counts on a server without rules, never sending repeat_rule', () => {
    const choices = repeatChoices('2026-11-01', TODAY, false);
    expect(choices.every((c) => !('repeat_rule' in c.patch))).toBe(true);
    expect(choices.map((c) => c.patch.recurrence_days)).toEqual([null, 1, 7, 14, 30]);
  });

  it('finds the picked choice from what a task stores', () => {
    const choices = repeatChoices('2026-11-01', TODAY, true);
    expect(selectedRepeatChoice({ recurrence_days: 30, repeat_rule: 'FREQ=MONTHLY;BYMONTHDAY=1' }, choices)).toBe('monthly-day');
    expect(selectedRepeatChoice({ recurrence_days: null, repeat_rule: null }, choices)).toBe('none');
    expect(selectedRepeatChoice({ recurrence_days: 30 }, choices)).toBeNull();
    expect(repeatValueLabel({ recurrence_days: 30 })).toBe('Monthly');
  });
});

describe('repeatFollowDue', () => {
  it('moves a picked choice with the date, and leaves a custom rule alone', () => {
    const weekly = repeatChoices('2026-11-01', TODAY, true).find((c) => c.id === 'weekly')!.patch;
    expect(repeatFollowDue(weekly, '2026-11-01', '2026-11-02', TODAY, true).repeat_rule).toBe('FREQ=WEEKLY;BYDAY=MO');
    const custom = { recurrence_days: 7, repeat_rule: 'FREQ=WEEKLY;BYDAY=MO,TH' };
    expect(repeatFollowDue(custom, '2026-11-02', '2026-11-03', TODAY, true)).toBe(custom);
  });
});

describe('the Custom builder', () => {
  it('words the month choices from the due date', () => {
    expect(repeatMonthModeOptions('2026-11-01', TODAY).map((o) => o.label)).toEqual(['Day 1', 'The first Sunday', 'The last day']);
  });

  it('round-trips a rule through the builder', () => {
    for (const text of [
      'FREQ=MONTHLY;BYDAY=1SU',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=6',
      'FREQ=MONTHLY;BYMONTHDAY=-1;UNTIL=20270601',
      'FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=1',
    ]) {
      const due = text.includes('BYDAY=MO') ? '2026-11-02' : text.includes('-1') ? '2026-11-30' : '2026-11-01';
      const draft = repeatDraftFrom({ recurrence_days: null, repeat_rule: text }, due, TODAY);
      expect(formatRepeatRule(repeatRuleFromDraft(draft, due, TODAY))).toBe(text);
    }
  });

  it('starts from an old day count', () => {
    expect(repeatDraftFrom({ recurrence_days: 14 }, '2026-11-01', TODAY)).toMatchObject({ unit: 'week', interval: 2 });
    expect(repeatDraftFrom({ recurrence_days: 3 }, '2026-11-01', TODAY)).toMatchObject({ unit: 'day', interval: 3 });
  });
});

describe('preview and save', () => {
  it('lists the next dates', () => {
    const next = repeatPreview({ recurrence_days: 30, repeat_rule: 'FREQ=MONTHLY;BYDAY=1SU' }, '2026-11-01', TODAY);
    expect(next).toEqual(['2026-12-06', '2027-01-03', '2027-02-07']);
    expect(next.map((d) => repeatDateLabel(d, TODAY))).toEqual(['Sun 6 Dec', 'Sun 3 Jan 2027', 'Sun 7 Feb 2027']);
    expect(repeatPreview({ recurrence_days: 30, repeat_rule: 'FREQ=MONTHLY;BYMONTHDAY=1;COUNT=2' }, '2026-11-01', TODAY)).toEqual(['2026-12-01']);
  });

  it('gives a repeating task with no date the first day of its rule', () => {
    expect(repeatSaveFields({ recurrence_days: 30, repeat_rule: 'FREQ=MONTHLY;BYMONTHDAY=1' }, null, TODAY).due_date).toBe('2026-11-01');
    expect(repeatSaveFields({ recurrence_days: 7 }, null, TODAY).due_date).toBeNull();
  });
});
