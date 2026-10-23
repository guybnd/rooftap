import { describe, expect, it } from 'vitest';
import {
  binCadenceLabel,
  binChangeLabel,
  binCollections,
  binDraftWeekOffset,
  binDraftsFrom,
  binNamesPhrase,
  binNightHeroItem,
  binNightState,
  binNightDue,
  binTurn,
  guessBinLid,
  inferBinSetup,
  nextWeekdayISO,
  normalizeParsedBins,
  streamCollectsOn,
  weekdayOfISO,
  type BinChange,
  type BinPlan,
  type BinStream,
} from './bins';
import { addDaysISO } from '../../date-utils';
// notify-bin-night's Deno twin of these rules (pure, import-free).
import * as twin from '../../../../../supabase/functions/_shared/bin-schedule';

// 2026-10-28 is a Wednesday.
const WED = '2026-10-28';

function stream(over: Partial<BinStream> & Pick<BinStream, 'id' | 'name'>): BinStream {
  return {
    group_id: 'g',
    lid: 'red',
    weekday: 3,
    every_weeks: 1,
    anchor_date: WED,
    sort_order: 0,
    created_by: null,
    created_at: '',
    updated_at: '',
    deleted: false,
    ...over,
  };
}

function change(over: Partial<BinChange> & Pick<BinChange, 'id' | 'on_date'>): BinChange {
  return {
    group_id: 'g',
    stream_id: null,
    moved_to: null,
    note: null,
    source: 'manual',
    created_by: null,
    created_at: '',
    updated_at: '',
    deleted: false,
    ...over,
  };
}

function plan(over: Partial<BinPlan> = {}): BinPlan {
  return {
    id: 'p',
    group_id: 'g',
    remind_at: '19:00',
    push_at: '21:00',
    rotation: [],
    rotation_anchor: null,
    out_for: null,
    out_by: null,
    timezone: null,
    setup_source: 'manual',
    created_by: null,
    created_at: '',
    updated_at: '',
    deleted: false,
    ...over,
  };
}

const red = stream({ id: 'red', name: 'Red', lid: 'red', sort_order: 0 });
const yellow = stream({ id: 'yellow', name: 'Yellow', lid: 'yellow', every_weeks: 2, sort_order: 1 });
const green = stream({ id: 'green', name: 'Green', lid: 'green', every_weeks: 2, anchor_date: addDaysISO(WED, 7), sort_order: 2 });

describe('bin schedule', () => {
  it('knows weekdays without a time zone', () => {
    expect(weekdayOfISO(WED)).toBe(3);
    expect(weekdayOfISO('2026-11-01')).toBe(0);
    expect(nextWeekdayISO('2026-10-26', 3)).toBe(WED);
    expect(nextWeekdayISO(WED, 3)).toBe(WED);
    expect(nextWeekdayISO(WED, 3, 1)).toBe('2026-11-04');
  });

  it('collects weekly and fortnightly streams on their weeks', () => {
    expect(streamCollectsOn(red, WED)).toBe(true);
    expect(streamCollectsOn(red, addDaysISO(WED, 1))).toBe(false);
    expect(streamCollectsOn(yellow, WED)).toBe(true);
    expect(streamCollectsOn(yellow, addDaysISO(WED, 7))).toBe(false);
    expect(streamCollectsOn(yellow, addDaysISO(WED, -14))).toBe(true);
    expect(streamCollectsOn(green, addDaysISO(WED, 7))).toBe(true);
  });

  it('lists collection days with yellow and green taking turns', () => {
    const days = binCollections([red, yellow, green], [], WED, addDaysISO(WED, 14));
    expect(days.map((d) => [d.date, d.streams.map((s) => s.id)])).toEqual([
      [WED, ['red', 'yellow']],
      ['2026-11-04', ['red', 'green']],
      ['2026-11-11', ['red', 'yellow']],
    ]);
  });

  it('moves, skips and adds collections from changes', () => {
    const changes = [
      // Christmas week: everything moves from Wednesday to Saturday.
      change({ id: 'c1', on_date: WED, moved_to: '2026-10-31', note: 'Public holiday' }),
      // Yellow skips on the 11th.
      change({ id: 'c2', stream_id: 'yellow', on_date: '2026-11-11', moved_to: null }),
      // An extra green pickup on a Friday.
      change({ id: 'c3', stream_id: 'green', on_date: '2026-11-13', moved_to: '2026-11-13' }),
    ];
    const days = binCollections([red, yellow, green], changes, WED, addDaysISO(WED, 16));
    expect(days.map((d) => [d.date, d.streams.map((s) => s.id)])).toEqual([
      ['2026-10-31', ['red', 'yellow']],
      ['2026-11-04', ['red', 'green']],
      ['2026-11-11', ['red']],
      ['2026-11-13', ['green']],
    ]);
    expect(days[0].moved).toEqual([
      { streamId: 'red', from: WED },
      { streamId: 'yellow', from: WED },
    ]);
    expect(days[0].notes).toEqual(['Public holiday']);
  });

  it('lets a change for one bin win over a change for every bin', () => {
    const changes = [
      change({ id: 'all', on_date: WED, moved_to: '2026-10-29' }),
      change({ id: 'yellow', stream_id: 'yellow', on_date: WED, moved_to: null }),
    ];
    const days = binCollections([red, yellow], changes, WED, addDaysISO(WED, 3));
    expect(days.map((d) => [d.date, d.streams.map((s) => s.id)])).toEqual([['2026-10-29', ['red']]]);
  });

  it('ignores deleted streams and changes', () => {
    const days = binCollections(
      [red, { ...yellow, deleted: true }],
      [change({ id: 'x', on_date: WED, moved_to: null, deleted: true })],
      WED,
      WED,
    );
    expect(days.map((d) => d.streams.map((s) => s.id))).toEqual([['red']]);
  });
});

