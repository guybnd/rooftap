// Hearth v2 (Pulse + Feed): the pieces Home's lede, Now card and feed agenda
// are built from. Pure derivations over the HeroItem list both platforms
// already build (hero.ts), so web and native group, label and count the
// feed the same way.
import type { HeroItem, HeroItemType, HeroRange } from './hero';
import { parseLocalISODate } from './hero';
import { addDaysISO, daysBetweenISO } from './date-utils';
import { taskOwnerModule } from './task-modules';

/**
 * The feed's day header for a due date. Anything already past collapses into
 * "Earlier" (overdue work reads as one pile, not a list of old dates), the
 * next six days use their weekday, and further out gets a short date.
 */
export function feedDayLabel(dateISO: string, todayISO: string): string {
  if (dateISO < todayISO) return 'Earlier';
  if (dateISO === todayISO) return 'Today';
  if (dateISO === addDaysISO(todayISO, 1)) return 'Tomorrow';
  const date = parseLocalISODate(dateISO);
  if (daysBetweenISO(todayISO, dateISO) < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export interface FeedGroup {
  /** Stable key: 'earlier', 'none', or the group's YYYY-MM-DD. */
  key: string;
  label: string;
  items: HeroItem[];
}

/**
 * What a feed row's meta says about *when*. The day header above the row
 * already names the day, so an untimed item on its day says nothing (null);
 * a timed one gives its time; an overdue one says how late it is ("3d
 * overdue", H6), and plain "Overdue" when it has no date to count from.
 */
export type FeedRowWhen = { kind: 'overdue'; text: string } | { kind: 'time'; time: string } | null;

export function feedRowWhen(item: HeroItem, todayISO: string): FeedRowWhen {
  if (item.overdue) {
    const days = item.dueDate ? daysBetweenISO(item.dueDate, todayISO) : 0;
    return { kind: 'overdue', text: days >= 1 ? `${days}d overdue` : 'Overdue' };
  }
  if (item.dueTime) return { kind: 'time', time: item.dueTime };
  return null;
}

/**
 * Buckets already-sorted items into feed groups: Earlier first, then one
 * group per day in date order, then undated items last ("No date"). Item
 * order inside a group is the caller's (it sorts before grouping).
 */
export function groupFeedItems(items: HeroItem[], todayISO: string): FeedGroup[] {
  return groupByFeedDay(items, (i) => i.dueDate, todayISO);
}

/** groupFeedItems over any row shape (the home-screen widget's snapshot rows). */
export function groupByFeedDay<T>(
  items: T[],
  dateOf: (item: T) => string | null,
  todayISO: string,
): { key: string; label: string; items: T[] }[] {
  const earlier: T[] = [];
  const undated: T[] = [];
  const byDate = new Map<string, T[]>();
  for (const item of items) {
    const date = dateOf(item);
    if (!date) undated.push(item);
    else if (date < todayISO) earlier.push(item);
    else {
      const bucket = byDate.get(date);
      if (bucket) bucket.push(item);
      else byDate.set(date, [item]);
    }
  }
  const groups: { key: string; label: string; items: T[] }[] = [];
  if (earlier.length) groups.push({ key: 'earlier', label: 'Earlier', items: earlier });
  for (const [date, dayItems] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    groups.push({ key: date, label: feedDayLabel(date, todayISO), items: dayItems });
  }
  if (undated.length) groups.push({ key: 'none', label: 'No date', items: undated });
  return groups;
}

/**
 * The section a feed item belongs to, for its leading tile (section-hues.ts):
 * bill and document reminders wear their owner's hue, a dated checklist's
 * to-do wears Checklists', viewings wear Home Search's and pulled calendar
 * events wear Calendar's.
 */
export function heroItemSectionId(item: HeroItem): string {
  if (item.type === 'appointment') return 'search';
  if (item.type === 'bins') return 'bins';
  if (item.type === 'calendar' || item.type === 'event') return 'calendar';
  if (item.checklistHref) return 'checklists';
  if (item.task) {
    const owner = taskOwnerModule(item.task);
    if (owner === 'costs' || owner === 'documents') return owner;
  }
  return 'household';
}

export interface TodayProgress {
  /** Open items today (what "on today" always counted). */
  left: number;
  /** Items finished today. */
  done: number;
  total: number;
}

/** Home's lede numbers: "3 of 7 left today". Takes the today-scoped hero items. */
export function todayProgress(todayItems: HeroItem[]): TodayProgress {
  let left = 0;
  let done = 0;
  for (const item of todayItems) {
    if (item.done) done += 1;
    else left += 1;
  }
  return { left, done, total: left + done };
}

/** The most items the Now card pages through; past it the feed below has them. */
export const NOW_QUEUE_MAX = 8;

/**
 * What the Now card pages through, in order: timed open items soonest first,
 * then overdue to-dos, then open to-dos due today (each in the caller's
 * order), at most `max`. Undated to-dos never take the card (they have no
 * "now"); an empty queue means the card hides. The head is pickNowItem.
 */
export function pickNowQueue(todayItems: HeroItem[], todayISO: string, max = NOW_QUEUE_MAX): HeroItem[] {
  const open = todayItems.filter((i) => !i.done);
  const timed = open
    .filter((i) => i.dueTime && (i.dueDate === null || i.dueDate <= todayISO))
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.dueTime!.localeCompare(b.dueTime!));
  const overdue = open.filter((i) => i.overdue);
  const dueToday = open.filter((i) => i.dueDate === todayISO);
  const queue: HeroItem[] = [];
  const taken = new Set<string>();
  for (const item of [...timed, ...overdue, ...dueToday]) {
    if (taken.has(item.id)) continue;
    taken.add(item.id);
    queue.push(item);
  }
  return queue.slice(0, Math.max(0, max));
}

/**
 * What the Now card leads with: the soonest timed open item, else the first
 * overdue to-do, else the first open to-do due today; null means the card
 * hides. The head of pickNowQueue.
 */
export function pickNowItem(todayItems: HeroItem[], todayISO: string): HeroItem | null {
  return pickNowQueue(todayItems, todayISO, 1)[0] ?? null;
}

/**
 * Which page of the Now queue the card shows. `anchorId` is the item the
 * person paged to (null follows the head, so a sooner item that turns up
 * takes the card). When the anchored item leaves the queue (finished, or
 * finished elsewhere) the card stays at the same position, which now holds
 * the next item, clamped to the end.
 */
export function nowQueueIndex(ids: string[], anchorId: string | null, lastIndex: number): number {
  if (ids.length === 0 || anchorId === null) return 0;
  const at = ids.indexOf(anchorId);
  if (at >= 0) return at;
  return Math.min(Math.max(lastIndex, 0), ids.length - 1);
}

/**
 * Where tapping a hub item takes the person, so the Now card and the feed open
 * the same thing on both platforms: a dated checklist's to-do opens the
 * checklist, a reminder shown while Tasks isn't opens its owner screen
 * (task-modules.ts), any other task opens its editor, a viewing opens its
 * listing and a pulled calendar event opens in Google Calendar. null means it
 * has nowhere to go.
 */
export type HeroItemOpenTarget =
  | { kind: 'route'; href: string }
  | { kind: 'task'; task: NonNullable<HeroItem['task']> }
  | { kind: 'external'; url: string }
  | null;

export function heroItemOpenTarget(item: HeroItem): HeroItemOpenTarget {
  if (item.checklistHref) return { kind: 'route', href: item.checklistHref };
  if (item.task) return item.opensAt ? { kind: 'route', href: item.opensAt } : { kind: 'task', task: item.task };
  if (item.appointment) return { kind: 'route', href: `/apartment/${item.appointment.apartment_id}` };
  if (item.googleEvent?.html_link) return { kind: 'external', url: item.googleEvent.html_link };
  if (item.groupEvent && item.dueDate) return { kind: 'route', href: `/calendar?date=${item.dueDate}` };
  if (item.binNight) return { kind: 'route', href: '/bins' };
  return null;
}

/**
 * What an event's Now card can say beyond its start time: where it is (for a
 * Directions button, by the event's travel mode) and when it ends ("HH:MM" local, same day only). A
 * viewing's place is its listing's address, which is also its title. Tasks
 * and reminders have neither.
 */
export function heroItemEventDetails(item: HeroItem): { location: string | null; endsAt: string | null; travelMode: string | null } {
  const event = item.groupEvent ?? item.googleEvent ?? null;
  if (event) {
    const location = event.location?.trim() || null;
    let endsAt: string | null = null;
    if (event.ends_at && !event.is_all_day) {
      const start = new Date(event.starts_at);
      const end = new Date(event.ends_at);
      if (!Number.isNaN(end.getTime()) && end.toDateString() === start.toDateString() && end > start) {
        endsAt = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
      }
    }
    return { location, endsAt, travelMode: item.groupEvent?.travel_mode ?? null };
  }
  if (item.appointment) return { location: item.title.trim() || null, endsAt: null, travelMode: null };
  return { location: null, endsAt: null, travelMode: null };
}

/**
 * The lede's segmented meter (H3: the lede's own meter): one segment per item
 * up to `max`, scaled past it so a big day still fits one row. A scaled meter
 * never rounds real progress away: one finished item always fills a segment,
 * and the last segment fills only when everything is done.
 */
export function meterSegments(done: number, total: number, max = 10): { count: number; filled: number } {
  if (total <= 0) return { count: 0, filled: 0 };
  const finished = Math.max(0, Math.min(done, total));
  if (total <= max) return { count: total, filled: finished };
  if (finished === 0) return { count: max, filled: 0 };
  if (finished === total) return { count: max, filled: max };
  return { count: max, filled: Math.min(max - 1, Math.max(1, Math.round((finished / total) * max))) };
}

/** Where each platform remembers the day the All clear moment last showed. */
export const ALL_CLEAR_MOMENT_STORAGE_KEY = 'homeup-all-clear-shown';

/**
 * Whether finishing `finishedId` earns today's All clear moment: it is the
 * last open item on today's list, and the moment hasn't shown yet today.
 * Checked when the person finishes something (not on render), so opening an
 * already-clear day never fires it.
 */
export function earnedAllClear(
  todayItems: HeroItem[],
  finishedId: string,
  lastShownISO: string | null,
  todayISO: string
): boolean {
  if (lastShownISO === todayISO) return false;
  const open = todayItems.filter((i) => !i.done);
  return open.length === 1 && open[0].id === finishedId;
}

// ── Feed controls (Hearth v2, heading menu) ─────────────────────────────────
// The feed's title is its range picker ("Upcoming 7", opening Today / This
// week / This month / Upcoming with a count each), and the type and "just
// me" filters sit behind one filter button. Both platforms read these.

export const HERO_RANGES: readonly HeroRange[] = ['today', 'week', 'month', 'upcoming'];

export const HERO_RANGE_LABEL: Record<HeroRange, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  upcoming: 'Upcoming',
};

