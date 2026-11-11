// Every phone tab screen, rendered for real on react-native-web with odd data:
// no rows, one row, a row with every nullable column null, a row from a server
// that predates those columns, people who have left the household, and a very
// long title. The rows go through the real stores and core hooks
// (render-screen.tsx), so a screen that trips on a null or a missing field
// fails here instead of on a phone.
import * as React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Tables } from './fake-supabase';
import { renderScreen } from './render-screen';
import { ME, OTHER } from './screen-state';
import { nullRow, oldServerRow, row } from './rows';

// Tuesday 10 Nov 2026, mid-morning: "today" for every screen.
const TODAY = '2026-11-10';
const NOW = new Date(`${TODAY}T10:00:00`);
const GONE = 'user-who-left';
const LONG = 'A very long title that keeps going '.repeat(9).trim();

const EVERY_MODULE = [
  'household', 'calendar', 'checklists', 'documents', 'groceries', 'recipes', 'meals', 'costs', 'setup',
  'search', 'shopper', 'rewards', 'occasions', 'bins', 'home-care', 'money-insights', 'assistant',
];

interface ScreenCase {
  /** Folder under src/app/(tabs). */
  screen: string;
  load: () => Promise<{ default: React.ComponentType }>;
  /** The table whose rows the screen lists, and a realistic row for it. */
  table: string;
  base: Record<string, unknown>;
  /** The column the row's name is shown from. */
  label: string;
  /** Rows other tables need for the main row to show (an appointment's apartment). */
  extra?: Tables;
  /** What the screen shows for the row, when it isn't the label (a cost folds into its category). */
  shows?: string;
}

const apartment = row('apartments', { id: 'apt-1', address: '12 Rose St', user_id: ME, suburb: 'Newtown' });

const CASES: ScreenCase[] = [
  {
    screen: 'tasks',
    load: () => import('../app/(tabs)/tasks/index'),
    table: 'household_tasks',
    base: { title: 'Mow the lawn', due_date: TODAY, assigned_to: ME, assignees: [ME, OTHER] },
    label: 'title',
  },
  {
    screen: 'groceries',
    load: () => import('../app/(tabs)/groceries/index'),
    table: 'grocery_items',
    base: { name: 'Oat milk', status: 'needed', aisle: 'Dairy', quantity: 2, unit: 'L' },
    label: 'name',
  },
  {
    screen: 'calendar',
    load: () => import('../app/(tabs)/calendar/index'),
    table: 'events',
    base: {
      title: 'Dentist',
      category: 'appointment',
      starts_at: `${TODAY}T14:00:00`,
      ends_at: `${TODAY}T15:00:00`,
      assigned_to: ME,
      assignees: [ME, OTHER],
      created_by: ME,
    },
    label: 'title',
  },
  {
    screen: 'costs',
    load: () => import('../app/(tabs)/costs/index'),
    table: 'cost_items',
    base: { name: 'Electricity', amount: 12000, cadence: 'monthly', category: 'utilities', created_by: ME, start_date: '2026-01-01', price_changes: [] },
    label: 'name',
    // Costs fold into their category until it is opened.
    shows: 'Utilities',
  },
  {
    screen: 'documents',
    load: () => import('../app/(tabs)/documents/index'),
    table: 'documents',
    base: { title: 'Lease agreement', filename: 'lease.pdf', doc_type: 'lease', source: 'upload', storage_path: 'g/lease.pdf', uploaded_by: ME, mime_type: 'application/pdf' },
    label: 'title',
  },
  {
    screen: 'recipes',
    load: () => import('../app/(tabs)/recipes/index'),
    table: 'recipes',
    base: { title: 'Pumpkin soup', servings: 4, created_by: ME },
    label: 'title',
  },
  {
    screen: 'checklists',
    load: () => import('../app/(tabs)/checklists/index'),
    table: 'checklists',
    base: { title: 'Packing for the coast', type: 'packing', created_by: ME },
    label: 'title',
  },
  {
    screen: 'occasions',
    load: () => import('../app/(tabs)/occasions/index'),
    table: 'occasions',
    base: { title: 'Alex’s birthday', kind: 'birthday', date: '2026-12-03', person_id: OTHER, repeats: true, created_by: ME },
    label: 'title',
  },
  {
    screen: 'rewards',
    load: () => import('../app/(tabs)/rewards/index'),
    table: 'loyalty_cards',
    base: { name: 'Corner bakery', number: '1234 5678', format: 'code128', created_by: ME },
    label: 'name',
  },
  {
    screen: 'setup',
    load: () => import('../app/(tabs)/setup/index'),
    table: 'setup_items',
    base: { name: 'Curtains', status: 'needed', priority: 'high', room: 'Bedroom', created_by: ME, assigned_to: ME },
    label: 'name',
  },
  {
    screen: 'shopper',
    load: () => import('../app/(tabs)/shopper/index'),
    table: 'shopper_wants',
    base: { title: 'Stand mixer', status: 'watching', target_cents: 30000, created_by: ME },
    label: 'title',
  },
  {
    screen: 'homesearch',
    load: () => import('../app/(tabs)/homesearch/index'),
    table: 'apartments',
    base: { address: '12 Rose St', suburb: 'Newtown', user_id: ME, rent_per_week: 650 },
    label: 'address',
  },
  {
    screen: 'appointments',
    load: () => import('../app/(tabs)/appointments/index'),
    table: 'appointments',
    base: { apartment_id: 'apt-1', scheduled_at: `${TODAY}T16:00:00`, status: 'scheduled', user_id: ME },
    label: 'apartment_id',
    extra: { apartments: [apartment] },
    shows: '12 Rose St',
  },
  {
    screen: 'bins',
    load: () => import('../app/(tabs)/bins/index'),
    table: 'bin_streams',
    base: { name: 'Recycling', lid: 'yellow', weekday: 3, every_weeks: 2, anchor_date: '2026-11-04', created_by: ME },
    label: 'name',
  },
];