describe('bin night', () => {
  const tuesday = addDaysISO(WED, -1);

  it('is tonight the day before a collection', () => {
    const state = binNightState([red, yellow], [], plan(), tuesday);
    expect(state.collection?.date).toBe(WED);
    expect(state.nightOf).toBe(tuesday);
    expect(state.tonight).toBe(true);
    expect(state.out).toBe(false);
    expect(binNightState([red], [], plan(), addDaysISO(WED, -3)).tonight).toBe(false);
  });

  it('counts the bins as out only for that collection', () => {
    expect(binNightState([red], [], plan({ out_for: WED }), tuesday).out).toBe(true);
    expect(binNightState([red], [], plan({ out_for: addDaysISO(WED, -7) }), tuesday).out).toBe(false);
  });

  it('shows the Home card from the reminder time until the bins are out', () => {
    const state = binNightState([red], [], plan(), tuesday);
    expect(binNightDue(state, plan(), '18:59')).toBe(false);
    expect(binNightDue(state, plan(), '19:00')).toBe(true);
    expect(binNightDue(state, plan({ remind_at: '17:30' }), '18:00')).toBe(true);
    expect(binNightDue(binNightState([red], [], plan({ out_for: WED }), tuesday), plan(), '20:00')).toBe(false);
  });

  it('builds one feed item on bin night, done once out', () => {
    const p = plan({ rotation: ['guy', 'tegan'], rotation_anchor: tuesday });
    const item = binNightHeroItem(binNightState([red, yellow], [], p, tuesday), p, tuesday);
    expect(item).toMatchObject({
      type: 'bins',
      title: 'Bins out tonight',
      dueDate: tuesday,
      dueTime: '19:00',
      done: false,
      assignedTo: 'guy',
      sourceLabel: 'Red and yellow',
      binNight: { collectionDate: WED, lids: ['red', 'yellow'] },
    });
    const out = plan({ out_for: WED });
    expect(binNightHeroItem(binNightState([red], [], out, tuesday), out, tuesday)?.done).toBe(true);
    expect(binNightHeroItem(binNightState([red], [], plan(), WED), plan(), WED)).toBeNull();
  });

  it('takes turns a week each', () => {
    const p = { rotation: ['guy', 'tegan'], rotation_anchor: WED };
    expect(binTurn(p, WED)).toBe('guy');
    expect(binTurn(p, addDaysISO(WED, 7))).toBe('tegan');
    expect(binTurn(p, addDaysISO(WED, 14))).toBe('guy');
    expect(binTurn(p, addDaysISO(WED, -7))).toBe('tegan');
    expect(binTurn({ rotation: [], rotation_anchor: null }, WED)).toBeNull();
    expect(binTurn({ rotation: ['solo'], rotation_anchor: null }, WED)).toBe('solo');
  });
});

