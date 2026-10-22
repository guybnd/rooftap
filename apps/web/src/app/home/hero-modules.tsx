'use client';

// FLUX-253: the summary-hero module registry. Each module is a self-contained
// on/off unit — `HERO_MODULES`' array order is the render order within its
// group. A disabled module's `render` is never called, so it produces zero DOM
// (not CSS-hidden).
//
// FLUX-269 (Hearth): the `day`-group modules (count/nextUp/whosOnHook/
// unassignedNudge) no longer render themselves — `summary-hero.tsx` fuses
// them into shared whisper/lede/people lines and calls the pure helpers below
// directly, gating each fragment on its own module's `isModuleEnabled` flag.
// `render` is therefore optional on `HeroModule`; only `streak` (still
// independent) and the `header`/`home`/`tips` groups keep one. Keys, labels,
// group stay frozen — only render/grouping/container changed. (Hearth v2
// turned the `home`-group shortcuts' defaultOn off; a saved toggle still wins.)

import { type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Flame, ShoppingBag, ShoppingCart, Sun, Sunset, Wind, type LucideIcon } from 'lucide-react';
import type { CostItem, HomeLensKey, HouseholdTask, ModuleFeatureId } from '@homeup/core';
import {
  isHeroModuleAvailable,
  formatMoney,
  isOneOff,
  totalForPeriod,
  nextOccurrence,
  isBill,
  daysBetweenDates,
  parseLocalDateOnly,
  daysUntilLabel,
  countdownDisplay,
} from '@homeup/core';
import { ProgressBar } from '@/components/ui/progress-bar';
import { usePressable, PRESSABLE_SCALE_CLASSNAME } from '@/components/ui/use-pressable';
import { cn } from '@/lib/utils';
import { memberLabel } from '@/app/setup/member-label';
import { localDateISO, HUB, type HeroItem, type MemberProfiles } from './hub-shared';
import { type WeatherData } from './use-weather';
import { weatherRecommendation, rainLaterLabel, currentUvIndex, isDryingDay, sunsetInfo, UV_HIGH_THRESHOLD } from './weather-tips';

export type HeroModuleGroup = 'header' | 'day' | 'home' | 'tips' | 'spaces';

export interface HeroModuleContext {
  todayCount: number;
  weather: WeatherData | null;
  /** FLUX-254: today-scoped hero items (independent of the range picker — see page.tsx todayCount). */
  todayItems: HeroItem[];
  memberProfiles: MemberProfiles;
  currentUserId: string | null;
  /** Render-time snapshot; countdown/streak/budget/bill date math are coarse, not live-ticking. */
  now: Date;
  /** FLUX-254: full (unfiltered-by-range) task list — only the streak module needs multi-day history. */
  tasks: HouseholdTask[];
  budgetCents: number | null;
  costItems: CostItem[];
  /** Where this month ends with the bank's data (core useMonthTotals); null without it. */
  monthTotalCents: number | null;
  groceryToBuyCount: number;
  setup: { done: number; total: number };
  /** HOUP-434: the Shopper shortcut's figure (core shopperShortcutValue), null with nothing watched. */
  shopperShortcut: string | null;
  /** FLUX-258: the countdown module's single pinned event, or null when nothing is pinned. */
  countdown: { label: string; date: string } | null;
  /** Hearth v2: the shortcut Home is filtered to, if any (its Space, expanded). */
  lens?: HomeLensKey | null;
  /** Opens or closes a shortcut's lens. Omitted, lens shortcuts link to their page. */
  onLens?: (key: HomeLensKey) => void;
}

/** A lens shortcut's tap: filter Home in place when the page offers it, else open the section. */
function lensTap(ctx: HeroModuleContext, key: HomeLensKey, href: string): Pick<PulseTileProps, 'href' | 'onPress' | 'selected'> {
  const onLens = ctx.onLens;
  if (!onLens) return { href };
  return { onPress: () => onLens(key), selected: ctx.lens === key };
}

