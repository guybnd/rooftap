import { describe, expect, it } from 'vitest';
import { calendarSpanDays, calendarSpanLabel, calendarSpanLede, monthGridDays, shiftCalendarDate } from './calendar-span';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const key = (x: Date) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;

describe('calendar span', () => {
  it('lists the days a span covers', () => {
    expect(calendarSpanDays('day', d(2026, 10, 19)).map(key)).toEqual(['2026-10-19']);
    expect(calendarSpanDays('week', d(2026, 10, 19)).map(key)).toEqual([
      '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24',
    ]);
    expect(calendarSpanDays('month', d(2026, 2, 10))).toHaveLength(28);
  });

  it('builds a 6-week month grid from the Sunday before the 1st', () => {
    const grid = monthGridDays(d(2026, 10, 19));
    expect(grid).toHaveLength(42);
    expect(key(grid[0])).toBe('2026-9-27');
    expect(key(grid[41])).toBe('2026-11-7');
  });

  it('steps by a day, a week or a month, clamping the day to the month', () => {
    expect(key(shiftCalendarDate('day', d(2026, 10, 31), 1))).toBe('2026-11-1');
    expect(key(shiftCalendarDate('week', d(2026, 10, 19), -1))).toBe('2026-10-12');
    expect(key(shiftCalendarDate('month', d(2026, 1, 31), 1))).toBe('2026-2-28');
    expect(key(shiftCalendarDate('month', d(2026, 1, 15), -1))).toBe('2025-12-15');
  });

  it('labels each span', () => {
    expect(calendarSpanLabel('day', d(2026, 10, 19))).toBe('Mon 19 Oct');
    expect(calendarSpanLabel('week', d(2026, 10, 19))).toBe('18 to 24 Oct');
    expect(calendarSpanLabel('week', d(2026, 10, 1))).toBe('27 Sep to 3 Oct');
    expect(calendarSpanLabel('month', d(2026, 10, 19))).toBe('October 2026');
  });

  it('words the lede relative to today', () => {
    const today = d(2026, 10, 19);
    expect(calendarSpanLede('week', d(2026, 10, 24), today)).toBe('this week');
    expect(calendarSpanLede('week', d(2026, 10, 26), today)).toBe('next week');
    expect(calendarSpanLede('week', d(2026, 11, 9), today)).toBe('in 8 to 14 Nov');
    expect(calendarSpanLede('month', d(2026, 11, 1), today)).toBe('in November');
    expect(calendarSpanLede('month', d(2027, 1, 1), today)).toBe('in January 2027');
  });
});
