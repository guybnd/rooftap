import { describe, expect, it } from 'vitest';
import {
  matchTitleWords,
  stripTitleWords,
  titleMatchLabel,
  addedToLabel,
  dueQuickChoices,
  dueValueLabel,
  itemSheetDrafts,
  itemTitleError,
  personFirstName,
  personInitial,
  timeChoiceLabel,
  timeValueLabel,
  TIME_QUICK_CHOICES,
  weekStrip,
  weekStripMonth,
  weekStripOffsetFor,
} from './item-sheet';

// 2026-11-07 is a Saturday.
const SAT = '2026-11-07';
const WED = '2026-11-11';

describe('dueQuickChoices', () => {
  it('offers this weekend on a weekday', () => {
    const c = dueQuickChoices(WED);
    expect(c.map((x) => x.label)).toEqual(['Today', 'Tomorrow', 'This weekend', 'Next week', 'No date']);
    expect(c[0].value).toBe(WED);
    expect(c[1].value).toBe('2026-11-12');
    expect(c[2].value).toBe('2026-11-14');
    expect(c[3].value).toBe('2026-11-18');
    expect(c[4].value).toBe('');
  });
  it('moves to next weekend on Saturday and Sunday', () => {
    expect(dueQuickChoices(SAT)[2]).toMatchObject({ label: 'Next weekend', value: '2026-11-14' });
    expect(dueQuickChoices('2026-11-08')[2]).toMatchObject({ label: 'Next weekend', value: '2026-11-14' });
  });
});

describe('weekStrip', () => {
  it('starts today and steps by weeks', () => {
    const days = weekStrip(SAT);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ iso: SAT, letter: 'S', day: 7, isToday: true });
    expect(days[2]).toMatchObject({ iso: '2026-11-09', letter: 'M', isToday: false });
    expect(weekStrip(SAT, 1)[0].iso).toBe('2026-11-14');
  });
  it('finds the week that holds a date', () => {
    expect(weekStripOffsetFor('', SAT)).toBe(0);
    expect(weekStripOffsetFor('2026-11-01', SAT)).toBe(0);
    expect(weekStripOffsetFor('2026-11-13', SAT)).toBe(0);
    expect(weekStripOffsetFor('2026-11-14', SAT)).toBe(1);
    expect(weekStripOffsetFor('2026-12-01', SAT)).toBe(3);
  });
  it('names the month', () => {
    expect(weekStripMonth(weekStrip('2026-11-28'))).toBe('December');
  });
});

describe('row values', () => {
  it('says the due date in words', () => {
    expect(dueValueLabel('', SAT)).toBe('No date');
    expect(dueValueLabel(SAT, SAT)).toBe('Today');
    expect(dueValueLabel('2026-11-08', SAT)).toBe('Tomorrow');
  });
  it('says the time in words', () => {
    expect(timeValueLabel('')).toBe('Any time');
    expect(timeValueLabel('18:00:00')).toBe('6:00 PM');
    expect(TIME_QUICK_CHOICES.map(timeChoiceLabel)).toEqual(['Any time', 'Morning 9:00', 'Lunch 12:30', 'Evening 6:00']);
  });
  it('names where an add went', () => {
    expect(addedToLabel(null, SAT)).toBe('Added');
    expect(addedToLabel(SAT, SAT)).toBe('Added to Today');
    expect(addedToLabel('2026-11-08', SAT)).toBe('Added to Tomorrow');
    expect(addedToLabel('2026-11-10', SAT)).toBe('Added for Tue');
  });
  it('shortens a name', () => {
    expect(personFirstName('Guy Banda')).toBe('Guy');
    expect(personFirstName('sam@example.com')).toBe('sam');
  });
  it('makes an initial', () => {
    expect(personInitial(' sam ')).toBe('S');
    expect(personInitial(null)).toBe('?');
  });
});

describe('title check and drafts', () => {
  it('only complains after an attempt', () => {
    expect(itemTitleError('', false)).toBeNull();
    expect(itemTitleError('  ', true)).toBe('Give it a name first');
    expect(itemTitleError('Bins', true)).toBeNull();
  });
  it('keeps a draft until cleared', () => {
    itemSheetDrafts.set('todo', { title: 'Gate' });
    expect(itemSheetDrafts.get<{ title: string }>('todo')?.title).toBe('Gate');
    itemSheetDrafts.clear('todo');
    expect(itemSheetDrafts.get('todo')).toBeUndefined();
  });
});

