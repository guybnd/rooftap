'use client';

// ── FLUX-242/253/269/281: top-of-home summary hero ─────────────────────────────
// Sits directly above TodayHero in the same top full-width slot — a true DOM
// sibling, not a wrapper.
// Hearth composition (FLUX-269): this container fuses the `day`-group modules
// into one whisper + one lede + one people line (gating each fragment on its
// own module's enabled flag), wraps the `home`-group modules in a 2x2 pulse
// tile grid, and renders `header`/`tips` groups via their own `render()`.
// Tap the ⚙ to open the customize sheet and toggle modules — writes land
// immediately, no debounce. (FLUX-281: the hold-to-edit long-press on the
// strip was removed — the gear icon is the sole entry point now.)
//
// Hearth v2 (day ribbon): the weather module is the sky block beside the
// Hero, opening an hourly ribbon under it (sky.tsx); tips are full-size
// lines with a glyph tile; the `home` group is one row of at most
// SHORTCUTS_CAP compact shortcuts, all off by default.
//
// Hearth v2 (Pulse + Feed): the lede is now a Hero count ("3 of 7 left
// today", the count module) on the ground under the coral glow, and the
// next-up item (the nextUp module) moved out of the lede into the Now card
// below it, which slides to finish and pages through the next few things.
// A dated checklist's card opens its list in place, with its own meter.

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, Bell, CalendarClock, MapPin, Navigation, Settings } from 'lucide-react';
import type { Checklist, ChecklistTaskItem, CostItem, HomeLensKey, HouseholdTask } from '@homeup/core';
import {
  buildDayRibbon,
  completion,
  heroItemEventDetails,
  heroItemOpenTarget,
  heroItemSectionId,
  mapsDirectionsUrl,
  pickNowQueue,
  skyHeadline,
  todayProgress,
  useModules,
} from '@homeup/core';
import { cn } from '@/lib/utils';
import { memberLabel } from '@/app/setup/member-label';
import { HeroLede } from '@/components/ui/hero-lede';
import { NowCardPager, type NowCardPagerItem } from '@/components/ui/now-card';
import { sectionIconFor } from '@/lib/section-icons';
import { TaskChecklistPanel } from '@/app/tasks/task-checklist-panel';
import { AvatarBubble, formatTime12h, type HeroItem, type MemberProfiles } from './hub-shared';
import { useWeather } from './use-weather';
import { useHeroModuleConfig } from './use-hero-module-config';
import {
  HERO_MODULES,
  isModuleShown,
  coarseCountdown,
  isCountdownDueSoon,
  whosOnHookBuckets,
  unassignedCount,
  type HeroModule,
  type HeroModuleContext,
  type HeroModuleGroup,
} from './hero-modules';
import { HeroCustomizeSheet } from './hero-customize-sheet';
import { DayRibbon, SkyBlock, SkyNote, useSkyRibbonOpen } from './sky';

const TIPS_CAP = 2;
/** Shortcuts (the `home` group) show one compact row of at most three. */
export const SHORTCUTS_CAP = 3;

/**
 * Density guardrail (FLUX-256, extracted for testability HOUP-14): caps
 * `modules` to `cap` *rendered* rows, in the given (registry priority) order.
 * Gates on actual render output, not just "enabled" — an
 * enabled-but-not-qualifying module (e.g. tipUv when UV is low) must not
 * steal a slot from a lower-priority module that does qualify.
 */
export function selectRenderedTips(
  modules: Pick<HeroModule, 'key' | 'render'>[],
  ctx: HeroModuleContext,
  cap: number = TIPS_CAP,
): { key: string; node: ReactNode }[] {
  const rendered: { key: string; node: ReactNode }[] = [];
  for (const m of modules) {
    if (rendered.length >= cap) break;
    const node = m.render?.(ctx);
    if (node) rendered.push({ key: m.key, node });
  }
  return rendered;
}

