import { describe, expect, it } from 'vitest';
import {
  agendaFromEvents,
  buildMealPlanEntry,
  cookName,
  cleanMealDraft,
  draftableNights,
  formatMealMinutes,
  groceriesGoingOff,
  mealDraftPrompt,
  mealEntriesByDate,
  mealNightHint,
  mealWeekDates,
  mealWeekName,
  mealWeekRangeLabel,
  mealWeekStart,
  shadowedMealEntries,
  tonightLine,
  weekShopping,
  type MealPlanEntry,
} from './meal-plan';
import type { GroceryItem, Recipe, RecipeIngredient } from '../../types';

function recipe(id: string, title: string, minutes: [number | null, number | null] = [null, null]): Recipe {
  return {
    id,
    group_id: 'g',
    title,
    cuisines: [],
    method: null,
    instructions: null,
    servings: null,
    prep_minutes: minutes[0],
    cook_minutes: minutes[1],
    source: null,
    source_type: null,
    draft: false,
    created_by: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    deleted: false,
  };
}

function ing(recipeId: string, name: string, itemName: string | null = null): RecipeIngredient {
  return {
    id: `${recipeId}-${name}`,
    recipe_id: recipeId,
    group_id: 'g',
    name,
    item_name: itemName,
    quantity: null,
    unit: null,
    position: 0,
    created_at: '',
    updated_at: '',
    deleted: false,
  } as RecipeIngredient;
}

function grocery(name: string, status: GroceryItem['status'], extra: Partial<GroceryItem> = {}): GroceryItem {
  return { id: name, name, status, deleted: false, status_changed_at: null, shelf_life_days: null, expiry_date: null, ...extra } as GroceryItem;
}

function entry(date: string, fields: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return { ...buildMealPlanEntry({ groupId: 'g', date, createdBy: null }), updated_at: '2026-10-27T10:00:00Z', ...fields };
}

const curry = recipe('curry', 'Thai green curry', [10, 25]);
const pizza = recipe('pizza', 'Homemade pizza', [40, 30]);
const recipesById = new Map([curry, pizza].map((r) => [r.id, r]));

describe('the week', () => {
  it('starts on the Monday on or before a date', () => {
    expect(mealWeekStart('2026-10-27')).toBe('2026-10-26'); // Tuesday
    expect(mealWeekStart('2026-10-26')).toBe('2026-10-26'); // Monday
    expect(mealWeekStart('2026-11-01')).toBe('2026-10-26'); // Sunday
  });

  it('has seven nights and a readable range', () => {
    expect(mealWeekDates('2026-10-26')).toEqual([
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
    ]);
    expect(mealWeekRangeLabel('2026-10-26')).toBe('Mon 26 Oct to Sun 1 Nov');
  });

  it('names this, next and last week relative to today', () => {
    expect(mealWeekName('2026-10-26', '2026-10-29')).toBe('This week');
    expect(mealWeekName('2026-11-02', '2026-10-29')).toBe('Next week');
    expect(mealWeekName('2026-10-19', '2026-10-29')).toBe('Last week');
    expect(mealWeekName('2026-11-09', '2026-10-29')).toBe('Mon 9 Nov to Sun 15 Nov');
  });
});

describe('mealEntriesByDate', () => {
  it('keeps the newest live dinner row per night', () => {
    const old = entry('2026-10-27', { id: 'a', recipe_id: 'curry', updated_at: '2026-10-27T09:00:00Z' });
    const newer = entry('2026-10-27', { id: 'b', label: 'Out', updated_at: '2026-10-27T11:00:00Z' });
    const gone = entry('2026-10-27', { id: 'c', recipe_id: 'pizza', updated_at: '2026-10-27T12:00:00Z', deleted: true });
    const lunch = entry('2026-10-27', { id: 'd', slot: 'lunch', updated_at: '2026-10-27T13:00:00Z' });
    const byDate = mealEntriesByDate([old, newer, gone, lunch]);
    expect(byDate.get('2026-10-27')?.id).toBe('b');
    expect(shadowedMealEntries([old, newer, gone, lunch], '2026-10-27').map((e) => e.id)).toEqual(['a']);
  });

  it('drops a label when the night has a recipe', () => {
    const e = buildMealPlanEntry({ groupId: 'g', date: '2026-10-27', recipeId: 'curry', label: 'Out', createdBy: 'u' });
    expect(e.label).toBeNull();
    expect(e.slot).toBe('dinner');
  });
});