describe('matchTitleWords', () => {
  // Wednesday 2026-11-04.
  const today = '2026-11-04';
  const people = [
    { id: 'u1', name: 'Sam' },
    { id: 'u2', name: 'Guy' },
  ];
  const due = (title: string) => matchTitleWords(title, { today, people }).find((m) => m.kind === 'due')?.value;

  it('finds a date word where it sits, while it is typed', () => {
    const [m] = matchTitleWords('Cancel Uber One tomorrow', { today });
    expect(m).toEqual({ kind: 'due', raw: 'tomorrow', value: '2026-11-05', start: 16, end: 24 });
    expect(stripTitleWords('Cancel Uber One tomorrow', [m])).toBe('Cancel Uber One');
  });

  it('reads month names, days of the month and years', () => {
    expect(due('Take out trash oct 8')).toBe('2027-10-08');
    expect(due('Take out trash Dec 3rd')).toBe('2026-12-03');
    expect(due('Rego 8 March')).toBe('2027-03-08');
    expect(due('Rego on the 8th of March 2028')).toBe('2028-03-08');
    expect(due('Passport December 1, 2027')).toBe('2027-12-01');
    expect(due('Taxes in July')).toBe('2027-07-01');
    expect(due('Trip March 2027')).toBe('2027-03-01');
    expect(due('Pay rent the 15th')).toBe('2026-11-15');
    expect(due('Pay rent on the 2nd')).toBe('2026-12-02');
    expect(due('Due 2027-01-31')).toBe('2027-01-31');
    expect(due('I may go')).toBeUndefined();
    expect(due('Feb 30')).toBeUndefined();
  });

  it('reads spans of time', () => {
    expect(due('Check in 3 days')).toBe('2026-11-07');
    expect(due('Check in two weeks')).toBe('2026-11-18');
    expect(due('Renew in a month')).toBe('2026-12-04');
    expect(due('Renew in 1 year')).toBe('2027-11-04');
    expect(due('Review next month')).toBe('2026-12-04');
    expect(due('Plan next year')).toBe('2027-11-04');
    expect(due('Call the day after tomorrow')).toBe('2026-11-06');
  });

  it('reads day names, short ones only with on, this or next', () => {
    expect(due('Bins friday')).toBe('2026-11-06');
    expect(due('Bins next Wed')).toBe('2026-11-11');
    expect(due('Buy sun cream')).toBeUndefined();
    expect(due('Monitor stand')).toBeUndefined();
  });

  it('reads times, tonight and people', () => {
    const title = 'Call mum tomorrow at 5:30pm @sam';
    const r = matchTitleWords(title, { today, people });
    expect(r.map((m) => [m.kind, m.raw, m.value])).toEqual([
      ['due', 'tomorrow', '2026-11-05'],
      ['time', 'at 5:30pm', '17:30'],
      ['who', '@sam', 'u1'],
    ]);
    expect(stripTitleWords(title, r)).toBe('Call mum');
    expect(matchTitleWords('Pizza tonight', { today }).map((m) => m.value)).toEqual(['2026-11-04', '18:00']);
    expect(matchTitleWords('Lunch at noon', { today })[0].value).toBe('12:00');
    expect(matchTitleWords('Ask @nobody', { today, people })).toEqual([]);
  });

  it('leaves words someone kept as text', () => {
    expect(matchTitleWords('Watch Tomorrowland tomorrow', { today, ignore: ['tomorrow'] })).toEqual([]);
  });

  it('labels a match', () => {
    const m = { start: 0, end: 0 };
    expect(titleMatchLabel({ ...m, kind: 'due', raw: 'tomorrow', value: '2026-11-05' }, today)).toBe('Tomorrow');
    expect(titleMatchLabel({ ...m, kind: 'time', raw: '5pm', value: '17:00' }, today)).toBe('5:00 PM');
    expect(titleMatchLabel({ ...m, kind: 'who', raw: '@sam', value: 'u1' }, today, people)).toBe('Sam');
  });
});
