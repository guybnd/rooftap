// HOUP-85: native subset of apps/web's hero-modules.tsx HERO_MODULES
// registry (weather, the all-clear streak, and the four weather tips).
// HOUP-172 added the `day`-group whosOnHook/unassignedNudge toggles (the
// hero's people line) and a `home` group (billsDue/shoppingList/
// setupProgress pulse tiles). HOUP-222 closed the remaining gap with full
// registry parity: `count`/`nextUp` (the whisper/lede's own toggles) and
// `budgetPulse` (mobile's flat Costs & Budget tile below stays — a
// mobile-only keeper — this is the same togglable delta view web shows in
// its hero grid). Keys are frozen wire ids shared with web via the same
// `user_settings.home_hero_modules` column — do not rename one, it would
// orphan a user's saved toggle on both platforms. Hearth v2: the `home`
// group is an opt-in row of up to three shortcuts, so its defaults are off
// (a saved toggle still wins).
import type { CostItem, ModuleFeatureId } from '@homeup/core';
import { daysBetweenDates, isHeroModuleAvailable, nextOccurrence, isBill, parseLocalDateOnly } from '@homeup/core';

export type HeroModuleGroup = 'header' | 'day' | 'home' | 'tips' | 'spaces';

export interface HeroModuleMeta {
  key: string;
  group: HeroModuleGroup;
  label: string;
  description: string;
  defaultOn: boolean;
}

export const HERO_MODULES: HeroModuleMeta[] = [
  {
    key: 'weather',
    group: 'header',
    label: 'Current weather',
    description: "Temperature, what the sky's doing next, and an hourly forecast you can open.",
    defaultOn: true,
  },
  {
    // HOUP-222: web parity (apps/web/src/app/home/hero-modules.tsx) — the
    // hero's whisper/lede already fuse count/nextUp unconditionally; this
    // registers the customize-sheet rows and gates that fusion in index.tsx.
    key: 'count',
    group: 'day',
    label: 'Left today',
    description: "The big number: how many of today's items are left, with a meter.",
    defaultOn: true,
  },
  {
    key: 'nextUp',
    group: 'day',
    label: 'Now card',
    description: 'The Now card: the next few things to do, slide one to finish it.',
    defaultOn: true,
  },
  {
    key: 'whosOnHook',
    group: 'day',
    label: "Who's on it",
    description: "Today's open items split by who's assigned.",
    defaultOn: true,
  },
  {
    key: 'unassignedNudge',
    group: 'day',
    label: 'Unassigned',
    description: "Count of today's open items nobody's picked up.",
    defaultOn: true,
  },
  {
    key: 'streak',
    group: 'day',
    label: 'All-clear streak',
    description: 'Best-effort count of recent days with at least one task completed. May not reflect every task being done that day.',
    defaultOn: false,
  },
  {
    // HOUP-222: web parity — mobile previously omitted this in favor of the
    // always-on flat "Costs & Budget" tile lower on the screen; that tile is
    // a mobile-only keeper and stays, this adds the togglable pulse-tile
    // alongside it (a delta view scoped to the hero's home-group grid).
    key: 'budgetPulse',
    group: 'home',
    label: 'Budget',
    description: 'Your monthly costs vs your budget. Tap it to show just your Budget space.',
    defaultOn: false,
  },
  {
    key: 'billsDue',
    group: 'home',
    label: 'Bills',
    description: 'The soonest bill or ending discount this week. Tap it to show just your Bills.',
    defaultOn: false,
  },
  {
    key: 'shoppingList',
    group: 'home',
    label: 'Groceries',
    description: 'How many grocery items are still needed. Tap it to show just your list.',
    defaultOn: false,
  },
  {
    key: 'shopperWatch',
    group: 'home',
    label: 'Shopper',
    description: 'How many things you watch are at a good price. Tap it to show just your Shopper space.',
    defaultOn: false,
  },
  {
    key: 'setupProgress',
    group: 'home',
    label: 'Setup',
    description: 'How many home-setup items are still needed.',
    defaultOn: false,
  },
  {
    key: 'countdown',
    group: 'home',
    label: 'Countdown',
    description: 'Pin one event and see how long until it.',
    defaultOn: false,
  },
  {
    key: 'tipRain',
    group: 'tips',
    label: 'Weather tip',
    description: "A rain/snow/heat/cold heads-up based on today's forecast.",
    defaultOn: true,
  },
  {
    key: 'tipUv',
    group: 'tips',
    label: 'UV / sunscreen',
    description: 'A heads-up to wear sunscreen when UV is high.',
    defaultOn: true,
  },
  {
    key: 'tipDrying',
    group: 'tips',
    label: 'Drying day',
    description: 'A heads-up on good days to dry laundry outside.',
    defaultOn: false,
  },
  {
    key: 'tipSunset',
    group: 'tips',
    label: 'Sunset / golden hour',
    description: "Today's sunset and golden-hour time.",
    defaultOn: false,
  },
  {
    key: 'spaceBudget',
    group: 'spaces',
    label: 'Budget',
    description: 'Your Budget space at the bottom of Home.',
    defaultOn: true,
  },
  {
    key: 'spaceBills',
    group: 'spaces',
    label: 'Bills',
    description: 'Your Bills space at the bottom of Home: what falls due this week.',
    defaultOn: true,
  },
];

