// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_MANIFESTS } from '../module-manifests';
import { MODULE_FEATURES } from '../module-features';
import { resetModulesStore, setModuleRows } from '../modules-store';
import { ALL_MODULE_IDS, type GroupModuleRow } from '../modules';
import { buildOccasion } from '../modules/occasions/occasions';
import { occasionsCalendarEntries } from '../modules/occasions/calendar-source';
import { binLidsOf, binsCalendarEntries } from '../modules/bins/calendar-source';
import type { BinLid, BinStream } from '../modules/bins/bins';
import { CALENDAR_SOURCES, calendarEntriesOn, calendarRangeOf, useCalendarEntries } from './calendar';
import type { CalendarEntry, CalendarSource } from './types';

const RANGE = { from: '2026-10-25', to: '2026-10-31' };

function rows(off: string[]): GroupModuleRow[] {
  return ALL_MODULE_IDS.map((module_id) => ({ module_id, enabled: !off.includes(module_id) }) as GroupModuleRow);
}

/** A fake source: one all-day entry per module, and the group id it was handed. */
function fakeSource(moduleId: string, feature: CalendarSource['feature'], seen: (string | undefined)[]): CalendarSource {
  return {
    moduleId,
    feature,
    useEntries({ groupId, range }) {
      seen.push(groupId);
      return [{ key: `${moduleId}-1`, moduleId, date: range.from, time: null, title: moduleId, href: `/${moduleId}` }];
    },
  };
}

afterEach(() => resetModulesStore());

describe('calendar slot registry', () => {
  it('has one source for each module whose manifest lists the calendar slot, and nothing else', () => {
    const declared = ALL_MANIFESTS.filter((m) => m.slots?.includes('calendar')).map((m) => m.id).sort();
    expect(CALENDAR_SOURCES.map((s) => s.moduleId).sort()).toEqual(declared);
  });

  it('gates every source on a feature that needs the calendar and the module itself', () => {
    for (const source of CALENDAR_SOURCES) {
      const needs: readonly string[] = MODULE_FEATURES[source.feature].modules;
      expect(needs).toContain('calendar');
      expect(needs).toContain(source.moduleId);
    }
  });
});

describe('useCalendarEntries', () => {
  const sources = (seen: (string | undefined)[]) => [
    fakeSource('bins', 'calendar.bins', seen),
    fakeSource('occasions', 'calendar.occasions', seen),
  ];

  it('merges every source in registry order while all are on', () => {
    setModuleRows(rows([]));
    const seen: (string | undefined)[] = [];
    const { result } = renderHook(() => useCalendarEntries('g', 'me', RANGE, sources(seen)));
    expect(result.current.map((e) => e.key)).toEqual(['bins-1', 'occasions-1']);
    expect(seen).toEqual(['g', 'g']);
  });

  // The on/off check: switch each module off, its entries vanish and nothing else changes.
  it.each(['bins', 'occasions'])('drops %s and opens its stores inert when it is off', (off) => {
    setModuleRows(rows([off]));
    const seen: (string | undefined)[] = [];
    const { result } = renderHook(() => useCalendarEntries('g', 'me', RANGE, sources(seen)));
    const other = off === 'bins' ? 'occasions' : 'bins';
    expect(result.current.map((e) => e.moduleId)).toEqual([other]);
    expect(seen).toEqual(off === 'bins' ? [undefined, 'g'] : ['g', undefined]);
  });

  it('drops every source with the calendar off', () => {
    setModuleRows(rows(['calendar']));
    const { result } = renderHook(() => useCalendarEntries('g', 'me', RANGE, sources([])));
    expect(result.current).toEqual([]);
  });
});

describe('calendar slot helpers', () => {
  it('covers the days on view', () => {
    expect(calendarRangeOf([new Date(2026, 9, 31), new Date(2026, 9, 25), new Date(2026, 9, 28)])).toEqual(RANGE);
  });

  it('picks one day', () => {
    const e = (key: string, date: string): CalendarEntry => ({ key, moduleId: 'bins', date, time: null, title: key, href: '/bins' });
    expect(calendarEntriesOn([e('a', '2026-10-25'), e('b', '2026-10-26')], '2026-10-26').map((x) => x.key)).toEqual(['b']);
  });
});

describe('bins calendar source', () => {
  const stream = (id: string, name: string, lid: BinLid): BinStream => ({
    id,
    name,
    lid,
    group_id: 'g',
    weekday: 3,
    every_weeks: 1,
    anchor_date: '2026-10-28',
    sort_order: 0,
    created_by: null,
    created_at: '',
    updated_at: '',
    deleted: false,
  });

  it('turns each collection day into an all-day entry with its lids', () => {
    const entries = binsCalendarEntries([stream('r', 'Rubbish', 'red'), stream('y', 'Recycling', 'yellow')], [], RANGE);
    expect(entries).toEqual([
      expect.objectContaining({
        key: 'bins-2026-10-28',
        date: '2026-10-28',
        time: null,
        title: 'Bin collection',
        subtitle: 'Recycling and rubbish',
        chipTitle: 'Bins: recycling and rubbish',
        href: '/bins',
      }),
    ]);
    expect(binLidsOf(entries[0])).toEqual(['yellow', 'red']);
  });

  it('has nothing without bins', () => {
    expect(binsCalendarEntries([], [], RANGE)).toEqual([]);
  });
});

describe('occasions calendar source', () => {
  const base = buildOccasion({ id: 'o', groupId: 'g', title: '', kind: 'birthday', date: '1990-10-27', createdBy: null });

  it('places yearly days in range, titled for the viewer, and skips ones kept off the calendar', () => {
    const entries = occasionsCalendarEntries(
      [
        { ...base, id: 'mine', title: "Guy's birthday", person_id: 'me' },
        { ...base, id: 'tegan', title: "Tegan's birthday", date: '1992-10-30' },
        { ...base, id: 'off', title: 'Hidden', on_calendar: false },
        { ...base, id: 'later', title: 'Later', date: '1990-11-02' },
      ],
      'me',
      RANGE,
    );
    expect(entries.map((e) => [e.date, e.title, e.subtitle, e.time])).toEqual([
      ['2026-10-27', 'Your birthday', 'Birthday', null],
      ['2026-10-30', "Tegan's birthday", 'Birthday', null],
    ]);
  });
});
