'use client';

// ── FLUX-155: the "Today" hero — the hub's dominant element ─────────────────────
// Converges tasks + reminders + appointments/calendar events into one list with
// composable filters (a Today/Week/Month range picker, type tabs, Mine) and
// in-place gestures. FLUX-236 replaced the old title+stat-pills row with a
// fill-the-row range picker and grouped Week/Month by day.
// FLUX-180 reworked the open-row gestures so a plain tap can no longer complete:
//   OPEN row:  tap = open the task modal · swipe right = done · swipe left = snooze
//              (1h/1d/1w) · long-press (~500ms) = open the quick-edit menu (FLUX-239),
//              with a "loading into edit" fill sweeping in from both ends (after a
//              ~100ms grace).
//   DONE row:  tap OR swipe right = undo (safe/reversible; no snooze). Sinks to the
//              bottom of the list (Today) / its own day-group (Week/Month) after a
//              short delay (FLUX-239).
//   Appointments are inert (events).
// One swipe implementation — SwipeActions, shared across every row consumer.
// Hearth v2 (Feed): every range groups as a feed (core groupFeedItems:
// Earlier, Today, Tomorrow, weekdays, then No date) and rows lead with their
// section's identity tile (core heroItemSectionId).
// Hearth v2 (heading menu): the range tabs and filter row became one line.
// The feed's title is its range picker ("Upcoming 7", a menu of ranges with
// their counts) and the type and "just me" filters sit behind one filter
// button that wears a coral dot while any is on. Quick add went: the tab
// bar's + already adds.

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Check,
  ClipboardList,
  Bell,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  LayoutGrid,
  ChevronRight,
  ExternalLink,
  EyeOff,
  Navigation,
  SlidersHorizontal,
  X,
  Plus,
  ListChecks,
  ListTodo,
  Wallet,
} from 'lucide-react';
import { PopMenu, MenuItem, MenuLabel, MenuDivider } from '@/app/setup/pop-menu';
import { SwipeActions, type SwipeConfig } from '@/components/ui/swipe-actions';
import {
  ListItem,
  ListGroup,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
} from '@/components/ui/list-item';
import { LeadingTile } from '@/components/ui/leading-tile';
import { sectionIconFor } from '@/lib/section-icons';
import { iconAndLabelForCode, type WeatherData } from './use-weather';
import {
  AvatarBubble,
  formatTime12h,
  type HeroItem,
  type HeroRange,
} from './hub-shared';
import { HeroTaskRow, useRowLongPress, type SnoozeDuration } from '../tasks/task-row';
import { useRowContextMenu, withRowMenu } from '@/components/ui/row-context-menu';
import type { Checklist, ChecklistTaskItem, GroupEvent, GroupMember, HouseholdTask } from '@homeup/core';
import {
  HERO_RANGES,
  HERO_RANGE_LABEL,
  mapsDirectionsUrl,
  compareStrings,
  feedRowWhen,
  filterHeroFeed,
  groupFeedItems,
  weekBoardColumns,
  feedDayLabel,
  type RowActionIcon,
  type WeekBoardColumn,
  heroItemSectionId,
  heroRangeCounts,
  isHeroFeedFiltered,
  openCount,
  todayISO,
  type HeroTypeFilter,
} from '@homeup/core';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

type TypeFilter = HeroTypeFilter;