export type HeroTypeFilter = 'all' | HeroItemType;

export interface HeroFeedFilter {
  type: HeroTypeFilter;
  /** Only items assigned to `userId`. */
  mineOnly: boolean;
  userId: string | null;
}

export const NO_HERO_FEED_FILTER: HeroFeedFilter = { type: 'all', mineOnly: false, userId: null };

/** The type and "just me" slice of the feed. */
export function filterHeroFeed(items: HeroItem[], filter: HeroFeedFilter): HeroItem[] {
  return items.filter((i) => {
    if (filter.type !== 'all' && i.type !== filter.type) return false;
    if (filter.mineOnly && i.assignedTo !== filter.userId) return false;
    return true;
  });
}

/** True when any filter narrows the feed, which puts a dot on the filter button. */
export function isHeroFeedFiltered(filter: HeroFeedFilter): boolean {
  return filter.type !== 'all' || filter.mineOnly;
}

/** Items still to do: the number the heading and its menu show. */
export function openCount(items: HeroItem[]): number {
  return items.filter((i) => !i.done).length;
}

/**
 * The range menu's counts: open items per range under the same filter, so
 * the number beside each range is what picking it would show. `build` is the
 * caller's buildHeroItems for a range (each platform passes its own inputs).
 */
export function heroRangeCounts(
  build: (range: HeroRange) => HeroItem[],
  filter: HeroFeedFilter,
): Record<HeroRange, number> {
  const counts = {} as Record<HeroRange, number>;
  for (const range of HERO_RANGES) counts[range] = openCount(filterHeroFeed(build(range), filter));
  return counts;
}

