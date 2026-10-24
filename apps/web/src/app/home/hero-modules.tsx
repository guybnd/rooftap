'use client';

// FLUX-253: the summary-hero module registry. Core's home/hero-modules.ts holds
// the registry itself (keys, labels, groups, defaults, order) and the pure
// helpers both apps use; this adds web's `render` per module. A disabled
// module's `render` is never called, so it produces zero DOM (not CSS-hidden).
//
// FLUX-269 (Hearth): the `day`-group modules (count/nextUp/whosOnHook/
// unassignedNudge) don't render themselves: `summary-hero.tsx` fuses them
// into shared whisper/lede/people lines with core's helpers, gating each
// fragment on its own module. Only `streak` and the `home`/`tips` groups keep
// a render here.

import { type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CloudRain, CloudSnow, Flame, ShoppingBag, ShoppingCart, Sun, Sunset, Wind, type LucideIcon } from 'lucide-react';
import type { HeroTipGlyph, HeroModuleMeta, HomeLensKey, HouseholdTask, CostItem, ModuleFeatureId, WeatherData } from '@homeup/core';
import {
  HERO_MODULES as CORE_HERO_MODULES,
  availableHeroModules as availableCoreHeroModules,
  budgetPulseTone,
  goalTone,
  type CostMonth,
  computeAllClearStreak,
  countdownDisplay,
  daysUntilLabel,
  formatMoney,
  heroTip,
  isOneOff,
  totalForPeriod,
  upcomingBills,
  BILLS_DUE_MAX_ROWS,
} from '@homeup/core';
import { ProgressBar } from '@/components/ui/progress-bar';
import { usePressable, PRESSABLE_SCALE_CLASSNAME } from '@/components/ui/use-pressable';
import { cn } from '@/lib/utils';
import { localDateISO, type HeroItem, type MemberProfiles } from './hub-shared';

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
  /** This month as the Costs hero shows it (core useCurrentCostMonth); null in tests. */
  costMonth: CostMonth | null;
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

export interface HeroModule extends HeroModuleMeta {
  /** Optional (FLUX-269): the fused day-group lines are composed by the container instead. */
  render?(ctx: HeroModuleContext): ReactNode | null;
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

const TIP_ICON: Record<HeroTipGlyph, LucideIcon> = {
  rain: CloudRain,
  snow: CloudSnow,
  hot: Sun,
  cold: CloudSnow,
  uv: Sun,
  drying: Wind,
  sunset: Sunset,
};

/** A tips-group module's render: core heroTip's line with this app's icon. */
function renderTip(key: string): NonNullable<HeroModule['render']> {
  return function renderTipRow(ctx) {
    const tip = heroTip(key, ctx.weather, ctx.now);
    if (!tip) return null;
    return <TipRow Icon={TIP_ICON[tip.glyph]}>{tip.text}</TipRow>;
  };
}

const PULSE_FILL = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive', neutral: 'bg-foreground/45' } as const;

// Web's render per module. A key without one renders nothing here (the fused
// day lines, the sky block and the spaces are drawn by their containers).
const RENDERS: Partial<Record<string, NonNullable<HeroModule['render']>>> = {
  streak: (ctx) => {
    const streak = computeAllClearStreak(ctx.tasks, ctx.now);
    if (streak < 1) return null;
    return (
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Flame className="h-3.5 w-3.5 text-warning" />
        <span className="tabular-nums">{streak}-day all-clear streak</span>
      </p>
    );
  },
  tipRain: renderTip('tipRain'),
  tipUv: renderTip('tipUv'),
  tipDrying: renderTip('tipDrying'),
  tipSunset: renderTip('tipSunset'),
  budgetPulse: (ctx) => {
    if (ctx.budgetCents == null) return null;
    // Like the Costs hero: paid so far out of the goal, amber while the month
    // is heading over, red once paid passes it (core goalTone), never the
    // month-end forecast as if already spent.
    const spend = ctx.costMonth?.paidCents ?? totalForPeriod(ctx.costItems.filter((i) => !isOneOff(i)), 'monthly');
    const tone = ctx.costMonth ? goalTone(ctx.costMonth, ctx.budgetCents, ctx.now) : budgetPulseTone(ctx.budgetCents, spend);
    return (
      <PulseTile
        {...lensTap(ctx, 'budgetPulse', '/costs')}
        ariaLabel={`Budget, ${formatMoney(spend)} of ${formatMoney(ctx.budgetCents)} so far`}
        label="Budget"
        value={formatMoney(spend)}
        valueClassName={tone === 'danger' ? 'text-destructive' : undefined}
        meter={{ value: spend, total: ctx.budgetCents, fillClassName: PULSE_FILL[tone] }}
      />
    );
  },
  billsDue: (ctx) => {
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
  shoppingList: (ctx) => {
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
  shopperWatch: (ctx) => {
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
  setupProgress: (ctx) => {
    const { done, total } = ctx.setup;
    if (total === 0 || done === total) return null;
    return <PulseTile href="/setup" ariaLabel="Setup" label="Setup" value={`${done}/${total}`} meter={{ value: done, total }} />;
  },
  countdown: (ctx) => {
    const display = countdownDisplay(ctx.countdown, localDateISO(ctx.now));
    if (!display) return null;
    return <PulseTile ariaLabel="Countdown" label="Countdown" value={`${display.label} · ${display.when}`} />;
  },
};

/** Array order = render order within each group. Frozen public keys: renaming one orphans saved user prefs. */
export const HERO_MODULES: HeroModule[] = CORE_HERO_MODULES.map((m) => ({ ...m, render: RENDERS[m.key] }));

/** The registry minus modules whose feature is off: what the customize sheet lists. */
export function availableHeroModules(feature: (id: ModuleFeatureId) => boolean): HeroModule[] {
  return availableCoreHeroModules(feature, HERO_MODULES);
}