interface TodayHeroProps {
  items: HeroItem[];
  /** The board's per-day add: what can be added (by module), and the add itself. */
  addOnDayKinds?: readonly AddOnDayKind[];
  onAddOnDay?: (kind: AddOnDayKind['id'], dateISO: string) => void;
  profiles: MemberProfiles;
  currentUserId: string | null;
  /** Tasks can show: hides the Tasks link and the Tasks and Reminders type filters when false
   *  (bill and document reminders can still show, under All, see task-modules.ts). */
  householdVisible: boolean;
  /** Viewings can show: hides the Appts type tab when false. */
  searchVisible: boolean;
  /** Modules: pulled calendar events can show ('hub.calendar-events'): hides the Cal type tab when false. */
  calendarVisible: boolean;
  /** Modules: the household's own events can show ('hub.events'): hides the Events type tab when false. */
  eventsVisible?: boolean;
  /** 'YYYY-MM-DD', for marking the current day in Week/Month grouping. */
  today: string;
  range: HeroRange;
  onRangeChange: (range: HeroRange) => void;
  /** The feed for any range, for the range menu's counts (`items` is the current range's). */
  itemsForRange: (range: HeroRange) => HeroItem[];
  onToggle: (item: HeroItem) => void;
  onSnooze: (item: HeroItem, dur: SnoozeDuration) => void;
  onEdit: (item: HeroItem) => void;
  /** FLUX-235: dismiss a pulled calendar row from the hero (per-device, calendar rows only). */
  onDismissCalendar: (item: HeroItem) => void;
  /** A household event's row: hold or right-click edits it, swiping left hides it from Home. */
  onEditEvent?: (event: GroupEvent) => void;
  onHideEvent?: (event: GroupEvent) => void;
  /** FLUX-239: persist an inline field edit (currently due_date) from a hero row's
   *  hold quick-edit menu. Optional — omit to leave that menu's date item hidden. */
  onUpdate?: (item: HeroItem, patch: Partial<HouseholdTask>) => void;
  /** FLUX-245: group members for the quick-edit menu's inline Assignee panel. */
  groupMembers: GroupMember[];
  /** FLUX-245: soft-delete from a hero row's quick-edit menu. Optional — omit to
   *  leave that menu's Delete item hidden. */
  onRequestDelete?: (item: HeroItem) => void;
  /** FLUX-1565: task.linked_checklist_id → checklist, for HeroTaskRow's inline
   *  expand panel (mirrors TaskRow's checklistsById on /tasks). */
  checklistsById?: Record<string, Checklist>;
  /** FLUX-1565: checklist id → its live items, for the same inline panel. */
  checklistItemsByChecklistId?: Record<string, ChecklistTaskItem[]>;
  /**
   * Hearth §13 "Desktop shell": 'board' lays the agenda out as a week of day
   * columns (core weekBoardColumns) for a wide screen; 'feed' is the phone's
   * one list. Same rows, gestures and filters either way.
   */
  layout?: 'feed' | 'board';
  /** The range's last day, so the board doesn't draw days the range leaves out. */
  windowEnd?: string;
  /** The week's forecast for the board's day headers (soft-optional, see core WeatherData.days). */
  weatherDays?: WeatherData['days'];
}

// FLUX-239: done rows sink last — factored once so the flat (Today) sort and the
// grouped (Week/Month) per-day-bucket sort can't drift apart. Ties fall through to
// the pre-existing overdue → dueDate → dueTime → title order.
function compareHeroItems(a: HeroItem, b: HeroItem, isToday: boolean): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (isToday) {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  } else {
    // Week/Month: chronological by day (undated items sort last, grouped separately below).
    const ad = a.dueDate ?? '9999-99-99';
    const bd = b.dueDate ?? '9999-99-99';
    if (ad !== bd) return ad.localeCompare(bd);
  }
  const at = a.dueTime ?? '';
  const bt = b.dueTime ?? '';
  if (!at && bt) return -1;
  if (at && !bt) return 1;
  if (at !== bt) return at < bt ? -1 : 1;
  return compareStrings(a.title, b.title);
}


// FLUX-235: swipe-left = dismiss, the only gesture a pulled calendar row gets
// (it's otherwise inert — no tap/hold/complete). Matches the swipe contract
// every other hero row uses instead of a bespoke tap target.
const DISMISS_CFG: SwipeConfig = {
  bg: 'bg-muted-foreground/70',
  activeBg: 'bg-muted-foreground',
  icon: <X className="h-5 w-5 text-white" />,
  label: 'Dismiss',
};