export function SummaryHero({
  lat,
  lng,
  todayCount,
  todayItems,
  memberProfiles,
  currentUserId,
  tasks,
  budgetCents,
  costItems,
  groceryToBuyCount,
  setup,
  shopperShortcut,
  today,
  onOpenItem,
  onCompleteItem,
  checklistsById,
  checklistItemsByChecklistId,
  lens,
  onLensChange,
  wide = false,
}: {
  lat: number | null;
  lng: number | null;
  todayCount: number;
  /** FLUX-254: today-scoped hero items — independent of the range picker (see page.tsx todayCount). */
  todayItems: HeroItem[];
  memberProfiles: MemberProfiles;
  currentUserId: string | null;
  /** FLUX-254: full task list (unfiltered by range) — only the streak module needs multi-day history. */
  tasks: HouseholdTask[];
  budgetCents: number | null;
  costItems: CostItem[];
  groceryToBuyCount: number;
  setup: { done: number; total: number };
  /** HOUP-434: the Shopper shortcut's figure, null with nothing watched. */
  shopperShortcut: string | null;
  /** 'YYYY-MM-DD', for picking the Now card's item. */
  today: string;
  /** Opens a hub item (core heroItemOpenTarget: checklist, reminder owner, task editor, listing, calendar event). */
  onOpenItem: (item: HeroItem) => void;
  /** Finishes a task or reminder from the Now card's slide. */
  onCompleteItem: (item: HeroItem) => void;
  /** Dated checklists by id and their items, so a checklist's Now card opens in place. Omit while task checklists are off. */
  checklistsById?: Record<string, Checklist>;
  checklistItemsByChecklistId?: Record<string, ChecklistTaskItem[]>;
  /** Hearth v2: the shortcut Home is filtered to (its Space, expanded); the Now card steps aside while one is open. */
  lens: HomeLensKey | null;
  onLensChange: (lens: HomeLensKey | null) => void;
  /**
   * Hearth §13 "Desktop shell": a wide screen lays the summary out as a row,
   * the lede on the left and the day ribbon (always open, there is room)
   * over the Now card on the right, finished with a button, not a slide.
   */
  wide?: boolean;
}) {
  const { data: weather, error: weatherError } = useWeather(lat, lng);
  const { config, setModule, countdown, setCountdown, flushCountdown } = useHeroModuleConfig();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Modules: budget, bills, groceries, setup and the task-only modules need
  // their module (module-features.ts), whatever the person's config says.
  const modules = useModules();
  const isOn = (key: string) => isModuleShown(key, config, modules.feature);

  const ctx: HeroModuleContext = {
    todayCount,
    weather,
    todayItems,
    memberProfiles,
    currentUserId,
    tasks,
    now: new Date(),
    budgetCents,
    costItems,
    groceryToBuyCount,
    setup,
    shopperShortcut,
    countdown,
    lens,
    // Tapping the open lens's shortcut again returns to Today.
    onLens: (key) => onLensChange(lens === key ? null : key),
  };
  const modulesIn = (group: HeroModuleGroup) =>
    HERO_MODULES.filter((m) => m.group === group && isOn(m.key));

  // selectRenderedTips caps by what actually renders, so an empty shortcut
  // (no bills this week) doesn't take one of the three slots.
  const shortcuts = selectRenderedTips(modulesIn('home'), ctx, SHORTCUTS_CAP);
  // A lens whose shortcut has gone (the list emptied, the module was
  // switched off) closes, so Home never sits filtered with no way back.
  const lensShortcutShown = lens != null && shortcuts.some((t) => t.key === lens);
  useEffect(() => {
    if (lens && !lensShortcutShown) onLensChange(null);
  }, [lens, lensShortcutShown, onLensChange]);
  const renderedTips = selectRenderedTips(modulesIn('tips'), ctx);

  const [ribbonPref, toggleRibbon] = useSkyRibbonOpen();
  const ribbonOpen = wide || ribbonPref;
  const sky = isOn('weather') ? weather : null;
  const showSky = sky != null;
  const ribbon = sky ? buildDayRibbon(sky, todayItems.filter((i) => i.dueTime && !i.done).map((i) => `${today}T${i.dueTime}`), { long: wide }) : [];
  const headline = sky ? skyHeadline(sky, ctx.now).text : '';
  // Weather on but nothing to show: say why instead of leaving the spot empty.
  const skyNote: 'noLocation' | 'unavailable' | null =
    !isOn('weather') || weather ? null : lat == null || lng == null ? 'noLocation' : weatherError ? 'unavailable' : null;

  // FLUX-269 (Hearth H1/H6): the day group fuses into one whisper + one lede +
  // one people line — each fragment gated on its own module's enabled flag so
  // disabling e.g. just `unassignedNudge` only drops its chip, not the row.
  // Hearth v2: the lede is the Hero count (core todayProgress); the Now card
  // pages through the next few things (core pickNowQueue).
  const countEnabled = isOn('count');
  const progress = todayProgress(ctx.todayItems);
  const nowQueue = isOn('nextUp') ? pickNowQueue(ctx.todayItems, today) : [];

  const { assigneeIds, countFor } = whosOnHookBuckets(ctx);
  const showWhosOnHook = isOn('whosOnHook') && assigneeIds.length > 0;
  const unassigned = unassignedCount(ctx);
  const showUnassignedChip = isOn('unassignedNudge') && unassigned > 0;

  const streakModule = HERO_MODULES.find((m) => m.key === 'streak');
  const streakEnabled = isOn('streak');

  const lede = !countEnabled ? null : progress.left === 0 ? (
    <HeroLede value="All clear" caption={progress.done > 0 ? `${progress.done} done today` : 'Nothing on today'} />
  ) : (
    <HeroLede
      size="home"
      value={progress.left}
      label={`of ${progress.total} left today`}
      meter={{ done: progress.done, total: progress.total }}
    />
  );

  const peopleLine =
    showWhosOnHook || showUnassignedChip ? (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-foreground" aria-label="Who's on it">
        {showWhosOnHook &&
          assigneeIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1.5">
              <AvatarBubble userId={id} profiles={ctx.memberProfiles} size={18} />
              <span>
                {id === ctx.currentUserId ? 'You' : memberLabel(id, ctx.memberProfiles)}{' '}
                <span className="tabular-nums">{countFor(id)}</span>
              </span>
            </span>
          ))}
        {showUnassignedChip && (
          <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
            <span className="tabular-nums">{unassigned}</span>&nbsp;unassigned
          </span>
        )}
      </div>
    ) : null;

  // One page per queued item: its section tile, what kind of "now" it is, and
  // a coarse countdown on a timed item, warning-tinted within the hour.
  const nowCards: NowCardPagerItem[] = nowQueue.map((item) => {
    const countdown = item.dueTime && !item.overdue ? coarseCountdown(ctx.now, item.dueTime) : null;
    const dueSoon = countdown ? isCountdownDueSoon(countdown) : false;
    const section = heroItemSectionId(item);
    const linkedId = item.checklistHref ? item.task?.linked_checklist_id : null;
    const checklist = linkedId ? checklistsById?.[linkedId] : undefined;
    const checklistItems = checklist ? (checklistItemsByChecklistId?.[checklist.id] ?? []) : [];
    const eyebrow = item.overdue
      ? { text: 'Overdue', tone: 'danger' as const }
      : item.dueTime
        ? { text: dueSoon ? 'Now' : 'Next up', tone: dueSoon ? ('warning' as const) : ('muted' as const) }
        : { text: 'Today', tone: 'muted' as const };
    return {
      id: item.id,
      sectionId: section,
      Icon: item.type === 'appointment' ? CalendarClock : section === 'household' && item.type === 'reminder' ? Bell : sectionIconFor(section),
      eyebrow: eyebrow.text,
      eyebrowTone: eyebrow.tone,
      title: item.title,
      meta: (
        <>
          {item.dueTime && !item.overdue && (
            <span className={cn('font-mono text-xs font-medium tabular-nums', dueSoon ? 'text-warning' : 'text-muted-foreground')}>
              {formatTime12h(item.dueTime)}
              {countdown && countdown !== 'now' ? ` · ${countdown}` : ''}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{item.sourceLabel}</span>
        </>
      ),
      progress: checklist ? completion(checklistItems) : null,
      body: checklist ? <TaskChecklistPanel checklist={checklist} items={checklistItems} currentUserId={currentUserId} /> : undefined,
      onOpen: heroItemOpenTarget(item) ? () => onOpenItem(item) : undefined,
      onComplete: item.task && !item.task.done ? () => onCompleteItem(item) : undefined,
      footer: item.task ? undefined : (
        <EventCardFooter item={item} onOpen={heroItemOpenTarget(item) ? () => onOpenItem(item) : undefined} />
      ),
    };
  });

  const ribbonNode =
    showSky && ribbonOpen && ribbon.length > 0 ? (
      <div className="relative z-10">
        <DayRibbon hours={ribbon} scroll={wide && ribbon.length > 12} />
      </div>
    ) : null;
  const nowNode =
    !lens && nowCards.length > 0 ? <NowCardPager items={nowCards} finishAs={wide ? 'button' : 'slide'} /> : null;
  const aside = wide && (ribbonNode || nowNode);

  return (
    <>
      {/* Hearth v2 (Pulse): no card around the lede; it sits on the ground
          under the coral glow. */}
      <div className={cn(aside && 'grid grid-cols-12 items-start gap-x-10 gap-y-4')}>
      <section className={cn('relative flex flex-col gap-3 px-1 pt-1', aside && 'col-span-5')} aria-label="Today summary">
        <div className="relative z-10 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {ctx.now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Customize summary"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
        {(lede || showSky || skyNote) && (
          <div className="relative z-10 flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1">{lede}</div>
            {sky && (
              <SkyBlock
                weather={sky}
                headline={headline}
                open={ribbonOpen}
                onToggle={toggleRibbon}
                canExpand={!wide && ribbon.length > 0}
              />
            )}
            {skyNote && <SkyNote reason={skyNote} />}
          </div>
        )}
        {!wide && ribbonNode}
        {(peopleLine || streakEnabled) && (
          <div className="relative z-10 flex flex-col gap-2">
            {peopleLine}
            {streakEnabled && streakModule?.render?.(ctx)}
          </div>
        )}
        {renderedTips.map((t) => (
          <div key={t.key} className="relative z-10">
            {t.node}
          </div>
        ))}
        {shortcuts.length > 0 && (
          <div className="relative z-10 grid grid-cols-3 gap-2 [&>*]:bg-card/70" aria-label="Shortcuts">
            {shortcuts.map((t) => (
              <Fragment key={t.key}>{t.node}</Fragment>
            ))}
          </div>
        )}
      </section>
      {aside ? (
        <div className="col-span-7 flex min-w-0 flex-col gap-4 pt-1">
          {ribbonNode}
          {nowNode}
        </div>
      ) : null}
      </div>
      {!wide && nowNode}
      <HeroCustomizeSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        config={config}
        onToggle={setModule}
        countdown={countdown}
        onCountdownChange={setCountdown}
        onCountdownFlush={flushCountdown}
      />
    </>
  );
}

/**
 * The foot of a Now card that can't be finished (an event or a viewing),
 * where a to-do has its slide track: where it is and when it ends, then Open
 * and Directions. Native twin: EventCardFooter in apps/mobile's Home screen.
 */
function EventCardFooter({ item, onOpen }: { item: HeroItem; onOpen?: () => void }) {
  const { location, endsAt, travelMode } = heroItemEventDetails(item);
  // A viewing's place is already its title.
  const place = item.appointment ? null : location;
  if (!onOpen && !location) return null;
  const pill =
    'inline-flex h-10 items-center gap-2 rounded-full bg-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div className="flex flex-col gap-3">
      {(place || endsAt) && (
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          {place && <MapPin aria-hidden className="size-4 shrink-0" />}
          <span className="truncate">
            {place}
            {place && endsAt ? ' · ' : ''}
            {endsAt && <span className="tabular-nums">Until {formatTime12h(endsAt)}</span>}
          </span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {onOpen && (
          <button type="button" onClick={onOpen} className={pill}>
            <ArrowUpRight aria-hidden className="size-4" />
            Open
          </button>
        )}
        {location && (
          <a href={mapsDirectionsUrl(location, travelMode)} target="_blank" rel="noopener noreferrer" className={pill}>
            <Navigation aria-hidden className="size-4" />
            Directions
          </a>
        )}
      </div>
    </div>
  );
}