describe('bin copy', () => {
  it('names the bins and the cadence', () => {
    expect(binNamesPhrase([red, yellow])).toBe('Red and yellow');
    expect(binNamesPhrase([red, yellow, green])).toBe('Red, yellow and green');
    expect(binNamesPhrase([{ name: 'recycling' }])).toBe('Recycling');
    expect(binCadenceLabel(red)).toBe('Every Wednesday');
    expect(binCadenceLabel(yellow)).toBe('Every second Wednesday');
    expect(binCadenceLabel({ weekday: 1, every_weeks: 4 })).toBe('Every 4 weeks on Monday');
    expect(binChangeLabel({ on_date: WED, moved_to: null })).toBe('No collection');
    expect(binChangeLabel({ on_date: WED, moved_to: WED })).toBe('Extra collection');
    expect(binChangeLabel({ on_date: WED, moved_to: '2026-10-31' })).toMatch(/^Moves to Sat/);
  });

  it('guesses lid colours from names', () => {
    expect(guessBinLid('Recycling')).toBe('yellow');
    expect(guessBinLid('Garden organics')).toBe('green');
    expect(guessBinLid('General waste')).toBe('red');
    expect(guessBinLid('Glass')).toBe('purple');
    expect(guessBinLid('Blue paper bin')).toBe('blue');
    expect(guessBinLid('Hard rubbish')).toBe('red');
    expect(guessBinLid('Mystery')).toBe('other');
  });
});

describe('bin setup', () => {
  it('reads an AI answer into drafts, dropping what makes no sense', () => {
    const parsed = normalizeParsedBins(
      {
        streams: [
          { name: 'General waste', lid: 'red', weekday: 'Wednesday', every_weeks: 1, next_date: '2026-10-28' },
          { name: 'Recycling', lid: null, weekday: 3, every_weeks: 2, next_date: '2026-11-04' },
          { name: 'Garden', lid: 'green', weekday: null, every_weeks: 2, next_date: '2026-10-28' },
          { name: '', weekday: 2 },
          { name: 'Nonsense', weekday: 'Funday' },
        ],
        changes: [
          { bin: null, date: '2026-12-23', moved_to: '2026-12-27', note: 'Christmas' },
          { bin: 'Recycling', date: '2026-12-30', moved_to: null, note: null },
          { bin: 'Yellow', date: '2027-01-06', moved_to: 'soon' },
          { bin: 'all bins', date: '2020-01-01', moved_to: null },
        ],
      },
      '2026-10-26',
    );
    expect(parsed.streams.map((s) => [s.name, s.lid, s.weekday, s.every_weeks, s.anchor_date])).toEqual([
      ['General waste', 'red', 3, 1, '2026-10-28'],
      ['Recycling', 'yellow', 3, 2, '2026-11-04'],
      ['Garden', 'green', 3, 2, '2026-10-28'],
    ]);
    expect(parsed.changes.map((c) => [c.streamKey, c.on_date, c.moved_to, c.note])).toEqual([
      [null, '2026-12-23', '2026-12-27', 'Christmas'],
      ['s1', '2026-12-30', null, null],
    ]);
  });

  it('moves an old next date forward to today', () => {
    const parsed = normalizeParsedBins({ streams: [{ name: 'Red', weekday: 3, every_weeks: 2, next_date: '2026-10-14' }] }, '2026-10-26');
    expect(parsed.streams[0].anchor_date).toBe('2026-10-28');
  });

  it('works a schedule out from Home Assistant dates', () => {
    const dates = (start: string, everyDays: number, n: number) => Array.from({ length: n }, (_, i) => addDaysISO(start, i * everyDays));
    const recycling = dates(WED, 14, 6).map((date) => ({ date, name: 'Recycling' }));
    // Christmas: the 23 Dec collection moves to Sat 27 Dec, and 30 Dec has none.
    const general = dates(WED, 7, 12)
      .filter((d) => d !== '2026-12-30')
      .map((date) => ({ date: date === '2026-12-23' ? '2026-12-27' : date, name: 'General waste' }));
    const setup = inferBinSetup([...general, ...recycling, { date: 'bad', name: 'x' }], '2026-10-26');
    expect(setup.streams.map((s) => [s.name, s.lid, s.weekday, s.every_weeks, s.anchor_date])).toEqual([
      ['General waste', 'red', 3, 1, WED],
      ['Recycling', 'yellow', 3, 2, WED],
    ]);
    expect(setup.changes.map((c) => [c.streamKey, c.on_date, c.moved_to])).toEqual([
      ['s0', '2026-12-23', '2026-12-27'],
      ['s0', '2026-12-30', null],
    ]);
  });

  it('edits saved streams from their next collection', () => {
    const drafts = binDraftsFrom([yellow, green, { ...red, deleted: true }], [change({ id: 'old', on_date: '2026-01-01' }), change({ id: 'c', on_date: '2026-12-23' })], '2026-11-02');
    expect(drafts.streams.map((s) => [s.id, s.anchor_date])).toEqual([
      ['yellow', '2026-11-11'],
      ['green', '2026-11-04'],
    ]);
    expect(drafts.changes.map((c) => c.id)).toEqual(['c']);
    expect(binDraftWeekOffset(drafts.streams[0], '2026-11-02')).toBe(1);
    expect(binDraftWeekOffset(drafts.streams[1], '2026-11-02')).toBe(0);
  });
});