export function isModuleEnabled(key: string, config: Record<string, boolean> | null | undefined): boolean {
  const heroModule = HERO_MODULES.find((m) => m.key === key);
  const defaultOn = heroModule?.defaultOn ?? true;
  return config?.[key] ?? defaultOn;
}

// Modules: a hero module that shows another module's data needs that module
// (HERO_MODULE_FEATURES in core's hero.ts, module-features.ts). An off feature
// wins over the person's saved toggle, which is never rewritten. Same shape
// as web's hero-modules.tsx.

/** Whether a hero module renders: its feature is on and the person's config has it on. */
export function isModuleShown(
  key: string,
  config: Record<string, boolean> | null | undefined,
  feature: (id: ModuleFeatureId) => boolean
): boolean {
  return isHeroModuleAvailable(key, feature) && isModuleEnabled(key, config);
}

/** The registry minus modules whose feature is off: what the customize sheet lists. */
export function availableHeroModules(feature: (id: ModuleFeatureId) => boolean): HeroModuleMeta[] {
  return HERO_MODULES.filter((m) => isHeroModuleAvailable(m.key, feature));
}

// FLUX-255 parity (via web's app/home/hero-modules.tsx): billsDue window — a
// soonest-upcoming-bill surface, not a due-date list, so it stays a glance
// rather than growing into a mini Costs page. Kept local (mobile can't import
// web's JSX-adjacent module — same reason as the header comment above).
const BILLS_DUE_WINDOW_DAYS = 7;
export const BILLS_DUE_MAX_ROWS = 2;

export interface UpcomingBill {
  key: string;
  label: string;
  days: number;
  discountEnding: boolean;
}

/** Cost items with a derived due date or ending discount within the window, soonest first. */
export function upcomingBills(items: CostItem[], now: Date): UpcomingBill[] {
  const fromMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const results: UpcomingBill[] = [];
  for (const item of items) {
    const label = item.provider || item.name;
    // Spending estimates (groceries, cafes) recur but have no due date.
    const occurrence = item.cadence !== 'one_off' && !isBill(item) ? null : nextOccurrence(item, fromMidnight);
    if (occurrence) {
      const days = daysBetweenDates(fromMidnight, occurrence);
      if (days <= BILLS_DUE_WINDOW_DAYS) results.push({ key: `${item.id}-due`, label, days, discountEnding: false });
    }
    if (item.discount_end_date) {
      const discountEnd = parseLocalDateOnly(item.discount_end_date);
      const days = daysBetweenDates(fromMidnight, discountEnd);
      if (days >= 0 && days <= BILLS_DUE_WINDOW_DAYS) {
        results.push({ key: `${item.id}-discount`, label, days, discountEnding: true });
      }
    }
  }
  return results.sort((a, b) => a.days - b.days);
}