describe('formatMealMinutes', () => {
  it('reads as minutes, then hours', () => {
    expect(formatMealMinutes(35)).toBe('35 min');
    expect(formatMealMinutes(60)).toBe('1 h');
    expect(formatMealMinutes(70)).toBe('1 h 10 min');
    expect(formatMealMinutes(null)).toBeNull();
    expect(formatMealMinutes(0)).toBeNull();
  });
});

describe('weekShopping', () => {
  const ingredients = new Map([
    ['curry', [ing('curry', 'green curry paste'), ing('curry', 'chicken thighs', 'chicken'), ing('curry', 'rice')]],
    ['pizza', [ing('pizza', 'flour'), ing('pizza', 'rice'), ing('pizza', 'mozzarella')]],
  ]);

  it('counts what is on the list, skips what is in stock, and lists the rest once', () => {
    const shopping = weekShopping({
      entries: [entry('2026-10-27', { recipe_id: 'curry' }), entry('2026-10-30', { recipe_id: 'pizza' })],
      fromDate: '2026-10-27',
      recipesById,
      ingredientsByRecipe: ingredients,
      groceryItems: [grocery('chicken', 'needed'), grocery('rice', 'have'), grocery('Flour', 'bought')],
    });
    expect(shopping.onList).toBe(1);
    expect(shopping.missing.map((m) => m.key)).toEqual(['green curry paste', 'mozzarella']);
    expect(shopping.missing[1].recipe.id).toBe('pizza');
  });

  it('ignores nights before the start, deleted nights and labels', () => {
    const shopping = weekShopping({
      entries: [
        entry('2026-10-26', { recipe_id: 'curry' }),
        entry('2026-10-28', { recipe_id: 'pizza', deleted: true }),
        entry('2026-10-29', { label: 'Out' }),
      ],
      fromDate: '2026-10-27',
      recipesById,
      ingredientsByRecipe: ingredients,
      groceryItems: [],
    });
    expect(shopping).toEqual({ missing: [], onList: 0 });
  });
});

describe('calendar hints', () => {
  const agenda = [
    { title: 'Viewing', date: '2026-10-29', time: '18:30' },
    { title: 'Dentist', date: '2026-10-28', time: '09:00' },
  ];

  it('suggests something quick on a busy evening', () => {
    expect(mealNightHint('2026-10-29', agenda, false)).toBe('Viewing at 6:30 PM, try something quick');
    expect(mealNightHint('2026-10-29', agenda, true)).toBe('Viewing at 6:30 PM');
  });

  it('says a free night is free, and says nothing for a daytime plan', () => {
    expect(mealNightHint('2026-10-31', agenda, false)).toBe('Free all day');
    expect(mealNightHint('2026-10-28', agenda, false)).toBeNull();
    expect(mealNightHint('2026-10-31', agenda, true)).toBeNull();
  });

  it('reads events in local time, all-day ones without a time', () => {
    const local = new Date(2026, 9, 29, 18, 30).toISOString();
    expect(
      agendaFromEvents([
        { title: 'Viewing', starts_at: local, is_all_day: false },
        { title: 'Away', starts_at: '2026-10-30T00:00:00Z', is_all_day: true },
        { title: 'Gone', starts_at: local, is_all_day: false, deleted: true },
      ]),
    ).toEqual([
      { title: 'Viewing', date: '2026-10-29', time: '18:30' },
      { title: 'Away', date: '2026-10-30', time: null },
    ]);
    expect(agendaFromEvents([{ title: 'Viewing', starts_at: '2026-10-29T07:30:00Z', is_all_day: false }], 'Australia/Sydney')).toEqual([
      { title: 'Viewing', date: '2026-10-29', time: '18:30' },
    ]);
  });
});