describe('notify-bin-night twin', () => {
  // The edge function can't import core, so it carries a twin of the
  // schedule. Every day of a few schedules must agree.
  const schedules: { streams: BinStream[]; changes: BinChange[] }[] = [
    { streams: [red], changes: [] },
    { streams: [red, yellow, green], changes: [] },
    {
      streams: [red, yellow, green],
      changes: [
        change({ id: 'a', on_date: '2026-11-11', moved_to: '2026-11-14' }),
        change({ id: 'b', stream_id: 'yellow', on_date: '2026-11-11', moved_to: null }),
        change({ id: 'c', stream_id: 'green', on_date: '2026-11-20', moved_to: '2026-11-20' }),
        change({ id: 'd', stream_id: 'red', on_date: '2026-11-25', moved_to: '2026-11-24' }),
        change({ id: 'e', on_date: '2026-12-02', moved_to: null }),
      ],
    },
    {
      streams: [stream({ id: 'm', name: 'Monthly', weekday: 1, every_weeks: 4, anchor_date: '2026-11-02' }), stream({ id: 'f', name: 'Fri', weekday: 5, every_weeks: 3, anchor_date: '2026-10-30' })],
      changes: [change({ id: 'x', stream_id: 'm', on_date: '2026-11-30', moved_to: '2026-12-01' })],
    },
  ];

  it('agrees with core on every day', () => {
    for (const { streams, changes } of schedules) {
      const from = '2026-10-20';
      const to = '2027-01-31';
      const core = new Map(binCollections(streams, changes, from, to).map((d) => [d.date, d.streams.map((s) => s.id)]));
      for (let date = from; date <= to; date = addDaysISO(date, 1)) {
        expect(twin.binsCollectedOn(streams, changes, date).map((s) => s.id), date).toEqual(core.get(date) ?? []);
        expect(twin.addDaysISO(date, 1)).toBe(addDaysISO(date, 1));
      }
      expect(twin.binNamesPhrase([red, yellow, green])).toBe(binNamesPhrase([red, yellow, green]));
      const p = { rotation: ['a', 'b', 'c'], rotation_anchor: WED };
      for (let i = -30; i < 30; i++) {
        const date = addDaysISO(WED, i);
        expect(twin.binTurn(p.rotation, p.rotation_anchor, date)).toBe(binTurn(p, date));
      }
    }
  });

  it('reads the wall clock in a time zone', () => {
    expect(twin.localDateTime(new Date('2026-10-27T10:30:00Z'), 'Australia/Sydney')).toEqual({ date: '2026-10-27', time: '21:30' });
    expect(twin.localDateTime(new Date('2026-10-27T14:05:00Z'), 'Australia/Sydney')).toEqual({ date: '2026-10-28', time: '01:05' });
  });
});
