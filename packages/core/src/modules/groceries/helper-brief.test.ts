import { describe, expect, it } from 'vitest';
import type { GroceryItem } from '../../types';
import { briefCount, briefPromptText, helperKeepsTool, helperPromptText, moduleHelper, showsBrief, MODULE_HELPERS } from '../../module-helpers';
import { groceriesBrief } from './helper-brief';
import { nightName } from './helper-brief';

function item(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: 'gi1',
    group_id: 'g1',
    name: 'Milk',
    aisle: 'dairy_eggs',
    quantity: null,
    unit: null,
    status: 'needed',
    notes: null,
    assigned_to: null,
    private: false,
    template_key: null,
    sort_order: 0,
    created_by: null,
    updated_by: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    deleted: false,
    recurrence_days: null,
    status_changed_at: null,
    last_purchased_at: null,
    last_price: null,
    lowest_price: null,
    expiry_date: null,
    shelf_life_days: null,
    price_cents: null,
    is_essential: false,
    recipe_note: null,
    recipe_source_id: null,
    re_add_snoozed_until: null,
    re_add_dismissed_at: null,
    ...overrides,
  } as GroceryItem;
}

const today = '2026-11-08';

describe('groceriesBrief', () => {
  it('counts the list and lists what dinners still need', () => {
    const brief = groceriesBrief({
      items: [item({ id: 'a', name: 'Bread' }), item({ id: 'b', name: 'Oats' })],
      today,
      missing: [
        { key: 'coriander', recipeId: 'r1', recipeTitle: 'Tacos', night: 'Tuesday' },
        { key: 'limes', recipeId: 'r1', recipeTitle: 'Tacos', night: 'Tuesday' },
      ],
    });
    expect(brief.title).toBe('Ready for the shop');
    expect(brief.lede).toBe('2 things on the list. Tacos still needs 2 things.');
    const dinners = brief.sections.find((s) => s.id === 'dinners')!;
    expect(dinners.allLabel).toBe('Add all');
    expect(dinners.rows[0]).toEqual({ kind: 'suggest', key: 'coriander', title: 'Coriander', meta: 'Tacos, Tuesday' });
    expect(briefCount(brief)).toBe(2);
  });

  it('offers items past their shelf life to re-add, with how long ago they were got', () => {
    const brief = groceriesBrief({
      items: [item({ id: 'm', name: 'Milk', status: 'have', shelf_life_days: 5, status_changed_at: '2026-11-01T09:00:00Z' })],
      today,
      missing: null,
    });
    expect(brief.title).toBe('Time to plan the shop');
    const usuals = brief.sections.find((s) => s.id === 'usuals')!;
    expect(usuals.rows).toEqual([{ kind: 'item', id: 'm', title: 'Milk', meta: 'Keeps about 5 days', trailing: '7 days ago', action: 'readd' }]);
    expect(brief.lede).toContain('1 thing may be running low');
  });

  it('flags stock to use soon without offering to buy it', () => {
    const brief = groceriesBrief({
      items: [item({ id: 's', name: 'Spinach', status: 'have', expiry_date: '2026-11-08' })],
      today,
    });
    const soon = brief.sections.find((s) => s.id === 'soon')!;
    expect(soon.rows[0]).toMatchObject({ id: 's', trailing: 'Use today', warn: true });
    expect(soon.allLabel).toBeUndefined();
    expect(briefCount(brief)).toBe(0);
  });

  it('says all sorted when there is nothing to do', () => {
    expect(groceriesBrief({ items: [], today }).title).toBe('All sorted');
  });
});

describe('module helpers', () => {
  it('reads the Groceries helper from its manifest', () => {
    const helper = moduleHelper('groceries')!;
    expect(helper.label).toBe('Groceries helper');
    expect(MODULE_HELPERS.map((h) => h.id)).toContain('groceries');
    expect(moduleHelper('bins')).toBeNull();
  });

  it('keeps its own tools, lookups of the modules it reads, and its writesVia tools', () => {
    const helper = moduleHelper('groceries')!;
    const keeps = (t: { name: string; module: string; lookup?: boolean; moduleless?: boolean }) => helperKeepsTool(helper, ['meals', 'recipes'], t);
    expect(keeps({ name: 'create_grocery_item', module: 'groceries' })).toBe(true);
    expect(keeps({ name: 'get_meal_plan', module: 'recipes', lookup: true })).toBe(true);
    expect(keeps({ name: 'set_meal', module: 'meals' })).toBe(false);
    expect(keeps({ name: 'add_recipe_to_groceries', module: 'recipes' })).toBe(true);
    expect(keeps({ name: 'get_tasks', module: 'household', lookup: true })).toBe(false);
    expect(keeps({ name: 'web_search', module: 'web', moduleless: true })).toBe(true);
  });

  it('puts the playbook and the brief in the prompt', () => {
    const helper = moduleHelper('groceries')!;
    const brief = groceriesBrief({ items: [item({ id: 'a', name: 'Bread' })], today, missing: [{ key: 'limes', recipeId: 'r', recipeTitle: 'Tacos', night: 'Tuesday' }] });
    const text = helperPromptText(helper, { reads: ['meals'] as never, brief });
    expect(text).toContain('You are the Groceries helper');
    expect(text).toContain('You change only Groceries');
    expect(text).toContain('- Limes (Tacos, Tuesday)');
    expect(briefPromptText(brief)).toContain("Today's brief");
  });

  it('shows the brief on a new chat and after a quiet spell', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    expect(showsBrief(null, now)).toBe(true);
    expect(showsBrief('2026-11-08T11:00:00Z', now)).toBe(false);
    expect(showsBrief('2026-11-08T08:00:00Z', now)).toBe(true);
  });

  it('names nights relative to today', () => {
    expect(nightName('2026-11-08', today)).toBe('Tonight');
    expect(nightName('2026-11-09', today)).toBe('Tomorrow');
    expect(nightName('2026-11-10', today)).toBe('Tuesday');
  });
});
