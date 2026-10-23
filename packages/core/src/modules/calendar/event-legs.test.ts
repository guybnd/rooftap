import { describe, expect, it } from 'vitest';
import { eventTravelLegs, legText } from './event-legs';
import type { GroupEvent } from '../../types';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
const ev = (id: string, starts_at: string, extra: Partial<GroupEvent> = {}) =>
  ({ id, starts_at, ends_at: null, is_all_day: false, deleted: false, location: `${id} place`, travel_mode: null, ...extra }) as GroupEvent;

describe('eventTravelLegs', () => {
  it('links same-day events with places, by the second one’s mode', () => {
    const legs = eventTravelLegs([
      ev('b', at(7, 12), { travel_mode: 'walk' }),
      ev('a', at(7, 10), { ends_at: at(7, 11, 30) }),
    ]);
    expect(legs).toEqual([{ fromId: 'a', toId: 'b', from: 'a place', to: 'b place', mode: 'walk', gapMinutes: 30 }]);
  });
  it('skips all-day events, events without a place and the same place twice', () => {
    expect(
      eventTravelLegs([
        ev('a', at(7, 9), { location: 'MCG' }),
        ev('b', at(7, 10), { location: ' mcg ' }),
        ev('c', at(7, 11), { location: null }),
        ev('d', at(7, 0), { is_all_day: true }),
      ])
    ).toEqual([]);
  });
  it('crosses midnight only within a few hours', () => {
    expect(eventTravelLegs([ev('a', at(7, 22)), ev('b', at(8, 1))])).toHaveLength(1);
    expect(eventTravelLegs([ev('a', at(7, 18)), ev('b', at(8, 9))])).toHaveLength(0);
  });
  it('counts an overlap as no gap', () => {
    expect(eventTravelLegs([ev('a', at(7, 10), { ends_at: at(7, 13) }), ev('b', at(7, 12))])[0].gapMinutes).toBe(0);
  });
});

describe('legText', () => {
  const leg = { fromId: 'a', toId: 'b', from: 'x', to: 'y', mode: 'drive' as const, gapMinutes: 30 };
  it('says the trip, and warns when it does not fit', () => {
    expect(legText(leg, 20)).toEqual({ text: '20 min by car to get there', tight: false });
    expect(legText(leg, 45)).toEqual({ text: '45 min by car, only 30 min between', tight: true });
    expect(legText({ ...leg, gapMinutes: 0 }, 10)).toEqual({ text: '10 min by car, and they overlap', tight: true });
  });
});