export interface HeroModule {
  key: string;
  group: HeroModuleGroup;
  label: string;
  description: string;
  defaultOn: boolean;
  /** Optional (FLUX-269): the fused day-group lines are composed by the container instead. */
  render?(ctx: HeroModuleContext): ReactNode | null;
}

// "On the hook" = actionable items only, not appointments/calendar events —
// keeps whosOnHook and unassignedNudge in agreement (frozen decision, FLUX-254 plan).
function isHookable(item: HeroItem): boolean {
  return item.type === 'task' || item.type === 'reminder';
}

/** Coarse "in Nh" / "in Nm" from `now` to today's `dueTime` (HH:MM). No live ticking. */
export function coarseCountdown(now: Date, dueTime: string): string {
  const [h, m] = dueTime.split(':').map(Number);
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  const diffMin = Math.round((due.getTime() - now.getTime()) / 60_000);
  if (diffMin <= 0) return 'now';
  if (diffMin < 60) return `in ${diffMin}m`;
  return `in ${Math.round(diffMin / 60)}h`;
}

/** True when a countdown string means "due within the hour" — the only case the Hearth lede's time chip goes warning-amber. */
export function isCountdownDueSoon(countdown: string): boolean {
  return countdown === 'now' || /^in \d+m$/.test(countdown);
}

/** The soonest not-done timed item today, or null (FLUX-269: feeds the fused lede). */
export function nextUpItem(ctx: HeroModuleContext): HeroItem | null {
  return (
    ctx.todayItems.filter((i) => !i.done && i.dueTime).sort((a, b) => a.dueTime!.localeCompare(b.dueTime!))[0] ?? null
  );
}

/** Per-assignee open-item counts for today's hookable items, current user first (FLUX-269: feeds the fused people line). */
export function whosOnHookBuckets(ctx: HeroModuleContext): { assigneeIds: string[]; countFor: (id: string) => number } {
  const hookItems = ctx.todayItems.filter((i) => !i.done && isHookable(i));
  const buckets = new Map<string | null, number>();
  for (const item of hookItems) buckets.set(item.assignedTo, (buckets.get(item.assignedTo) ?? 0) + 1);
  const assigneeIds = [...buckets.keys()]
    .filter((id): id is string => id !== null)
    .sort((a, b) => {
      if (a === ctx.currentUserId) return -1;
      if (b === ctx.currentUserId) return 1;
      return memberLabel(a, ctx.memberProfiles).localeCompare(memberLabel(b, ctx.memberProfiles));
    });
  return { assigneeIds, countFor: (id) => buckets.get(id) ?? 0 };
}

/** Count of today's open hookable items nobody's picked up (FLUX-269: feeds the fused people line's nudge chip). */
export function unassignedCount(ctx: HeroModuleContext): number {
  return ctx.todayItems.filter((i) => !i.done && isHookable(i) && i.assignedTo === null).length;
}

const STREAK_LOOKBACK_DAYS = 60;

/**
 * Best-effort trailing streak of local days with >=1 completed task, from
 * `completed_at` on the current task rows. NOT a verified "everything due
 * that day was cleared" streak — there is no completion-history table:
 * `completed_at` lives only on currently-existing rows and is cleared on
 * un-check, recurring tasks renew (replacing the row), and deletes tombstone.
 * Past days' full due-sets can't be reconstructed client-side, so this counts
 * "at least one thing got done" per day, not true all-clear. Ships
 * `defaultOn: false` for that reason (FLUX-254 plan).
 */
