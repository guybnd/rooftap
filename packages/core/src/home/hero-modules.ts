// Home's hero module registry and the pure helpers behind its lines, shared by
// both apps' Home screens. Each app keeps its own rendering: web adds a
// `render` per module (hero-modules.tsx), the phone draws the tiles inline.
//
// Keys are frozen wire ids saved in `user_settings.home_hero_modules`; renaming
// one orphans a person's saved toggle on both platforms. Array order is the
// render order within a group. Hearth v2: the `home` group is an opt-in row of
// up to three shortcuts, so its defaults are off (a saved toggle still wins).

import type { CostItem } from '../types';
import type { ModuleFeatureId } from '../module-features';
import { isHeroModuleAvailable, type HeroItem } from '../hero';
import { daysBetweenDates, nextOccurrence, parseLocalDateOnly } from '../modules/costs/costs';
import { isBill } from '../modules/costs/money-insights';
import {
  currentUvIndex,
  isDryingDay,
  rainLaterLabel,
  sunsetInfo,
  UV_HIGH_THRESHOLD,
  weatherRecommendation,
  type WeatherData,
  type WeatherTipKind,
} from '../weather-tips';

export type HeroModuleGroup = 'header' | 'day' | 'home' | 'tips' | 'spaces';

export interface HeroModuleMeta {
  key: string;
  group: HeroModuleGroup;
  label: string;
  description: string;
  defaultOn: boolean;
}

/** The customize sheet's group headings, and the order it lists the groups in. */
export const HERO_GROUP_LABELS: Record<HeroModuleGroup, string> = {
  header: 'Weather',
  day: 'Your day',
  home: 'Shortcuts, up to 3',
  tips: 'Smart tips',
  spaces: 'Spaces',
};

export const HERO_GROUP_ORDER: HeroModuleGroup[] = ['header', 'day', 'tips', 'home', 'spaces'];

