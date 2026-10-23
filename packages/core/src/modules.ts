// Modules: households choose their features. Design note: .docs/modules.md.
//
// Every optional feature is a module a household switches on or off
// (`group_modules` table, owner-only). A module that is off leaves no trace:
// every surface gates on `resolveEnabledModules` (server, pure) or the
// platform `useModules()` hook built on it, the same way every moving
// affordance gates on isMovingActive() so web and mobile can't drift.
//
// Module ids reuse the section ids in sections.ts, so `hidden_sections`,
// `section_order`, `default_section` and `last_used_section` keep working.
// Google Calendar and MCP are integrations with no section of their own.
// Home (the hub) and Profile (Settings) are platform, not modules.

import { schemaAtLeast, type ServerSchema } from './server-features';

export type ModuleId =
  | 'household'
  | 'calendar'
  | 'checklists'
  | 'documents'
  | 'groceries'
  | 'recipes'
  | 'meals'
  | 'costs'
  | 'setup'
  | 'search'
  | 'shopper'
  | 'rewards'
  | 'occasions'
  | 'bins'
  | 'assistant'
  | 'money-insights'
  | 'home-care'
  | 'google-calendar'
  | 'mcp';

export interface ModuleDef {
  id: ModuleId;
  label: string;
  /** One line for the Settings > Modules row. Hearth copy rules apply. */
  description: string;
  /** Lucide icon name, resolved per platform (same convention as Section.iconId). */
  iconId: string;
  /** On for a new household with no `group_modules` row for this module. */
  defaultEnabled: boolean;
  /** Hard dependencies: can't be on unless these are on. */
  requires?: ModuleId[];
  /** Soft dependencies: cross-module features appear only when both are on. */
  enhances?: ModuleId[];
  /**
   * For a module added after 1.0.0: the migration it needs. A self-hosted
   * server built before it doesn't offer the module (server-features.ts).
   */
  minSchema?: string;
}