describe('groceriesGoingOff', () => {
  it('uses the expiry date, else the shelf life from when it was got, soonest first', () => {
    const items = [
      grocery('spinach', 'have', { status_changed_at: '2026-10-24T00:00:00Z', shelf_life_days: 5 }),
      grocery('yoghurt', 'have', { expiry_date: '2026-10-28' }),
      grocery('rice', 'have', { expiry_date: '2027-06-01' }),
      grocery('milk', 'needed', { expiry_date: '2026-10-27' }),
      grocery('old ham', 'have', { expiry_date: '2026-10-20' }),
    ];
    expect(groceriesGoingOff(items, '2026-10-27')).toEqual([
      { name: 'yoghurt', daysLeft: 1 },
      { name: 'spinach', daysLeft: 2 },
    ]);
  });
});

describe('tonightLine', () => {
  it("names tonight's recipe with its time, or the night's label", () => {
    expect(tonightLine([entry('2026-10-27', { recipe_id: 'curry' })], recipesById, '2026-10-27')).toMatchObject({
      title: 'Tonight: Thai green curry',
      time: '35 min',
    });
    expect(tonightLine([entry('2026-10-27', { label: 'Out' })], recipesById, '2026-10-27')).toMatchObject({
      title: 'Tonight: Out',
      time: null,
    });
    expect(tonightLine([entry('2026-10-28', { recipe_id: 'curry' })], recipesById, '2026-10-27')).toBeNull();
    expect(tonightLine([entry('2026-10-27', { recipe_id: 'deleted-recipe' })], recipesById, '2026-10-27')).toBeNull();
  });
});

describe('draft my week', () => {
  const week = mealWeekDates('2026-10-26');

  it('fills only the empty nights from today on', () => {
    const byDate = mealEntriesByDate([entry('2026-10-28', { recipe_id: 'curry' }), entry('2026-10-29', { recipe_id: 'gone' })]);
    expect(draftableNights(week, byDate, recipesById, '2026-10-27')).toEqual([
      '2026-10-27', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
    ]);
  });

  it('keeps real recipes on asked dates, and returns every date', () => {
    const dates = ['2026-10-27', '2026-10-28', '2026-10-29'];
    const nights = cleanMealDraft(
      {
        nights: [
          { date: '2026-10-27', recipe_id: 'curry', label: 'Out', reason: 'Uses the spinach — off Wed' },
          { date: '2026-10-28', recipe_id: 'made-up', label: 'Leftovers', reason: null },
          { date: '2026-10-27', recipe_id: 'pizza', label: null, reason: 'duplicate' },
          { date: '2026-11-20', recipe_id: 'pizza', label: null, reason: 'not asked' },
        ],
      },
      dates,
      new Set(['curry', 'pizza']),
    );
    expect(nights).toEqual([
      { date: '2026-10-27', recipe_id: 'curry', label: null, reason: 'Uses the spinach, off Wed' },
      { date: '2026-10-28', recipe_id: null, label: 'Leftovers', reason: null },
      { date: '2026-10-29', recipe_id: null, label: null, reason: null },
    ]);
    expect(cleanMealDraft('nonsense', dates, new Set())).toHaveLength(3);
  });

  it('tells the model the nights, the busy evenings and what goes off', () => {
    const prompt = mealDraftPrompt({
      dates: ['2026-10-29'],
      recipes: [{ id: 'curry', title: 'Thai green curry', minutes: 35, cuisines: ['thai'], ingredients: ['rice'] }],
      planned: [{ date: '2026-10-28', title: 'Homemade pizza' }],
      busy: [{ title: 'Viewing', date: '2026-10-29', time: '18:30' }],
      goingOff: [{ name: 'spinach', daysLeft: 2 }],
    });
    expect(prompt).toContain('2026-10-29 (Thu)');
    expect(prompt).toContain('Already planned: 2026-10-28 Homemade pizza');
    expect(prompt).toContain('Busy evenings: 2026-10-29 Viewing at 18:30');
    expect(prompt).toContain('Goes off soon: spinach (2 days)');
    expect(prompt).toContain('curry | Thai green curry | 35 | thai | rice');
  });
});

describe('cookName', () => {
  it('uses the first name, else the email', () => {
    const profiles = { u1: { email: 'guy@example.com', name: 'Guy Banda' }, u2: { email: 'tegan@example.com', name: null } };
    expect(cookName('u1', profiles)).toBe('Guy');
    expect(cookName('u2', profiles)).toBe('tegan');
    expect(cookName('gone', profiles)).toBeNull();
    expect(cookName(null, profiles)).toBeNull();
  });
});
