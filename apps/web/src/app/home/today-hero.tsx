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

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Check,
  ClipboardList,
  Bell,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  LayoutGrid,
  ChevronRight,
  ExternalLink,
  EyeOff,
  Navigation,
  SlidersHorizontal,
  X,
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
import {
  AvatarBubble,
  formatTime12h,
  type HeroItem,
  type HeroRange,
} from './hub-shared';
import { HeroTaskRow, useRowLongPress, type SnoozeDuration } from '../tasks/task-row';
import type { Checklist, ChecklistTaskItem, GroupEvent, GroupMember, HouseholdTask } from '@homeup/core';
import {
  HERO_RANGES,
  HERO_RANGE_LABEL,
  mapsDirectionsUrl,
  compareStrings,
  feedRowWhen,
  filterHeroFeed,
  groupFeedItems,
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
}: TodayHeroProps) {
  const router = useRouter();
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
        }
      />

      {/* List */}
      <div id="heroList">
        {visible.length === 0 ? (
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
              <FeedHeader groupKey={feedGroup.key} label={feedGroup.label} />
              <ListGroup>
                {feedGroup.items.map((item) => (
                  <HeroRow
                    key={item.id}
                    item={item}
                    profiles={profiles}
                    groupMembers={groupMembers}
                    onToggle={onToggle}
                    onSnooze={onSnooze}
                    onEdit={onEdit}
                    onUpdate={onUpdate}
                    onRequestDelete={onRequestDelete}
                    onDismissCalendar={onDismissCalendar}
                    onEditEvent={onEditEvent}
                    onHideEvent={onHideEvent}
                    currentUserId={currentUserId}
                    checklistsById={checklistsById}
                    checklistItemsByChecklistId={checklistItemsByChecklistId}
                  />
                ))}
              </ListGroup>
            </div>
          ))
        )}
      </div>

      {/* The way into the full Tasks page (the phone tab bar has no Tasks
          tab), as a quiet link under the feed rather than a toolbar icon. */}
      {householdVisible && (
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
function FeedHeader({ groupKey, label }: { groupKey: string; label: string }) {
  return (
    <div
      className={cn(
        'mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em]',
        groupKey === 'earlier' ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {label}
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
      {...hold?.handlers}
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
      <SwipeActions onSwipeLeft={() => onDismissCalendar(item)} left={DISMISS_CFG}>
        {row()}
      </SwipeActions>
    );
  }

  // A household event: swipe right for directions, left to hide it from
  // Home, hold or right-click to edit it here.
  if (item.groupEvent && onEditEvent && onHideEvent) {
    return <HeroEventGestures event={item.groupEvent} onEdit={onEditEvent} onHide={onHideEvent} row={row} />;
  }

  return row();
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