/** What a row shows as its name on screen. */
function shown(c: ScreenCase, r: Record<string, unknown>): string {
  return c.shows ?? String(r[c.label]);
}

/** Every person column on a row, pointed at someone who has left the household. */
function withGonePeople(table: string, r: Record<string, unknown>): Record<string, unknown> {
  const out = { ...r };
  for (const key of ['assigned_to', 'created_by', 'uploaded_by', 'user_id', 'person_id', 'completed_by', 'updated_by']) {
    if (key in out) out[key] = GONE;
  }
  if ('assignees' in out) out.assignees = [GONE, OTHER];
  // A row the household can't see would be filtered; this one is shared.
  if ('private' in out) out.private = false;
  void table;
  return out;
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterAll(() => {
  vi.useRealTimers();
});

async function expectRenders(c: ScreenCase, rows: Record<string, unknown>[], expectText?: string) {
  const { default: Screen } = await c.load();
  const tables: Tables = { ...c.extra, [c.table]: rows };
  const r = await renderScreen(Screen, { tables, modules: EVERY_MODULE });
  expect(r.errors).toEqual([]);
  expect(r.text().length).toBeGreaterThan(0);
  if (expectText) expect(r.text()).toContain(expectText);
  r.unmount();
}

describe.each(CASES)('$screen screen', (c) => {
  it('renders with no rows', async () => {
    await expectRenders(c, []);
  });

  it('shows one row', async () => {
    const r = row(c.table, c.base);
    await expectRenders(c, [r], shown(c, r));
  });

  it('shows a row with every nullable column null', async () => {
    const r = nullRow(c.table, c.base);
    await expectRenders(c, [r], shown(c, r));
  });

  it('shows a row from a server that predates the newer columns', async () => {
    const r = oldServerRow(c.table, c.base);
    await expectRenders(c, [r], shown(c, r));
  });

  it('shows a row whose people have left the household', async () => {
    const r = withGonePeople(c.table, row(c.table, c.base));
    await expectRenders(c, [r], shown(c, r));
  });

  it('shows a row with a very long name', async () => {
    const r = row(c.table, { ...c.base, ...(c.shows ? {} : { [c.label]: LONG }) });
    await expectRenders(c, [r], shown(c, r));
  });
});

describe('screens with no list of their own', () => {
  it.each([
    ['home', () => import('../app/(tabs)/home/index')],
    ['assistant', () => import('../app/(tabs)/assistant/index')],
  ] as const)('%s renders with nothing in the household', async (_name, load) => {
    const { default: Screen } = await load();
    const r = await renderScreen(Screen, { modules: EVERY_MODULE });
    expect(r.errors).toEqual([]);
    expect(r.text().length).toBeGreaterThan(0);
    r.unmount();
  });

  it('home shows today’s task, event and groceries, odd rows included', async () => {
    const { default: Screen } = await import('../app/(tabs)/home/index');
    const r = await renderScreen(Screen, {
      modules: EVERY_MODULE,
      tables: {
        household_tasks: [
          row('household_tasks', { title: 'Mow the lawn', due_date: TODAY, assigned_to: ME, assignees: [ME, OTHER] }),
          nullRow('household_tasks', { title: 'Call the plumber', due_date: TODAY }),
          withGonePeople('household_tasks', row('household_tasks', { title: 'Fix the gate', due_date: TODAY })),
        ],
        events: [
          row('events', { title: 'Dentist', category: 'appointment', starts_at: `${TODAY}T14:00:00`, created_by: ME }),
          oldServerRow('events', { title: 'School pickup', category: 'other', starts_at: `${TODAY}T15:00:00`, created_by: GONE }),
        ],
        grocery_items: [row('grocery_items', { name: 'Oat milk', status: 'needed', aisle: 'Dairy' }), nullRow('grocery_items', { name: 'Bread', status: 'needed', aisle: 'Bakery' })],
      },
    });
    expect(r.errors).toEqual([]);
    const text = r.text();
    expect(text).toContain('Mow the lawn');
    expect(text).toContain('Dentist');
    r.unmount();
  });
});
