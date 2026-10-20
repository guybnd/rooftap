// HOUP-106/HOUP-110: the versioned data contract the Android home-screen
// widget reads. The app (apps/mobile) is the only writer — it derives
// `HeroItem[]` via buildHeroItems() (hero.ts) from the live householdTasks$
// store and maps it to this shape, alongside groceries/budget/bills/weather;
// the widget's headless task (apps/mobile/src/widgets) is the only reader,
// via its own SQLiteStorage('HomeUp.db') handle. Raw `due_date`/`done` are
// stored (not precomputed labels) so the widget can compute "today"/"2d
// overdue" at render time — those labels would otherwise go stale between
// the daily rollover and the next snapshot write.
import type { HeroItem, HeroItemType } from './hero';
import { daysBetweenISO } from './date-utils';
import { groupByFeedDay, heroItemOpenTarget, heroItemSectionId } from './feed';
import { compareStrings } from './sort';
import type { GroceryItem } from './types';

export const WIDGET_SNAPSHOT_KEY = 'homeup:widget:todaysTasks:v1';
// HOUP-110: v1 (tasks only) -> v3 adds groceries + summary (budget/bills/
// weather/counts) and a per-row `sourceUpdatedAt` discriminator on tasks. A
// snapshot written by an older app has neither and fails this version gate
// -> the widget renders empty/last-known rather than misreading the shape.
// The summary's optional module flags came later without a bump: a v3
// snapshot without them reads as every module on. v4 (Hearth v2 widget)
// carries Home's whole Upcoming feed: events and viewings beside tasks and
// reminders, each row with its kind, section, source caption and where it
// opens.
export const WIDGET_SNAPSHOT_VERSION = 4;

/** The most feed rows the widget draws; past it the app has them. */
export const WIDGET_FEED_MAX_ROWS = 40;

export interface WidgetTaskSnapshotItem {
  id: string;
  title: string;
  done: boolean;
  due_date: string | null;
  due_time: string | null;
  priority: 'low' | 'medium' | 'high' | null;
  /** True when this task is assigned to the device's current user — drives the widget's teal-ring identity mark. */
  assignedToMe: boolean;
  /** True when this task has any assignee at all — false drives the widget's dashed-amber "unassigned" mark. */
  assigned: boolean;
  /** The source task's own `updated_at` — half of the widget-click stale-render discriminator (paired with `done`). */
  sourceUpdatedAt: string | null;
  /** v4: the feed row's kind (hero.ts). */
  type: HeroItemType;
  /** v4: the section whose leading tile the row wears (feed.ts heroItemSectionId). */
  section: string;
  /** v4: the row's source caption, as Home's feed prints it. */
  sourceLabel: string;
  /** v4: a household task or reminder, which a tap ticks. Anything else opens `openPath`. */
  toggleable: boolean;
  /** v4: the in-app route a row that can't be ticked opens (feed.ts heroItemOpenTarget); null opens Home. */
  openPath: string | null;
}

export interface WidgetGrocerySnapshotItem {
  id: string;
  name: string;
  status: GroceryItem['status'];
  quantity: number | null;
  unit: string | null;
  aisle: string;
  /** The source item's own `updated_at` — half of the widget-click stale-render discriminator (paired with `status`). */
  sourceUpdatedAt: string | null;
}

export interface WidgetBillDue {
  label: string;
  days: number;
}

export interface WidgetBudgetSummary {
  spentCents: number;
  budgetCents: number;
  tone: 'success' | 'warning' | 'danger';
  /** The household currency's symbol; omitted by apps from before it existed, read as "$". */
  currencySymbol?: string;
}

export interface WidgetWeatherSummary {
  tempC: number;
  condition: string;
  iconKey: string;
  /** When this reading was fetched (not when the snapshot was written) — the widget derives its own "as of"/stale label from this at render time. */
  updatedAt: string;
  /** True once the reading is old enough that the widget should visually flag it rather than presenting it as current. */
  stale: boolean;
}