export const MODULES: ModuleDef[] = [
  {
    id: 'household',
    label: 'Tasks & Reminders',
    description: 'Shared to-dos, chores and reminders with due dates.',
    iconId: 'list-checks',
    defaultEnabled: true,
    enhances: ['checklists', 'calendar'],
  },
  {
    id: 'calendar',
    label: 'Calendar',
    description: 'Household events and everything with a date, in one view.',
    iconId: 'calendar-days',
    defaultEnabled: true,
    enhances: ['household', 'search'],
  },
  {
    id: 'checklists',
    label: 'Checklists',
    description: 'Reusable lists and templates, from packing to cleaning.',
    iconId: 'list-todo',
    defaultEnabled: true,
    enhances: ['household'],
  },
  {
    id: 'documents',
    label: 'Documents',
    description: 'Warranties, receipts and paperwork, filed in folders.',
    iconId: 'folder-open',
    defaultEnabled: true,
    enhances: ['costs', 'setup', 'groceries'],
  },
  {
    id: 'groceries',
    label: 'Groceries',
    description: 'A shared shopping list with aisles and an item library.',
    iconId: 'shopping-cart',
    defaultEnabled: false,
    enhances: ['costs', 'recipes'],
  },
  {
    id: 'recipes',
    label: 'Recipes',
    description: 'Your household recipes, with a cooking view.',
    iconId: 'chef-hat',
    defaultEnabled: false,
    enhances: ['groceries'],
  },
  // A tab inside Recipes ("This week"), not a section of its own. Like
  // Money insights it needs no switch of its own to lock Recipes on: with
  // Recipes off there is nowhere to show it, so every gate names both
  // (module-features.ts), and it is on for any household that has Recipes.
  {
    id: 'meals',
    label: 'Meal plan',
    description: "Plan the week's dinners from your recipes, and add what's missing to Groceries.",
    iconId: 'utensils',
    defaultEnabled: true,
    enhances: ['recipes', 'groceries', 'calendar', 'assistant'],
    minSchema: '20261023130000_meal_plan',
  },
  {
    id: 'costs',
    label: 'Costs & Budget',
    description: 'Bills, recurring costs and a monthly budget.',
    iconId: 'wallet',
    defaultEnabled: false,
    enhances: ['setup', 'groceries', 'search'],
  },
  {
    id: 'setup',
    label: 'Home Setup',
    description: 'Rooms, purchases and the moving checklist for a new home.',
    iconId: 'home',
    defaultEnabled: false,
    enhances: ['search', 'costs'],
  },
  {
    id: 'search',
    label: 'Home Search',
    description: 'Listings, viewings, agents and a map while you look for a place.',
    iconId: 'layout-dashboard',
    defaultEnabled: false,
    enhances: ['calendar', 'setup'],
  },
  {
    id: 'shopper',
    label: 'Shopper',
    description: 'Things you want to buy, with price tracking and a deal rating.',
    iconId: 'shopping-bag',
    defaultEnabled: false,
    enhances: ['household', 'costs'],
    minSchema: '20261021010000_shopper',
  },
  {
    id: 'rewards',
    label: 'Rewards',
    description: 'Loyalty cards and memberships, the stores they work at, and what they get you there.',
    iconId: 'wallet-cards',
    defaultEnabled: false,
    enhances: ['groceries'],
    minSchema: '20261021130000_rewards',
  },
  {
    id: 'occasions',
    label: 'Occasions',
    description: 'Birthdays and other days, gift ideas and wishlists, with surprises kept from the person they are for.',
    iconId: 'gift',
    defaultEnabled: false,
    enhances: ['shopper', 'costs'],
    minSchema: '20261023100000_occasions',
  },
  {
    id: 'bins',
    label: 'Bin night',
    description: 'Which bins go out tonight, whose turn it is, and a reminder before bed.',
    iconId: 'trash-2',
    defaultEnabled: false,
    enhances: ['calendar', 'assistant'],
    minSchema: '20261023110000_bins',
  },
  {
    id: 'assistant',
    label: 'Assistant',
    description: 'A household agent you can ask or talk to, with your OK before it changes anything.',
    iconId: 'sparkles',
    defaultEnabled: false,
    enhances: ['household', 'calendar', 'costs', 'groceries'],
    minSchema: '20261021020000_assistant',
  },
  // Integrations: modules with no section of their own (.docs/modules.md, section 3).
  {
    id: 'money-insights',
    label: 'Money insights',
    description: 'Price rises, subscriptions to rethink and ways to save, on the Costs page.',
    iconId: 'lightbulb',
    // Lives on the Costs page, so it needs no switch of its own to lock
    // Costs on: with Costs off there is nowhere to show it.
    defaultEnabled: true,
    enhances: ['costs', 'shopper', 'household'],
  },
  {
    id: 'home-care',
    label: 'Home care',
    description: 'Upkeep on a schedule you choose, from smoke alarms to gutters, in Home Setup.',
    iconId: 'wrench',
    // Lives in Home Setup as its Care view, so it needs Setup on.
    defaultEnabled: false,
    requires: ['setup'],
    enhances: ['household', 'calendar'],
    minSchema: '20261023120000_home_care',
  },
  {
    id: 'google-calendar',
    label: 'Google Calendar',
    description: 'Sends tasks and viewings to Google Calendar and shows your Google events.',
    iconId: 'calendar-sync',
    defaultEnabled: false,
    requires: ['calendar'],
    enhances: ['household', 'search'],
  },
  {
    id: 'mcp',
    label: 'AI assistants (MCP)',
    description: 'Lets an AI assistant read and update your household through MCP.',
    iconId: 'bot',
    defaultEnabled: false,
    enhances: ['household', 'calendar', 'costs', 'groceries'],
  },
];

const MODULE_BY_ID = new Map<string, ModuleDef>(MODULES.map((m) => [m.id, m]));

export const ALL_MODULE_IDS: ModuleId[] = MODULES.map((m) => m.id);

export function getModule(id: string): ModuleDef | undefined {
  return MODULE_BY_ID.get(id);
}

export function isModuleId(id: string): id is ModuleId {
  return MODULE_BY_ID.has(id);
}

/** A `group_modules` row as the client reads it. */
export interface GroupModuleRow {
  group_id: string;
  module_id: string;
  enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

/**
 * Parses the server's `HOMEUP_MODULES` env value (comma-separated module ids).
 * Unset or blank means every module. Unknown ids are dropped, so a typo can't
 * add a phantom module. Returns null for "every module" so callers can tell
 * "not configured" from "configured to all of them".
 */
export function parseModuleList(raw: string | null | undefined): ModuleId[] | null {
  if (raw == null || raw.trim() === '') return null;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is ModuleId => isModuleId(s));
  return Array.from(new Set(ids));
}