function computeAllClearStreak(tasks: HouseholdTask[], now: Date): number {
  const completedDays = new Set<string>();
  for (const t of tasks) {
    if (!t.completed_at) continue;
    completedDays.add(localDateISO(new Date(t.completed_at)));
  }
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < STREAK_LOOKBACK_DAYS; i++) {
    if (!completedDays.has(localDateISO(cursor))) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// FLUX-255: billsDue window — a soonest-upcoming-bill surface, not a due-date
// list, so it stays a glance rather than growing into a mini Costs page.
const BILLS_DUE_WINDOW_DAYS = 7;
const BILLS_DUE_MAX_ROWS = 2;

interface UpcomingBill {
  key: string;
  label: string;
  days: number;
  discountEnding: boolean;
}

/** Cost items with a derived due date or ending discount within the window, soonest first. */
function upcomingBills(items: CostItem[], now: Date): UpcomingBill[] {
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

/**
 * A smart tip under the Hero (Hearth v2): a small neutral tile with the
 * tip's glyph and one line of body text, so a tip reads as advice rather
 * than a caption.
 */
function TipRow({ Icon, children }: { Icon: LucideIcon; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 text-sm text-foreground">
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-muted">
        <Icon className="size-[15px]" />
      </span>
      <span>{children}</span>
    </p>
  );
}

/**
 * A "Home" group pulse tile (H3/H4): a borderless inset tap target that
 * deep-links to its section. `meter`, when given, renders a tile-width ~3px
 * `ProgressBar` under the value; tiles with no meaningful ratio (billsDue,
 * shoppingList) omit it.
 */
interface PulseTileProps {
  /** Omit (with onPress) for a display-only tile that deep-links nowhere (e.g. countdown) — it renders a plain, non-pressable div. */
  href?: string;
  /** Hearth v2: a lens shortcut's tap, in place of `href`. */
  onPress?: () => void;
  /** The lens this shortcut opens is showing: a coral ring (H2, interactive state). */
  selected?: boolean;
  ariaLabel: string;
  label: string;
  Icon?: LucideIcon;
  value: ReactNode;
  valueClassName?: string;
  meter?: { value: number; total: number; fillClassName?: string };
  className?: string;
}

function PulseTile({
  href,
  onPress,
  selected,
  ariaLabel,
  label,
  Icon,
  value,
  valueClassName,
  meter,
  className,
}: PulseTileProps) {
  const router = useRouter();
  const { pressableProps } = usePressable();
  const content = (
    <>
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className="h-3 w-3 shrink-0" />}
        {label}
      </span>
      <span className={cn('truncate text-sm font-semibold tabular-nums text-foreground', valueClassName)}>{value}</span>
      {meter && <ProgressBar value={meter.value} total={meter.total} fillClassName={meter.fillClassName} className="h-[3px]" />}
    </>
  );

  if (!href && !onPress) {
    return (
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn('flex min-h-[44px] min-w-0 flex-col gap-0.5 rounded-xl bg-muted/40 px-3 py-2 text-left', className)}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={onPress ? !!selected : undefined}
      onClick={() => (onPress ? onPress() : href && router.push(href))}
      {...pressableProps}
      className={cn(
        'flex min-h-[44px] min-w-0 flex-col gap-0.5 rounded-xl bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/60 data-[pressed]:bg-muted/60',
        PRESSABLE_SCALE_CLASSNAME,
        className,
        selected && 'ring-2 ring-inset ring-primary',
      )}
    >
      {content}
    </button>
  );
}

/** Array order = render order within each group. Frozen public keys — renaming one orphans saved user prefs. */
export const HERO_MODULES: HeroModule[] = [
  {
    key: 'weather',
    group: 'header',
    label: 'Current weather',
    description: "Temperature, what the sky's doing next, and an hourly forecast you can open.",
    defaultOn: true,
    // Hearth v2: drawn by summary-hero.tsx as the sky block beside the Hero
    // and the day ribbon under it (sky.tsx), not as a header chip.
  },
  {
    // FLUX-269: fused into the container's whisper + (when nothing's timed) lede.
    key: 'count',
    group: 'day',
    label: 'Left today',
    description: "The big number: how many of today's items are left, with a meter.",
    defaultOn: true,
  },
  {
    // FLUX-269: fused into the container's lede (nextUpItem()).
    key: 'nextUp',
    group: 'day',
    label: 'Now card',
    description: 'The Now card: the next few things to do, slide one to finish it.',
    defaultOn: true,
  },
  {
    // FLUX-269: fused into the container's people line (whosOnHookBuckets()).
    key: 'whosOnHook',
    group: 'day',
    label: "Who's on it",
    description: "Today's open items split by who's assigned.",
    defaultOn: true,
  },
  {
    // FLUX-269: fused into the container's people line as a warning chip (unassignedCount()).
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
    render: (ctx) => {
      const streak = computeAllClearStreak(ctx.tasks, ctx.now);
      if (streak < 1) return null;
      return (
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Flame className="h-3.5 w-3.5 text-warning" />
          <span className="tabular-nums">{streak}-day all-clear streak</span>
        </p>
      );
    },
  },
  {
    key: 'tipRain',
    group: 'tips',
    label: 'Weather tip',
    description: "A rain/snow/heat/cold heads-up based on today's forecast.",
    defaultOn: true,
    render: (ctx) => {
      if (!ctx.weather) return null;
      const rec = weatherRecommendation({
        weatherCode: ctx.weather.weatherCode,
        tempC: ctx.weather.tempC,
        rainLaterLabel: rainLaterLabel(ctx.weather, ctx.now),
      });
      if (!rec) return null;
      return (
        <TipRow Icon={rec.Icon}>{rec.text}</TipRow>
      );
    },
  },
  {
    key: 'tipUv',
    group: 'tips',
    label: 'UV / sunscreen',
    description: 'A heads-up to wear sunscreen when UV is high.',
    defaultOn: true,
    render: (ctx) => {
      if (!ctx.weather) return null;
      const uv = currentUvIndex(ctx.weather, ctx.now);
      if (uv == null || uv < UV_HIGH_THRESHOLD) return null;
      return (
        <TipRow Icon={Sun}>UV is high, wear sunscreen</TipRow>
      );
    },
  },
  {
    key: 'tipDrying',
    group: 'tips',
    label: 'Drying day',
    description: 'A heads-up on good days to dry laundry outside.',
    defaultOn: false,
    render: (ctx) => {
      if (!ctx.weather) return null;
      if (!isDryingDay(ctx.weather, ctx.now)) return null;
      return (
        <TipRow Icon={Wind}>Great day to dry laundry outside</TipRow>
      );
    },
  },
  {
    key: 'tipSunset',
    group: 'tips',
    label: 'Sunset / golden hour',
    description: "Today's sunset and golden-hour time.",
    defaultOn: false,
    render: (ctx) => {
      if (!ctx.weather) return null;
      const info = sunsetInfo(ctx.weather);
      if (!info) return null;
      return (
        <TipRow Icon={Sunset}>
          Sunset {info.sunset} · golden hour {info.goldenHour}
        </TipRow>
      );
    },
  },
  // FLUX-255: the "Home" group — finance/list/setup signals that make the hero
  // a home-management dashboard. Hearth v2: shown as one row of up to
  // SHORTCUTS_CAP compact shortcuts, all off until the person picks them in
  // the customize sheet. Keys are frozen wire ids (persisted in
  // home_hero_modules) — renaming one orphans a user's saved toggle.
  {
    key: 'budgetPulse',
    group: 'home',
    label: 'Budget',
    description: 'Your monthly costs vs your budget. Tap it to show just your Budget space.',
    defaultOn: false,
    render: (ctx) => {
      if (ctx.budgetCents == null) return null;
      // The same monthly recurring total the Costs tile, the Costs page and
      // mobile compare against the budget, so Home never shows two figures.
      const spend = ctx.monthTotalCents ?? totalForPeriod(ctx.costItems.filter((i) => !isOneOff(i)), 'monthly');
      const overBudget = spend >= (ctx.budgetCents * HUB.BUDGET_RED_PCT) / 100;
      const tone = overBudget
        ? 'bg-destructive'
        : spend >= (ctx.budgetCents * HUB.BUDGET_YELLOW_PCT) / 100
          ? 'bg-warning'
          : 'bg-success';
      return (
        <PulseTile
          {...lensTap(ctx, 'budgetPulse', '/costs')}
          ariaLabel={`Budget, ${formatMoney(spend)} of ${formatMoney(ctx.budgetCents)}`}
          label="Budget"
          value={formatMoney(spend)}
          valueClassName={overBudget ? 'text-destructive' : undefined}
          meter={{ value: spend, total: ctx.budgetCents, fillClassName: tone }}
        />
      );
    },
  },
  {
    key: 'billsDue',
    group: 'home',
    label: 'Bills',
    description: 'The soonest bill or ending discount this week. Tap it to show just your Bills.',
    defaultOn: false,
    render: (ctx) => {
      const soonest = upcomingBills(ctx.costItems, ctx.now).slice(0, BILLS_DUE_MAX_ROWS);
      const next = soonest[0];
      if (!next) return null;
      return (
        <PulseTile
          {...lensTap(ctx, 'billsDue', '/costs')}
          ariaLabel="Bills"
          label="Bills"
          value={
            <>
              {next.discountEnding ? 'Discount ends ' : ''}
              {daysUntilLabel(next.days)}
              {soonest.length > 1 && <span className="font-normal text-muted-foreground"> · +{soonest.length - 1}</span>}
            </>
          }
        />
      );
    },
  },
  {
    key: 'shoppingList',
    group: 'home',
    label: 'Groceries',
    description: 'How many grocery items are still needed. Tap it to show just your list.',
    defaultOn: false,
    render: (ctx) => {
      if (ctx.groceryToBuyCount === 0) return null;
      return (
        <PulseTile
          {...lensTap(ctx, 'shoppingList', '/groceries')}
          ariaLabel="Groceries"
          label="Groceries"
          Icon={ShoppingCart}
          value={`${ctx.groceryToBuyCount} to buy`}
        />
      );
    },
  },
  {
    key: 'shopperWatch',
    group: 'home',
    label: 'Shopper',
    description: 'How many things you watch are at a good price. Tap it to show just your Shopper space.',
    defaultOn: false,
    render: (ctx) => {
      if (!ctx.shopperShortcut) return null;
      return (
        <PulseTile
          {...lensTap(ctx, 'shopperWatch', '/shopper')}
          ariaLabel="Shopper"
          label="Shopper"
          Icon={ShoppingBag}
          value={ctx.shopperShortcut}
        />
      );
    },
  },
  {
    key: 'setupProgress',
    group: 'home',
    label: 'Setup',
    description: 'How many home-setup items are still needed.',
    defaultOn: false,
    render: (ctx) => {
      const { done, total } = ctx.setup;
      if (total === 0 || done === total) return null;
      return (
        <PulseTile
          href="/setup"
          ariaLabel="Setup"
          label="Setup"
          value={`${done}/${total}`}
          meter={{ value: done, total }}
        />
      );
    },
  },
  {
    key: 'countdown',
    group: 'home',
    label: 'Countdown',
    description: 'Pin one event and see how long until it.',
    defaultOn: false,
    render: (ctx) => {
      const display = countdownDisplay(ctx.countdown, localDateISO(ctx.now));
      if (!display) return null;
      return (
        <PulseTile
          ariaLabel="Countdown"
          label="Countdown"
          value={`${display.label} · ${display.when}`}
        />
      );
    },
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
// wins over the person's saved toggle, which is never rewritten.

/** Whether a hero module renders: its feature is on and the person's config has it on. */
export function isModuleShown(
  key: string,
  config: Record<string, boolean> | null | undefined,
  feature: (id: ModuleFeatureId) => boolean,
): boolean {
  return isHeroModuleAvailable(key, feature) && isModuleEnabled(key, config);
}

/** The registry minus modules whose feature is off: what the customize sheet lists. */
export function availableHeroModules(feature: (id: ModuleFeatureId) => boolean): HeroModule[] {
  return HERO_MODULES.filter((m) => isHeroModuleAvailable(m.key, feature));
}