export interface WidgetSummary {
  openTodoCount: number;
  toBuyCount: number;
  doneTodayCount: number;
  budget: WidgetBudgetSummary | null;
  bills: WidgetBillDue[];
  /** Best-effort — null when no successful weather fetch has ever been cached on this device. */
  weather: WidgetWeatherSummary | null;
  // Modules (.docs/modules.md, section 7): which modules the widget may show,
  // as the app saw them when it wrote the snapshot. Omitted counts as on, so a
  // snapshot written by an app from before modules renders as it always did.
  tasksOn?: boolean;
  groceriesOn?: boolean;
  costsOn?: boolean;
  documentsOn?: boolean;
  /** v4: how far ahead the feed reaches (upcomingWindowDays), so a tick from the widget rebuilds the same window. */
  upcomingDays?: number;
}

export interface WidgetModuleFlags {
  tasksOn: boolean;
  groceriesOn: boolean;
  costsOn: boolean;
  documentsOn: boolean;
}

/**
 * The snapshot's module flags from the household's enabled modules
 * (useModules().enabled) and, like Home, the sections this person hid.
 */
export function widgetModuleFlags(enabled: ReadonlySet<string>, hidden: readonly string[] = []): WidgetModuleFlags {
  const on = (id: string) => enabled.has(id) && !hidden.includes(id);
  return {
    tasksOn: on('household'),
    groceriesOn: on('groceries'),
    costsOn: on('costs'),
    documentsOn: on('documents'),
  };
}

/** A snapshot's module flags, an omitted flag (older app) counting as on. */
export function readWidgetModuleFlags(summary: Partial<WidgetModuleFlags> | null | undefined): WidgetModuleFlags {
  return {
    tasksOn: summary?.tasksOn ?? true,
    groceriesOn: summary?.groceriesOn ?? true,
    costsOn: summary?.costsOn ?? true,
    documentsOn: summary?.documentsOn ?? true,
  };
}

/**
 * Modules: the widget's buildHeroItems visibility. Plain tasks need Tasks;
 * bill and document reminders follow Costs and Documents whether or not Tasks
 * is on (task-modules.ts), so with Tasks off the rows are only those reminders.
 */
export function widgetHeroVisibility(flags: WidgetModuleFlags): {
  householdVisible: boolean;
  reminderOwnersVisible: { costs: boolean; documents: boolean };
} {
  return {
    householdVisible: flags.tasksOn,
    reminderOwnersVisible: { costs: flags.costsOn, documents: flags.documentsOn },
  };
}

export interface WidgetSections {
  /**
   * The Upcoming feed: 'tasks' while Tasks is on (the feed with its add
   * button), 'reminders' while only reminders, events or viewings show (no
   * add button), else none.
   */
  tasks: 'tasks' | 'reminders' | null;
  groceries: boolean;
  /** The "N left today" lede: whenever the feed shows. */
  taskCounts: boolean;
  /** The "N to buy" count. */
  toBuyCount: boolean;
  /** The budget space. */
  costs: boolean;
  /** Neither the feed nor groceries can show: the widget says so in one muted line. */
  nothingToShow: boolean;
}

/** Modules: what the widget renders for a snapshot, given its flags and how many feed rows it carries. */
export function widgetSections(summary: WidgetSummary, taskRowCount: number): WidgetSections {
  const flags = readWidgetModuleFlags(summary);
  const tasks = flags.tasksOn ? 'tasks' : taskRowCount > 0 ? 'reminders' : null;
  return {
    tasks,
    groceries: flags.groceriesOn,
    taskCounts: tasks !== null,
    toBuyCount: flags.groceriesOn,
    costs: flags.costsOn,
    nothingToShow: tasks === null && !flags.groceriesOn,
  };
}

export interface WidgetTodaySnapshot {
  version: typeof WIDGET_SNAPSHOT_VERSION;
  updatedAt: string;
  items: WidgetTaskSnapshotItem[];
  groceries: WidgetGrocerySnapshotItem[];
  summary: WidgetSummary;
}

/**
 * The feed's order, as Home's Upcoming range sorts it (compareHeroItems):
 * open before done, then by day (undated last), untimed before timed on a
 * day, then by time and title. Overdue rows lead because their days come
 * first.
 */
export function compareWidgetItems(a: WidgetTaskSnapshotItem, b: WidgetTaskSnapshotItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const aDue = a.due_date ?? '9999-99-99';
  const bDue = b.due_date ?? '9999-99-99';
  if (aDue !== bDue) return aDue.localeCompare(bDue);
  const aTime = a.due_time ?? '';
  const bTime = b.due_time ?? '';
  if (!aTime && bTime) return -1;
  if (aTime && !bTime) return 1;
  if (aTime !== bTime) return aTime.localeCompare(bTime);
  return compareStrings(a.title, b.title);
}