/** A column of Home's week board (wide screens): one day, or a pile. */
export interface WeekBoardColumn {
  /** 'earlier', 'later', 'none', or the column's YYYY-MM-DD. */
  key: string;
  label: string;
  /** The day's date, for a day column (its weather and its number). */
  date: string | null;
  items: HeroItem[];
  /** A run of empty days folded into one slim column (`collapseQuiet`). */
  quiet?: { from: string; to: string; days: number };
}

const SHORT_WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortDay = (iso: string) => `${SHORT_WEEKDAY[parseLocalISODate(iso).getDay()]} ${Number(iso.slice(8, 10))}`;

/**
 * Home's week board on a wide screen (Hearth §13 "Desktop shell"): the same
 * feed as groupFeedItems, laid out as columns. Every day from today through
 * `days` ahead gets a column even when it is empty, so the week reads as a
 * calendar; the range's end (`windowEnd`) can cut it shorter. Overdue work
 * leads as Earlier, anything dated past the board's last day collects in
 * Later, and undated items close it as No date. Item order inside a column
 * is the caller's.
 */
export function weekBoardColumns(
  items: HeroItem[],
  todayISO: string,
  windowEnd: string,
  days = 7,
  opts: { collapseQuiet?: boolean } = {},
): WeekBoardColumn[] {
  let last = addDaysISO(todayISO, days - 1);
  if (windowEnd < last) last = windowEnd < todayISO ? todayISO : windowEnd;
  const dayKeys: string[] = [];
  for (let d = todayISO; d <= last; d = addDaysISO(d, 1)) dayKeys.push(d);
  const byDay = new Map<string, HeroItem[]>(dayKeys.map((d) => [d, []]));
  const earlier: HeroItem[] = [];
  const later: HeroItem[] = [];
  const undated: HeroItem[] = [];
  for (const item of items) {
    const date = item.dueDate;
    if (!date) undated.push(item);
    else if (date < todayISO) earlier.push(item);
    else if (date > last) later.push(item);
    else byDay.get(date)?.push(item);
  }
  const columns: WeekBoardColumn[] = [];
  if (earlier.length) columns.push({ key: 'earlier', label: 'Earlier', date: null, items: earlier });
  // collapseQuiet: two or more empty days in a row after today fold into one
  // column, so a quiet stretch never has to be scrolled through.
  for (let i = 0; i < dayKeys.length; i++) {
    const d = dayKeys[i];
    let end = i;
    if (opts.collapseQuiet && d !== todayISO) {
      while (end + 1 < dayKeys.length && !byDay.get(dayKeys[end])?.length && !byDay.get(dayKeys[end + 1])?.length) end++;
    }
    if (end > i && !byDay.get(d)?.length) {
      const to = dayKeys[end];
      columns.push({ key: `quiet:${d}`, label: `${shortDay(d)} to ${shortDay(to)}`, date: d, items: [], quiet: { from: d, to, days: end - i + 1 } });
      i = end;
      continue;
    }
    columns.push({ key: d, label: feedDayLabel(d, todayISO), date: d, items: byDay.get(d) ?? [] });
  }
  if (later.length) columns.push({ key: 'later', label: 'Later', date: null, items: later });
  if (undated.length) columns.push({ key: 'none', label: 'No date', items: undated, date: null });
  return columns;
}
