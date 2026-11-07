import { describe, expect, it } from 'vitest';
import {
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