function openPathFor(item: HeroItem): string | null {
  const target = heroItemOpenTarget(item);
  return target?.kind === 'route' ? target.href : null;
}

/**
 * Maps buildHeroItems()'s output (gated by widgetHeroVisibility and the
 * person's hidden sections, as Home gates its feed) to the widget
 * snapshot's privacy-safe row shape: no raw user ids, just the two identity
 * booleans the widget renders. Sorted as Home's Upcoming feed.
 */
export function buildWidgetSnapshotItems(
  heroItems: HeroItem[],
  currentUserId: string | null | undefined,
): WidgetTaskSnapshotItem[] {
  return heroItems
    .map((item) => ({
      id: item.id,
      title: item.title,
      done: item.done,
      due_date: item.dueDate,
      due_time: item.dueTime,
      priority: item.task?.priority ?? null,
      assignedToMe: !!item.assignedTo && item.assignedTo === currentUserId,
      assigned: !!item.assignedTo,
      sourceUpdatedAt: item.task?.updated_at ?? null,
      type: item.type,
      section: heroItemSectionId(item),
      sourceLabel: item.sourceLabel,
      toggleable: !!item.task,
      openPath: item.task ? null : openPathFor(item),
    }))
    .sort(compareWidgetItems);
}

/**
 * After a tick from the widget its headless task rebuilds only the task and
 * reminder rows (it has no event or viewing stores): keep the snapshot's
 * other rows and fold the rebuilt ones back in, in feed order.
 */
export function mergeWidgetTaskRows(
  snapshotItems: WidgetTaskSnapshotItem[],
  taskItems: WidgetTaskSnapshotItem[],
): WidgetTaskSnapshotItem[] {
  return [...snapshotItems.filter((i) => !i.toggleable), ...taskItems.filter((i) => i.toggleable)].sort(compareWidgetItems);
}

/** A task or reminder past its day and still open. Events and viewings never run late. */
export function isWidgetItemOverdue(item: WidgetTaskSnapshotItem, todayISO: string): boolean {
  return item.toggleable && !item.done && !!item.due_date && item.due_date < todayISO;
}

/** The row's one trailing fact, as feed.ts feedRowWhen: how late, its time, or nothing. */
export function widgetRowWhen(
  item: WidgetTaskSnapshotItem,
  todayISO: string,
): { kind: 'overdue'; text: string } | { kind: 'time'; time: string } | null {
  if (isWidgetItemOverdue(item, todayISO)) {
    const days = daysBetweenISO(item.due_date!, todayISO);
    return { kind: 'overdue', text: days >= 1 ? `${days}d overdue` : 'Overdue' };
  }
  if (item.due_time) return { kind: 'time', time: item.due_time };
  return null;
}

/** The feed's day groups (Earlier, Today, Tomorrow, weekdays, dates, No date), labels worked out at render so they never go stale. */
export function widgetFeedGroups(items: WidgetTaskSnapshotItem[], todayISO: string) {
  return groupByFeedDay(items, (i) => i.due_date, todayISO);
}

/**
 * The widget's lede, Home's "3 of 7 left today" (feed.ts todayProgress): rows
 * due today or earlier, or undated, as Home's today range takes them. Read
 * from the rows at render so the day rolls over without a new snapshot.
 */
export function widgetTodayProgress(items: WidgetTaskSnapshotItem[], todayISO: string): { left: number; done: number; total: number } {
  let left = 0;
  let done = 0;
  for (const item of items) {
    if (item.due_date && item.due_date > todayISO) continue;
    if (item.done) done += 1;
    else left += 1;
  }
  return { left, done, total: left + done };
}

/** Pending (`status==='needed'`) groceries only — matches the widget's read-mostly scope. Sorted by name for a stable render. */
export function buildWidgetGrocerySnapshotItems(items: GroceryItem[]): WidgetGrocerySnapshotItem[] {
  return items
    .filter((i) => !i.deleted && i.status === 'needed')
    .map((i) => ({
      id: i.id,
      name: i.name,
      status: i.status,
      quantity: i.quantity,
      unit: i.unit,
      aisle: i.aisle,
      sourceUpdatedAt: i.updated_at ?? null,
    }))
    .sort((a, b) => compareStrings(a.name, b.name));
}