export function TodayHero({
  items,
  profiles,
  currentUserId,
  householdVisible,
  searchVisible,
  calendarVisible,
  eventsVisible = false,
  today,
  range,
  onRangeChange,
  itemsForRange,
  onToggle,
  onSnooze,
  onEdit,
  onDismissCalendar,
  onEditEvent,
  onHideEvent,
  onUpdate,
  groupMembers,
  onRequestDelete,
  checklistsById,
  checklistItemsByChecklistId,
  layout = 'feed',
  windowEnd,
  weatherDays,
  addOnDayKinds = [],
  onAddOnDay,
}: TodayHeroProps) {
  const router = useRouter();
  const board = layout === 'board';
  const boardRef = useRef<HTMLDivElement>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [mineOnly, setMineOnly] = useState(false);

  // Available type options respect hiddenSections (household → task/reminder, search → appt)
  // and modules (calendar → cal, module-features.ts 'hub.calendar-events').
  const typeOptions: { key: TypeFilter; label: string; icon: typeof Check }[] = [
    { key: 'all', label: 'All', icon: LayoutGrid },
    ...(householdVisible
      ? ([
          { key: 'task', label: 'Tasks', icon: ClipboardList },
          { key: 'reminder', label: 'Reminders', icon: Bell },
        ] as const)
      : []),
    ...(eventsVisible ? ([{ key: 'event', label: 'Events', icon: CalendarDays }] as const) : []),
    ...(searchVisible ? ([{ key: 'appointment', label: 'Viewings', icon: CalendarClock }] as const) : []),
    ...(calendarVisible ? ([{ key: 'calendar', label: 'Calendar', icon: CalendarDays }] as const) : []),
  ];
  // Modules: a tab that went away (say Tasks switched off) falls back to All,
  // where bill and document reminders still show.
  const activeType: TypeFilter = typeOptions.some((o) => o.key === typeFilter) ? typeFilter : 'all';

  // Type + Mine slice.
  const filter = { type: activeType, mineOnly, userId: currentUserId };
  const sliced = filterHeroFeed(items, filter);
  const filtered = isHeroFeedFiltered(filter);
  // The range menu's counts, under the same filter as the feed.
  const rangeCounts = useMemo(
    () => heroRangeCounts(itemsForRange, { type: activeType, mineOnly, userId: currentUserId }),
    [itemsForRange, activeType, mineOnly, currentUserId]
  );

  const isToday = range === 'today';
  // FLUX-239: done rows sink last (compareHeroItems), both here (sinks to the
  // bottom of the whole Today list) and — since the Week/Month grouping below
  // buckets this same sorted `visible` array by dueDate — within each day-group.
  const visible = [...sliced].sort((a, b) => compareHeroItems(a, b, isToday));

  // Hearth v2 (Feed): bucket into feed groups for every range — Earlier
  // (overdue), each day, then undated. Item order inside a group is `visible`'s.
  const feedGroups = useMemo(() => groupFeedItems(visible, today), [visible, today]);
  const boardColumns = useMemo(
    () => (board ? weekBoardColumns(visible, today, windowEnd ?? today, 7, { collapseQuiet: true }) : []),
    [board, visible, today, windowEnd]
  );
  const boardFit = useBoardFit(boardRef, boardColumns);
  // A day's add opens a small menu of what can go on that day, at the pointer.
  const addDateRef = useRef<string | null>(null);
  const addMenu = useRowContextMenu(() =>
    addDateRef.current && onAddOnDay && addOnDayKinds.length
      ? {
          title: `Add to ${feedDayLabel(addDateRef.current, today)}`,
          actions: addOnDayKinds.map((k) => ({
            id: k.id,
            label: k.label,
            group: 'open' as const,
            icon: ADD_KIND_ICON[k.id],
            run: () => onAddOnDay(k.id, addDateRef.current!),
          })),
        }
      : null
  );
  const addOnDay =
    onAddOnDay && addOnDayKinds.length
      ? (dateISO: string, e: React.MouseEvent) => {
          addDateRef.current = dateISO;
          // A keyboard press has no pointer: open under the button instead.
          const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const keyboard = e.clientX === 0 && e.clientY === 0;
          addMenu.openAt(keyboard ? box.left : e.clientX, keyboard ? box.bottom + 4 : e.clientY);
        }
      : undefined;
  // The arrows move one whole day; snap keeps the days aligned.
  const scrollBoard = (dir: 1 | -1) => boardFit.jumpTo(boardFit.first + dir);
  const rowProps = {
    profiles,
    groupMembers,
    onToggle,
    onSnooze,
    onEdit,
    onUpdate,
    onRequestDelete,
    onDismissCalendar,
    onEditEvent,
    onHideEvent,
    currentUserId,
    checklistsById,
    checklistItemsByChecklistId,
  };

  // H6: the heading counts what is still to do in the visible (filtered) set,
  // the same figure its menu shows beside the current range.
  const count = openCount(visible);

  return (
    // Hearth v2 (Feed, H4): the feed sits on the ground; each day is its own
    // card under a micro-label day header, so no card nests in another.
    <section className="flex flex-col" aria-label="Agenda">
      {/* H5: the heading is the range picker and the filter button sits at
          its end, so every control that scopes this list is on its title line. */}
      <FeedHeading
        title={
          <PopMenu
            align="left"
            width="w-56"
            mobileSheet
            triggerLabel={`${HERO_RANGE_LABEL[range]}, ${count} to do. Change range`}
            triggerClassName="-ml-1 inline-flex min-h-[44px] min-w-0 items-center gap-2 rounded-lg px-1 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            trigger={
              <>
                <FeedHeadingTitle>{HERO_RANGE_LABEL[range]}</FeedHeadingTitle>
                <span className="font-mono text-sm tabular-nums text-muted-foreground">{count}</span>
                <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              </>
            }
          >
            {(close) =>
              HERO_RANGES.map((r) => (
                <MenuItem
                  key={r}
                  active={r === range}
                  onClick={() => {
                    onRangeChange(r);
                    close();
                  }}
                  trailing={
                    <span className={cn('font-mono text-xs tabular-nums', r === range ? 'text-primary' : 'text-muted-foreground')}>
                      {rangeCounts[r]}
                    </span>
                  }
                >
                  {HERO_RANGE_LABEL[r]}
                </MenuItem>
              ))
            }
          </PopMenu>
        }
        trailing={
          <div className="flex shrink-0 items-center gap-1">
          {/* On the board the way into Tasks sits up here, where there is room,
              so it never adds a line under the columns (Guy, 2026-10-22). */}
          {board && householdVisible && (
            <button
              type="button"
              onClick={() => router.push('/tasks')}
              className="mr-1 inline-flex h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-primary hover:bg-card/70 hover:text-primary/80"
            >
              All tasks
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          {board && boardColumns.length > boardFit.perView && (
            <>
              <button type="button" aria-label="Earlier days" disabled={boardFit.first === 0} onClick={() => scrollBoard(-1)} className={BOARD_ARROW}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <BoardDays
                columns={boardColumns}
                first={boardFit.first}
                perView={boardFit.perView}
                today={today}
                onJump={boardFit.jumpTo}
              />
              <button
                type="button"
                aria-label="Later days"
                disabled={boardFit.first + boardFit.perView >= boardColumns.length}
                onClick={() => scrollBoard(1)}
                className={BOARD_ARROW}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
          <PopMenu
            align="right"
            width="w-56"
            mobileSheet
            triggerLabel={filtered ? 'Filters, on' : 'Filters'}
            triggerClassName="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card/70 text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            trigger={
              <>
                <SlidersHorizontal aria-hidden className="h-4 w-4" />
                {filtered && <span aria-hidden className="absolute right-2.5 top-2.5 size-2 rounded-full bg-primary ring-2 ring-background" />}
              </>
            }
          >
            {(close) => (
              <>
                {typeOptions.length > 1 && (
                  <>
                    <MenuLabel>Type</MenuLabel>
                    {typeOptions.map((o) => {
                      const Icon = o.icon;
                      return (
                        <MenuItem
                          key={o.key}
                          active={o.key === activeType}
                          icon={<Icon className="h-4 w-4" />}
                          onClick={() => {
                            setTypeFilter(o.key);
                            close();
                          }}
                        >
                          {o.label}
                        </MenuItem>
                      );
                    })}
                    <MenuDivider />
                  </>
                )}
                <MenuLabel>People</MenuLabel>
                <MenuItem
                  active={mineOnly}
                  icon={<AvatarBubble userId={currentUserId} profiles={profiles} size={16} />}
                  onClick={() => {
                    setMineOnly((v) => !v);
                    close();
                  }}
                >
                  Just me
                </MenuItem>
              </>
            )}
          </PopMenu>
          </div>
        }
      />

      {/* List */}
      <div id="heroList">
        {board && boardColumns.length > 0 ? (
          <>
          <div
            ref={boardRef}
            // The arrows and dots above page the board, so it hides its bar.
            // A column is narrow: titles wrap instead of truncating, and an
            // assignee shows as their avatar alone.
            style={{ gridAutoColumns: boardFit.colW ? `${boardFit.colW}px` : undefined }}
            className="-mx-1 mt-2 grid snap-x snap-mandatory scroll-px-1 auto-cols-[minmax(288px,1fr)] grid-flow-col items-start gap-4 overflow-x-auto px-1 pb-3 scroll-quiet [&_[data-assignee-name]]:!hidden [&_[data-slot=list-item-title]]:whitespace-normal [&_[data-slot=list-item-title]_*]:whitespace-normal"
          >
            {boardColumns.map((column) => (
              column.quiet ? (
                <QuietColumn key={column.key} column={column} onAdd={addOnDay} />
              ) : (
              <BoardColumn key={column.key} column={column} today={today} weatherDays={weatherDays} onAdd={addOnDay}>
                {column.items.map((item) => (
                  <HeroRow key={item.id} item={item} {...rowProps} />
                ))}
              </BoardColumn>
              )
            ))}
          </div>
          {addMenu.menu}
          </>
        ) : visible.length === 0 ? (
          <div className="mt-2 rounded-3xl border border-border/60 bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-[var(--card-shadow)]">
            {items.length === 0
              ? householdVisible
                ? 'Nothing on the agenda. Add a task above to get started.'
                : 'Nothing on the agenda.'
              : 'No items match the current filters.'}
          </div>
        ) : (
          feedGroups.map((feedGroup) => (
            <div key={feedGroup.key} className="pt-4 first:pt-2">
              <FeedHeader
                groupKey={feedGroup.key}
                label={feedGroup.label}
                addKinds={/^\d{4}-\d{2}-\d{2}$/.test(feedGroup.key) && onAddOnDay ? addOnDayKinds : undefined}
                onAdd={(kind) => onAddOnDay?.(kind, feedGroup.key)}
              />
              <ListGroup>
                {feedGroup.items.map((item) => (
                  <HeroRow key={item.id} item={item} {...rowProps} />
                ))}
              </ListGroup>
            </div>
          ))
        )}
      </div>

      {/* The way into the full Tasks page (the phone tab bar has no Tasks
          tab), as a quiet link under the feed rather than a toolbar icon. */}
      {householdVisible && !board && (
        <button
          type="button"
          onClick={() => router.push('/tasks')}
          className="mt-3 inline-flex min-h-[44px] items-center gap-1 self-start rounded-lg px-1 text-sm font-medium text-primary hover:text-primary/80"
        >
          All tasks
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </section>
  );
}

const BOARD_ARROW =
  'flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30';

// Hearth §13 "Desktop shell": one day of the week board. Its header names
// the day, its date and (when the server sends a forecast) the day's sky,
// so the week reads like a planner; its items sit in one card under it, as
// a feed day does (H4: no card in a card). An empty day says so quietly.
function BoardColumn({
  column,
  today,
  weatherDays,
  onAdd,
  children,
}: {
  column: WeekBoardColumn;
  today: string;
  weatherDays?: WeatherData['days'];
  onAdd?: (dateISO: string, e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  const add = column.date && onAdd ? (e: React.MouseEvent) => onAdd(column.date!, e) : undefined;
  const isToday = column.date === today;
  const dayIndex = column.date && weatherDays ? weatherDays.dates.indexOf(column.date) : -1;
  const sky =
    dayIndex >= 0 && weatherDays
      ? {
          ...iconAndLabelForCode(weatherDays.weatherCode[dayIndex]),
          high: Math.round(weatherDays.highC[dayIndex]),
          low: Math.round(weatherDays.lowC[dayIndex]),
          rain: weatherDays.precipitationProbabilityMax[dayIndex],
        }
      : null;
  const dayNumber = column.date ? Number(column.date.slice(8, 10)) : null;
  return (
    <section
      data-board-column
      aria-label={column.label}
      // A double-click on the day's free space adds to it, as on the Calendar.
      onDoubleClick={add ? (e) => !(e.target as HTMLElement).closest('a, button, [data-slot=list-item]') && add(e) : undefined}
      className="group/day flex min-h-40 min-w-0 snap-start flex-col gap-2"
    >
      <header className="flex min-h-12 items-end justify-between gap-2 px-1">
        <div className="flex min-w-0 items-baseline gap-2">
          {dayNumber != null && (
            <span
              className={cn(
                'font-heading text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
                isToday ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {dayNumber}
            </span>
          )}
          <span
            className={cn(
              'truncate text-[10.5px] font-semibold uppercase tracking-[0.1em]',
              column.key === 'earlier' ? 'text-destructive' : isToday ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {column.label}
          </span>
        </div>
        {sky && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" title={sky.label}>
            <sky.Icon aria-label={sky.label} className="h-4 w-4" />
            <span className="font-mono tabular-nums">
              {sky.high}° / {sky.low}°
            </span>
            {sky.rain >= 30 && <span className="font-mono tabular-nums">{sky.rain}%</span>}
          </span>
        )}
        {add && (
          <button
            type="button"
            aria-label={`Add to ${column.label}`}
            title="Add to this day"
            onClick={add}
            className="-mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-card hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/day:opacity-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </header>
      {column.items.length > 0 ? (
        <ListGroup>{children}</ListGroup>
      ) : (
        <p className="px-1 py-3 text-sm text-muted-foreground/70">Nothing on</p>
      )}
    </section>
  );
}

// Hearth v2 (heading menu): the feed's title line. The title is the surface's section heading, so it reads at heading size.
export function FeedHeading({ title, trailing }: { title: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3 px-1">
      <div className="flex min-w-0 items-center">{title}</div>
      {trailing}
    </div>
  );
}

export function FeedHeadingTitle({ children }: { children: ReactNode }) {
  return <h2 className="truncate font-heading text-[22px] font-semibold leading-tight tracking-[-0.01em] text-foreground">{children}</h2>;
}

// Hearth v2 (Feed): the feed's day header (core feedDayLabel). Earlier is
// the overdue pile, so it reads in the danger hue (status hue as text, H2).
function FeedHeader({
  groupKey,
  label,
  addKinds,
  onAdd,
}: {
  groupKey: string;
  label: string;
  /** A day's add (portrait twin of the week board's +): what it can add. */
  addKinds?: readonly AddOnDayKind[];
  onAdd?: (kind: AddOnDayKind['id']) => void;
}) {
  return (
    <div className="mb-1.5 flex min-h-6 items-center justify-between gap-2 px-1">
      <span
        className={cn(
          'text-[10.5px] font-semibold uppercase tracking-[0.1em]',
          groupKey === 'earlier' ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {label}
      </span>
      {addKinds && addKinds.length > 0 && onAdd && (
        <PopMenu
          align="right"
          width="w-48"
          mobileSheet
          triggerLabel={`Add to ${label}`}
          // The 44pt target reaches past the small glyph (H1 touch size).
          triggerClassName="-my-2.5 -mr-2 flex h-11 w-11 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          trigger={<Plus className="h-4 w-4" />}
        >
          {(close) => (
            <>
              <MenuLabel>Add to {label}</MenuLabel>
              {addKinds.map((k) => {
                const Icon = ADD_KIND_GLYPH[k.id];
                return (
                  <MenuItem
                    key={k.id}
                    icon={<Icon className="h-4 w-4" />}
                    onClick={() => {
                      close();
                      onAdd(k.id);
                    }}
                  >
                    {k.label}
                  </MenuItem>
                );
              })}
            </>
          )}
        </PopMenu>
      )}
    </div>
  );
}

// ── A single hero row. Mutable task/reminder items delegate to the shared
//    HeroTaskRow (FLUX-234, src/app/tasks/task-row.tsx) for hold+swipe+snooze;
//    inert appointment/calendar items never gesture, so they stay a plain,
//    hub-local row here. ─────────────────────────────────────────────────────
function HeroRow({
  item,
  profiles,
  groupMembers,
  onToggle,
  onSnooze,
  onEdit,
  onUpdate,
  onRequestDelete,
  onDismissCalendar,
  onEditEvent,
  onHideEvent,
  currentUserId,
  checklistsById,
  checklistItemsByChecklistId,
}: {
  item: HeroItem;
  profiles: MemberProfiles;
  groupMembers: GroupMember[];
  onToggle: (item: HeroItem) => void;
  onSnooze: (item: HeroItem, dur: SnoozeDuration) => void;
  onEdit: (item: HeroItem) => void;
  onUpdate?: (item: HeroItem, patch: Partial<HouseholdTask>) => void;
  onRequestDelete?: (item: HeroItem) => void;
  onDismissCalendar: (item: HeroItem) => void;
  onEditEvent?: (event: GroupEvent) => void;
  onHideEvent?: (event: GroupEvent) => void;
  currentUserId?: string | null;
  checklistsById?: Record<string, Checklist>;
  checklistItemsByChecklistId?: Record<string, ChecklistTaskItem[]>;
}) {
  const router = useRouter();
  const inert = item.type === 'appointment' || item.type === 'calendar' || item.type === 'event';

  // Hearth §13.7 "Row menu": events and viewings get the shared right-click
  // menu too (task rows build theirs in HeroTaskRow).
  const rowMenu = useRowContextMenu(() => {
    if (!inert) return null;
    const ev = item.groupEvent;
    const place = ev?.location?.trim() || (item.appointment ? item.title : '');
    const day = item.dueDate;
    return {
      title: item.title,
      kind: item.appointment ? 'Viewing' : ev ? 'Event' : 'Calendar event',
      actions: [
        item.appointment && { id: 'listing', label: 'Open listing', group: 'open', icon: 'open', run: () => router.push(`/apartment/${item.appointment!.apartment_id}`) },
        !!day && { id: 'day', label: 'Show in calendar', group: 'open', icon: 'calendar', run: () => router.push(`/calendar?date=${day}`) },
        !!item.googleEvent?.html_link && {
          id: 'google',
          label: 'Open in Google Calendar',
          group: 'open',
          icon: 'open',
          run: () => window.open(item.googleEvent!.html_link as string, '_blank', 'noopener'),
        },
        !!place && { id: 'directions', label: 'Directions', group: 'share', icon: 'directions', run: () => window.open(mapsDirectionsUrl(place, ev?.travel_mode), '_blank', 'noopener') },
        !!place && { id: 'copy', label: 'Copy address', group: 'share', icon: 'copy', run: () => void navigator.clipboard?.writeText(place) },
        ev && onEditEvent && { id: 'edit', label: 'Edit event', group: 'edit', icon: 'edit', run: () => onEditEvent(ev) },
        ev && onHideEvent && { id: 'hide', label: 'Hide from Home', group: 'danger', icon: 'hide', run: () => onHideEvent(ev) },
        item.type === 'calendar' && { id: 'dismiss', label: 'Dismiss from Home', group: 'danger', icon: 'hide', run: () => onDismissCalendar(item) },
      ],
    };
  });

  if (!inert) {
    return (
      <HeroTaskRow
        item={item}
        profiles={profiles}
        groupMembers={groupMembers}
        onToggle={onToggle}
        onSnooze={onSnooze}
        onEdit={onEdit}
        onUpdate={onUpdate}
        onRequestDelete={onRequestDelete}
        currentUserId={currentUserId}
        checklistsById={checklistsById}
        checklistItemsByChecklistId={checklistItemsByChecklistId}
      />
    );
  }

  const tileSection = heroItemSectionId(item);
  const Icon = item.type === 'appointment' ? CalendarClock : sectionIconFor(tileSection);
  const when = feedRowWhen(item, todayISO());

  const row = (hold?: EventHold) => (
    <ListItem
      {...withRowMenu(hold?.handlers ?? {}, rowMenu)}
      holdProgress={hold?.progress}
      className={cn('gap-3 py-2.5', !item.groupEvent && 'cursor-default')}
      // An event opens its day in the calendar.
      onClick={item.groupEvent && item.dueDate ? () => router.push(`/calendar?date=${item.dueDate}`) : undefined}
    >
      <ListItemLeading>
        <LeadingTile sectionId={tileSection} Icon={Icon} />
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle>{item.title}</ListItemTitle>
        <ListItemMeta>
          {when && (
            <>
              <span className={when.kind === 'overdue' ? 'text-destructive' : 'font-mono tabular-nums'}>
                {when.kind === 'overdue' ? when.text : formatTime12h(when.time)}
              </span>
              <span>·</span>
            </>
          )}
          <span>{item.sourceLabel}</span>
        </ListItemMeta>
      </ListItemContent>
      <ListItemTrailing>
        {item.googleEvent?.html_link && (
          <a
            href={item.googleEvent.html_link}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-muted p-1.5 hover:bg-accent hover:text-foreground"
            aria-label="Open in Google Calendar"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {item.checklistHref && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              router.push(item.checklistHref as string);
            }}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground/80 hover:bg-accent"
          >
            Open
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
        <AvatarBubble userId={item.assignedTo} profiles={profiles} size={22} />
      </ListItemTrailing>
    </ListItem>
  );

  // FLUX-235: only calendar rows dismiss (appointments have no dismiss concept) —
  // swipe-left is the sole gesture; swipe-right is left unbound (nothing to complete).
  if (item.type === 'calendar') {
    return (
      <>
        <SwipeActions onSwipeLeft={() => onDismissCalendar(item)} left={DISMISS_CFG}>
          {row()}
        </SwipeActions>
        {rowMenu.menu}
      </>
    );
  }

  // A household event: swipe right for directions, left to hide it from
  // Home, hold or right-click to edit it here.
  if (item.groupEvent && onEditEvent && onHideEvent) {
    return (
      <>
        <HeroEventGestures event={item.groupEvent} onEdit={onEditEvent} onHide={onHideEvent} row={row} />
        {rowMenu.menu}
      </>
    );
  }

  return (
    <>
      {row()}
      {rowMenu.menu}
    </>
  );
}

const DIRECTIONS_CFG: SwipeConfig = {
  bg: 'bg-primary/70',
  activeBg: 'bg-primary',
  icon: <Navigation className="h-5 w-5 text-primary-foreground" />,
  label: 'Directions',
};
const HIDE_CFG: SwipeConfig = {
  bg: 'bg-muted-foreground/70',
  activeBg: 'bg-muted-foreground',
  icon: <EyeOff className="h-5 w-5 text-white" />,
  label: 'Hide',
};

type EventHold = ReturnType<typeof useRowLongPress>;

function HeroEventGestures({
  event,
  onEdit,
  onHide,
  row,
}: {
  event: GroupEvent;
  onEdit: (event: GroupEvent) => void;
  onHide: (event: GroupEvent) => void;
  row: (hold: EventHold) => ReactNode;
}) {
  const hold = useRowLongPress(() => onEdit(event));
  const place = event.location?.trim();
  return (
    <SwipeActions
      onSwipeRight={place ? () => window.open(mapsDirectionsUrl(place, event.travel_mode), '_blank', 'noopener') : undefined}
      right={place ? DIRECTIONS_CFG : undefined}
      onSwipeLeft={() => onHide(event)}
      left={HIDE_CFG}
    >
      {row(hold)}
    </SwipeActions>
  );
}

const BOARD_MIN_COL = 288;
const BOARD_GAP = 16;

/**
 * The week board shows whole days only: the day columns stretch so a whole
 * number of them fill the width, and snap keeps them aligned while
 * scrolling. A quiet column keeps its slim width. It reports which columns
 * are in view for the day strip, read from where they sit.
 */
function useBoardFit(ref: RefObject<HTMLDivElement | null>, columns: WeekBoardColumn[]) {
  const count = columns.length;
  const [fit, setFit] = useState({ colW: 0, perView: count, first: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // Inner width less the 4px side padding the scroller carries.
      const w = el.clientWidth - 8;
      const n = Math.max(1, Math.floor((w + BOARD_GAP) / (BOARD_MIN_COL + BOARD_GAP)));
      const colW = Math.floor((w - BOARD_GAP * (n - 1)) / n);
      const box = el.getBoundingClientRect();
      const cols = [...el.querySelectorAll<HTMLElement>('[data-board-column]')].map((c) => c.getBoundingClientRect());
      const inView = cols.map((r) => r.left >= box.left - 8 && r.right <= box.right + 8);
      const firstIn = inView.indexOf(true);
      const first = Math.max(0, firstIn);
      const perView = Math.max(1, inView.filter(Boolean).length);
      setFit((f) => (f.colW === colW && f.perView === perView && f.first === first ? f : { colW, perView, first }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
    };
    // The column list re-renders on every feed change; its keys say when the layout moved.
  }, [ref, columns.map((c) => c.key).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const jumpTo = (index: number) => {
    const el = ref.current;
    if (!el) return;
    const cols = el.querySelectorAll<HTMLElement>('[data-board-column]');
    const target = cols[Math.max(0, Math.min(cols.length - fit.perView, index))];
    if (!target) return;
    const left = target.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft - 4;
    el.scrollTo({ left, behavior: 'smooth' });
  };
  return { ...fit, jumpTo };
}

/**
 * Empty days in a row fold into one column with their dates and "Nothing
 * on", so the board reaches the next busy day without scrolling past blanks.
 * It keeps a day's width, so every page of the board is whole columns.
 */
function QuietColumn({ column, onAdd }: { column: WeekBoardColumn; onAdd?: (dateISO: string, e: React.MouseEvent) => void }) {
  const quiet = column.quiet!;
  const from = Number(quiet.from.slice(8, 10));
  const to = Number(quiet.to.slice(8, 10));
  return (
    <section data-board-column aria-label={`${column.label}, nothing on`} className="flex min-w-0 snap-start flex-col gap-2">
      <header className="flex min-h-12 items-end gap-2 px-1">
        <span className="font-heading text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-muted-foreground">
          {from}–{to}
        </span>
        <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{column.label}</span>
      </header>
      <div className="flex flex-col items-start gap-1 rounded-3xl bg-card/40 px-4 py-4 text-sm text-muted-foreground">
        <span>
          Nothing on for {quiet.days} days.
        </span>
        {onAdd && (
          <button
            type="button"
            onClick={(e) => onAdd(quiet.from, e)}
            className="-ml-2 inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2 font-medium text-primary hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" />
            Add something
          </button>
        )}
      </div>
    </section>
  );
}

/** A day chip's width (w-10); the strip's highlight is measured in chips. */
const DAY_CHIP_W = 40;
const WEEKDAY_CHIP = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The week board's day strip: every day on the board as a small chip, the
 * days in view lit, each with a local meter of how busy it is. It says how
 * much is off to the side and jumps there on a click.
 */
function BoardDays({
  columns,
  first,
  perView,
  today,
  onJump,
}: {
  columns: WeekBoardColumn[];
  first: number;
  perView: number;
  today: string;
  onJump: (index: number) => void;
}) {
  const busiest = Math.max(1, ...columns.map((c) => c.items.length));
  return (
    <div role="group" aria-label="Days on the board" className="relative flex items-center gap-0.5">
      {/* One squared highlight spans the days in view and slides with the
          board, the same shape as the selected tab (Hearth §13.7). */}
      <span
        aria-hidden
        className="absolute inset-y-0 rounded-[12px] bg-primary/20 transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
        style={{ left: first * (DAY_CHIP_W + 2), width: perView * DAY_CHIP_W + (perView - 1) * 2 }}
      />
      {columns.map((column, i) => {
        const inView = i >= first && i < first + perView;
        const weekday = column.date ? WEEKDAY_CHIP[new Date(`${column.date}T12:00`).getDay()] : column.label;
        const dayNumber = column.date && !column.quiet ? Number(column.date.slice(8, 10)) : null;
        const count = column.items.length;
        return (
          <button
            key={column.key}
            type="button"
            aria-label={`${column.label}, ${count} ${count === 1 ? 'item' : 'items'}`}
            aria-current={inView || undefined}
            onClick={() => onJump(i - Math.floor(perView / 2))}
            className={cn(
              'relative flex w-10 flex-col items-center gap-0.5 rounded-[10px] py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              inView ? 'text-foreground' : 'text-muted-foreground hover:bg-card hover:text-foreground'
            )}
          >
            <span className={cn('text-[9.5px] font-semibold uppercase tracking-[0.08em]', column.key === 'earlier' && 'text-destructive')}>
              {column.quiet ? 'Quiet' : dayNumber == null ? weekday.slice(0, 4) : weekday}
            </span>
            <span className={cn('font-heading font-semibold leading-none tabular-nums', column.quiet ? 'text-[12px] leading-[15px]' : 'text-[15px]', column.date === today && 'text-primary')}>
              {column.quiet ? `${Number(column.quiet.from.slice(8, 10))}–${Number(column.quiet.to.slice(8, 10))}` : dayNumber ?? count}
            </span>
            {/* H3: a local meter, this day's items against the busiest day. */}
            <span className={cn('mt-0.5 h-[3px] w-5 overflow-hidden rounded-full', inView ? 'bg-primary/25' : 'bg-muted')}>
              <span className={cn('block h-full rounded-full', inView ? 'bg-primary' : 'bg-foreground/40')} style={{ width: `${(count / busiest) * 100}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** What a week board day can add, in menu order. */
export type AddOnDayKind = { id: 'todo' | 'event' | 'checklist' | 'cost'; label: string };

const ADD_KIND_ICON: Record<AddOnDayKind['id'], RowActionIcon> = {
  todo: 'done',
  event: 'calendar',
  checklist: 'checklist',
  cost: 'cost',
};

const ADD_KIND_GLYPH: Record<AddOnDayKind['id'], typeof Check> = {
  todo: ListChecks,
  event: CalendarDays,
  checklist: ListTodo,
  cost: Wallet,
};