export const HERO_MODULES: HeroModuleMeta[] = [
  {
    // Drawn as the sky block beside the Hero and the day ribbon under it.
    key: 'weather',
    group: 'header',
    label: 'Current weather',
    description: "Temperature, what the sky's doing next, and an hourly forecast you can open.",
    defaultOn: true,
  },
  {
    // The day-group modules are fused into the Hero's lede and people line;
    // each fragment gates on its own module.
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
// (HERO_MODULE_FEATURES in hero.ts, module-features.ts). An off feature wins
// over the person's saved toggle, which is never rewritten.

/** Whether a hero module renders: its feature is on and the person's config has it on. */
export function isModuleShown(
  key: string,
  config: Record<string, boolean> | null | undefined,
  feature: (id: ModuleFeatureId) => boolean
): boolean {
  return isHeroModuleAvailable(key, feature) && isModuleEnabled(key, config);
}

/**
 * The registry minus modules whose feature is off: what the customize sheet
 * lists. Web passes its own registry (the same entries with a `render` each).
 */
export function availableHeroModules<T extends { key: string } = HeroModuleMeta>(
  feature: (id: ModuleFeatureId) => boolean,
  modules: readonly T[] = HERO_MODULES as unknown as readonly T[]
): T[] {
  return modules.filter((m) => isHeroModuleAvailable(m.key, feature));
}

// ── Today's lines ─────────────────────────────────────────────────────────

/** Coarse "in Nh" / "in Nm" from `now` to today's `dueTime` (HH:MM). No live ticking. */
export function coarseCountdown(now: Date, dueTime: string): string {
  const [h, m] = dueTime.split(':').map(Number);
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  const diffMin = Math.round((due.getTime() - now.getTime()) / 60_000);
  if (diffMin <= 0) return 'now';
  if (diffMin < 60) return `in ${diffMin}m`;
  return `in ${Math.round(diffMin / 60)}h`;
}

/** True when a countdown string means "due within the hour": the only case the lede's time chip goes warning-amber. */
export function isCountdownDueSoon(countdown: string): boolean {
  return countdown === 'now' || /^in \d+m$/.test(countdown);
}

/** The soonest not-done timed item today, or null. */
export function nextUpItem(todayItems: HeroItem[]): HeroItem | null {
  return todayItems.filter((i) => !i.done && i.dueTime).sort((a, b) => a.dueTime!.localeCompare(b.dueTime!))[0] ?? null;
}

export interface NowCardTiming {
  /** "in 25m" / "in 3h" / "now" for today's timed item, else null (an overdue item's time is a past day's). */
  countdown: string | null;
  /** Due within the hour: the time reads in the warning hue. */
  dueSoon: boolean;
  /** The card's micro-label: what kind of "now" this is. */
  eyebrow: { text: string; tone: 'muted' | 'warning' | 'danger' };
}

/** The Now card's eyebrow and countdown for one queued item. */
export function nowCardTiming(item: Pick<HeroItem, 'dueTime' | 'overdue'>, now: Date): NowCardTiming {
  const countdown = item.dueTime && !item.overdue ? coarseCountdown(now, item.dueTime) : null;
  const dueSoon = countdown ? isCountdownDueSoon(countdown) : false;
  const eyebrow: NowCardTiming['eyebrow'] = item.overdue
    ? { text: 'Overdue', tone: 'danger' }
    : item.dueTime
      ? { text: dueSoon ? 'Now' : 'Next up', tone: dueSoon ? 'warning' : 'muted' }
      : { text: 'Today', tone: 'muted' };
  return { countdown, dueSoon, eyebrow };
}

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

// Same label the apps show for an assignee, so the people line sorts the way it reads.
function assigneeLabel(userId: string, profiles: MemberProfiles): string {
  const profile = profiles[userId];
  if (!profile) return 'Former member';
  return profile.name || profile.email || 'Member';
}

// "On the hook" = actionable items only, not appointments or calendar events,
// so whosOnHook and unassignedNudge agree.
function isHookable(item: HeroItem): boolean {
  return item.type === 'task' || item.type === 'reminder';
}

/** Per-assignee open-item counts for today's hookable items, current user first. */
export function whosOnHookBuckets(
  todayItems: HeroItem[],
  currentUserId: string | null,
  memberProfiles: MemberProfiles
): { assigneeIds: string[]; countFor: (id: string) => number } {
  const hookItems = todayItems.filter((i) => !i.done && isHookable(i));
  const buckets = new Map<string | null, number>();
  for (const item of hookItems) buckets.set(item.assignedTo, (buckets.get(item.assignedTo) ?? 0) + 1);
  const assigneeIds = [...buckets.keys()]
    .filter((id): id is string => id !== null)
    .sort((a, b) => {
      if (a === currentUserId) return -1;
      if (b === currentUserId) return 1;
      return assigneeLabel(a, memberProfiles).localeCompare(assigneeLabel(b, memberProfiles));
    });
  return { assigneeIds, countFor: (id) => buckets.get(id) ?? 0 };
}

/** Count of today's open hookable items nobody's picked up (the people line's nudge chip). */
export function unassignedCount(todayItems: HeroItem[]): number {
  return todayItems.filter((i) => !i.done && isHookable(i) && i.assignedTo === null).length;
}

// ── Smart tips ────────────────────────────────────────────────────────────

/** Tips show at most this many rows: the first qualifying ones in registry order. */
export const HERO_TIPS_CAP = 2;

/** What a tip's glyph shows; each app maps it to its own icon. */
export type HeroTipGlyph = WeatherTipKind | 'uv' | 'drying' | 'sunset';

export interface HeroTip {
  key: string;
  text: string;
  glyph: HeroTipGlyph;
}

/** One tips-group module's line for this weather, or null when it has nothing to say. */
export function heroTip(key: string, weather: WeatherData | null, now: Date): HeroTip | null {
  if (!weather) return null;
  switch (key) {
    case 'tipRain': {
      const rec = weatherRecommendation({
        weatherCode: weather.weatherCode,
        tempC: weather.tempC,
        rainLaterLabel: rainLaterLabel(weather, now),
      });
      return rec ? { key, text: rec.text, glyph: rec.kind } : null;
    }
    case 'tipUv': {
      const uv = currentUvIndex(weather, now);
      return uv != null && uv >= UV_HIGH_THRESHOLD ? { key, text: 'UV is high, wear sunscreen', glyph: 'uv' } : null;
    }
    case 'tipDrying':
      return isDryingDay(weather, now) ? { key, text: 'Great day to dry laundry outside', glyph: 'drying' } : null;
    case 'tipSunset': {
      const info = sunsetInfo(weather);
      return info ? { key, text: `Sunset ${info.sunset} · golden hour ${info.goldenHour}`, glyph: 'sunset' } : null;
    }
    default:
      return null;
  }
}

/**
 * The tips row: the first `cap` tips that are on and qualify, in registry
 * order. Gates on qualifying, not just "on", so a tip with nothing to say
 * (UV when it's low) never takes a slot from a lower one that does.
 */
export function heroTips(
  weather: WeatherData | null,
  now: Date,
  isOn: (key: string) => boolean,
  cap: number = HERO_TIPS_CAP
): HeroTip[] {
  const tips: HeroTip[] = [];
  for (const m of HERO_MODULES) {
    if (tips.length >= cap) break;
    if (m.group !== 'tips' || !isOn(m.key)) continue;
    const tip = heroTip(m.key, weather, now);
    if (tip) tips.push(tip);
  }
  return tips;
}

// ── Shortcuts ─────────────────────────────────────────────────────────────

/** Budget colour thresholds (percent of the monthly budget spent). */
export const BUDGET_YELLOW_PCT = 80;
export const BUDGET_RED_PCT = 100;

/** The Budget shortcut's and Budget space's meter tone: danger from 100% spent, warning from 80%. */
export function budgetPulseTone(budgetCents: number, spendCents: number): 'success' | 'warning' | 'danger' {
  if (spendCents >= (budgetCents * BUDGET_RED_PCT) / 100) return 'danger';
  if (spendCents >= (budgetCents * BUDGET_YELLOW_PCT) / 100) return 'warning';
  return 'success';
}

// The Bills shortcut is the soonest bill, not a due-date list, so it stays a
// glance rather than growing into a mini Costs page.
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