/**
 * The single predicate behind every module gate: what the server offers,
 * intersected with the household's switches (a missing row means the
 * module's default), minus anything whose hard requirements are off.
 */
export function resolveEnabledModules(input: {
  /** Modules the server offers; null = all. */
  available: readonly string[] | null | undefined;
  rows: readonly Pick<GroupModuleRow, 'module_id' | 'enabled'>[];
}): Set<ModuleId> {
  const available = input.available ? new Set(input.available) : null;
  const switched = new Map(input.rows.map((r) => [r.module_id, r.enabled]));

  const on = new Set<ModuleId>();
  for (const m of MODULES) {
    if (available && !available.has(m.id)) continue;
    if (switched.get(m.id) ?? m.defaultEnabled) on.add(m.id);
  }

  // Drop modules whose requirements are off, repeating until stable so a
  // chain of requirements resolves fully.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of Array.from(on)) {
      const requires = MODULE_BY_ID.get(id)?.requires ?? [];
      if (requires.some((r) => !on.has(r))) {
        on.delete(id);
        changed = true;
      }
    }
  }
  return on;
}

/**
 * Modules the server offers, in registry order: its HOMEUP_MODULES list
 * (null = all), minus modules newer than its schema.
 */
export function availableModules(available: readonly string[] | null | undefined, schema?: ServerSchema): ModuleDef[] {
  const set = available ? new Set(available) : null;
  return MODULES.filter((m) => (!set || set.has(m.id)) && (!m.minSchema || schemaAtLeast(schema, m.minSchema)));
}

/**
 * Whether a section (by id) should exist for this household. Sections that
 * aren't modules (home, profile) are platform and always on.
 */
export function isSectionEnabled(sectionId: string, enabled: ReadonlySet<string>): boolean {
  return !isModuleId(sectionId) || enabled.has(sectionId);
}

/**
 * Enabled modules that hard-require `id`, i.e. the ones that block switching
 * it off. Empty when nothing depends on it.
 */
export function dependantsOf(id: ModuleId, enabled: ReadonlySet<string>): ModuleDef[] {
  return MODULES.filter((m) => enabled.has(m.id) && (m.requires ?? []).includes(id));
}

/**
 * Whether to show the first-run module picker (.docs/modules.md, section 8):
 * only to the owner, and only while the household has never chosen its
 * modules, i.e. it has no `group_modules` row yet and runs on the defaults.
 * Existing households were seeded with rows, and the picker and any switch in
 * Settings write one, so it shows at most once. It waits while the person has
 * a pending invitation, since they may join that household instead of the
 * one created for them at signup. `rows` null (not loaded) never shows it.
 */
export function needsModulePicker(input: {
  rows: readonly unknown[] | null;
  isOwner: boolean;
  pendingInvitations: number;
}): boolean {
  return input.rows !== null && input.rows.length === 0 && input.isOwner && input.pendingInvitations === 0;
}

/**
 * The picker's ticks after ticking or unticking one module. Ticking also ticks
 * what it hard-requires; unticking also unticks whatever requires it, so the
 * ticks never ask for a module that would resolve off.
 */
export function withModuleChoice(chosen: ReadonlySet<ModuleId>, id: ModuleId, on: boolean): Set<ModuleId> {
  const next = new Set(chosen);
  const tick = (m: ModuleId) => {
    next.add(m);
    for (const r of MODULE_BY_ID.get(m)?.requires ?? []) if (!next.has(r)) tick(r);
  };
  const untick = (m: ModuleId) => {
    next.delete(m);
    for (const d of MODULES) if (next.has(d.id) && (d.requires ?? []).includes(m)) untick(d.id);
  };
  if (on) tick(id);
  else untick(id);
  return next;
}

/**
 * `hidden` plus every module that is off: the drop-in for surfaces that
 * already honour the per-person hidden-sections list (home tiles, capture,
 * search), so a switched-off module disappears from them too. Never write the
 * result back to `hidden_sections`.
 */
export function hiddenWithDisabledModules(
  hidden: readonly string[] | null | undefined,
  enabled: ReadonlySet<string>,
): string[] {
  const out = new Set(hidden ?? []);
  for (const id of ALL_MODULE_IDS) if (!enabled.has(id)) out.add(id);
  return Array.from(out);
}
