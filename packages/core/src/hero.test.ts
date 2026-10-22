import { describe, expect, it, vi } from "vitest";
import {
  buildHeroItems,
  heroRangeWindow,
  localDateISO,
  countdownDisplay,
  createWriteGate,
  HERO_MODULE_FEATURES,
  isHeroModuleAvailable,
  type HeroItem,
} from "./hero";
import { ALL_MODULE_IDS, type ModuleId } from "./modules";
import { ALL_MODULE_FEATURE_IDS, isFeatureEnabled, type ModuleFeatureId } from "./module-features";
import type { HouseholdTask, Appointment, GoogleCalendarEventWithAttribution } from "./types";
import { heroItemOpenTarget, heroItemSectionId } from "./feed";

const TODAY = "2026-07-31";

function task(overrides: Partial<HouseholdTask> = {}): HouseholdTask {
  return {
    id: "t1",
    group_id: "g1",
    title: "Take out bins",
    due_date: TODAY,
    due_time: null,
    offset_days: null,
    recurrence_days: null,
    done: false,
    completed_at: null,
    assigned_to: null,
    private: false,
    template_key: null,
    notes: null,
    sort_order: 0,
    created_at: TODAY,
    updated_at: TODAY,
    deleted: false,
    ...overrides,
  };
}

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "a1",
    user_id: "u1",
    group_id: "g1",
    apartment_id: "ap1",
    scheduled_at: `${TODAY}T10:00:00`,
    notes: null,
    status: "scheduled",
    created_at: TODAY,
    updated_at: TODAY,
    deleted: false,
    ...overrides,
  };
}

describe("heroRangeWindow", () => {
  it("today range is a single-day window", () => {
    expect(heroRangeWindow(TODAY, "today")).toEqual({ from: TODAY, to: TODAY });
  });

  it("week range spans Sunday to Saturday containing today", () => {
    // 2026-07-31 is a Friday.
    expect(heroRangeWindow(TODAY, "week")).toEqual({ from: "2026-07-26", to: "2026-08-01" });
  });

  it("month range spans the full calendar month", () => {
    expect(heroRangeWindow(TODAY, "month")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("upcoming runs from today through the given number of days, 90 by default", () => {
    expect(heroRangeWindow("2026-10-18", "upcoming")).toEqual({ from: "2026-10-18", to: "2027-01-16" });
    expect(heroRangeWindow("2026-10-18", "upcoming", 365)).toEqual({ from: "2026-10-18", to: "2027-10-18" });
  });
});

describe("buildHeroItems", () => {
  it("includes an open task due today and excludes one due later than the range", () => {
    const items = buildHeroItems({
      tasks: [task({ id: "due-today" }), task({ id: "due-later", due_date: "2026-08-05" })],
      appointments: [],
      apartments: [],
      today: TODAY,
      householdVisible: true,
      searchVisible: false,
    });
    expect(items.map((i) => i.id)).toEqual(["due-today"]);
  });

  it("always includes undated tasks regardless of range", () => {
    const items = buildHeroItems({
      tasks: [task({ id: "undated", due_date: null })],
      appointments: [],
      apartments: [],
      today: TODAY,
      householdVisible: true,
      searchVisible: false,
    });
    expect(items.map((i) => i.id)).toEqual(["undated"]);
  });

  it("keeps a task completed today but drops one completed on an earlier day", () => {
    const items = buildHeroItems({
      tasks: [
        task({ id: "done-today", done: true, completed_at: `${TODAY}T09:00:00` }),
        task({ id: "done-yesterday", done: true, completed_at: "2026-07-30T09:00:00" }),
      ],
      appointments: [],
      apartments: [],
      today: TODAY,
      householdVisible: true,
      searchVisible: false,
    });
    expect(items.map((i) => i.id)).toEqual(["done-today"]);
  });

  it("marks a past-due open task as overdue and carries it forward regardless of range", () => {
    const items = buildHeroItems({
      tasks: [task({ id: "overdue", due_date: "2026-07-20" })],
      appointments: [],
      apartments: [],
      today: TODAY,
      householdVisible: true,
      searchVisible: false,
    });
    expect(items).toHaveLength(1);
    expect(items[0].overdue).toBe(true);
  });

  it("excludes household tasks entirely when the section is hidden", () => {
    const items = buildHeroItems({
      tasks: [task()],
      appointments: [],
      apartments: [],
      today: TODAY,
      householdVisible: false,
      searchVisible: false,
    });
    expect(items).toHaveLength(0);
  });

  it("includes a scheduled appointment within range only when search is visible", () => {
    const opts = {
      tasks: [],
      appointments: [appointment()],
      apartments: [{ id: "ap1", address: "1 Main St" }],
      today: TODAY,
      householdVisible: false,
    };
    expect(buildHeroItems({ ...opts, searchVisible: false })).toHaveLength(0);
    const withSearch = buildHeroItems({ ...opts, searchVisible: true });
    expect(withSearch).toHaveLength(1);
    expect(withSearch[0]).toMatchObject({ type: "appointment", title: "1 Main St", ownerSection: "search" });
  });

  it("localDateISO does not shift across a UTC day boundary", () => {
    // Local midnight for a given date must round-trip to the same YYYY-MM-DD.
    const d = new Date(2026, 6, 31); // July 31 2026, local time
    expect(localDateISO(d)).toBe(TODAY);
  });
});

function calendarEvent(overrides: Partial<GoogleCalendarEventWithAttribution> = {}): GoogleCalendarEventWithAttribution {
  return {
    id: "e1",
    user_id: "u1",
    gcal_event_id: "g-e1",
    gcal_calendar_id: "primary",
    title: "Dentist",
    description: null,
    location: null,
    starts_at: `${TODAY}T15:00:00`,
    ends_at: null,
    is_all_day: false,
    html_link: null,
    visibility: "private",
    matched_apartment_id: null,
    state: "synced",
    imported_appointment_id: null,
    imported_task_id: null,
    created_at: TODAY,
    updated_at: TODAY,
    ...overrides,
  };
}

// Modules (module-features.ts): the hub agenda with one module off at a time.
// The flags are derived the way both platforms' hubs derive them, so turning a
// module off must drop exactly its own rows (or a task's checklist link) and
// leave everything else as it was.
describe("buildHeroItems module gates", () => {
  const ALL_ON = new Set<string>(ALL_MODULE_IDS);

  function agenda(enabled: ReadonlySet<string>): HeroItem[] {
    const feature = (id: ModuleFeatureId) => isFeatureEnabled(id, enabled);
    return buildHeroItems({
      tasks: [
        task({ id: "plain" }),
        task({ id: "bill-reminder", template_key: "cost-reminder:c1:expiry" }),
        task({ id: "doc-reminder", template_key: "doc-reminder:d1:expiry" }),
        task({ id: "with-checklist", linked_checklist_id: "cl1" }),
      ],
      appointments: [appointment({ id: "viewing" })],
      apartments: [{ id: "ap1", address: "1 Main St" }],
      today: TODAY,
      householdVisible: feature("hub.tasks"),
      searchVisible: feature("hub.viewings"),
      calendarEventsVisible: feature("hub.calendar-events"),
      taskChecklistsVisible: feature("hub.task-checklists"),
      reminderOwnersVisible: { costs: enabled.has("costs"), documents: enabled.has("documents") },
      checklistByTaskId: {
        "with-checklist": { href: "/checklists/cl1", completionLabel: "1/3", completion: { done: 1, total: 3 } },
      },
      calendarEvents: [calendarEvent({ id: "event" })],
    });
  }

  /** What the agenda shows, flattened: row ids plus the checklist link on the linked task. */
  function shape(items: HeroItem[]) {
    const linked = items.find((i) => i.id === "with-checklist");
    return {
      ids: items.map((i) => i.id).sort(),
      checklist: linked
        ? { sourceLabel: linked.sourceLabel, href: linked.checklistHref, label: linked.completionLabel, ratio: linked.completionRatio }
        : null,
    };
  }

  const full = shape(agenda(ALL_ON));

  it("everything on shows every row and the checklist link", () => {
    expect(full).toEqual({
      ids: ["bill-reminder", "doc-reminder", "event", "plain", "viewing", "with-checklist"],
      checklist: { sourceLabel: "Checklist", href: "/checklists/cl1", label: "1/3", ratio: { done: 1, total: 3 } },
    });
  });

  // Bill and document reminders belong to Costs and Documents (task-modules.ts).
  it("with Tasks off, reminders stay and open their bill or document side", () => {
    const items = agenda(new Set(ALL_MODULE_IDS.filter((m) => m !== "household")));
    expect(items.find((i) => i.id === "bill-reminder")?.opensAt).toBe("/costs");
    expect(items.find((i) => i.id === "doc-reminder")?.opensAt).toBe("/documents");
  });

  it("with Tasks on, every task row opens the task editor", () => {
    expect(agenda(ALL_ON).filter((i) => i.task).every((i) => i.opensAt === null)).toBe(true);
  });

  const NO_LINK = { sourceLabel: "Task", href: null, label: null, ratio: null };
  const expectedWithout: Partial<Record<ModuleId, ReturnType<typeof shape>>> = {
    household: { ids: ["bill-reminder", "doc-reminder", "event", "viewing"], checklist: null },
    costs: { ids: full.ids.filter((id) => id !== "bill-reminder"), checklist: full.checklist },
    documents: { ids: full.ids.filter((id) => id !== "doc-reminder"), checklist: full.checklist },
    checklists: { ids: full.ids, checklist: NO_LINK },
    search: { ids: full.ids.filter((id) => id !== "viewing"), checklist: full.checklist },
    calendar: { ids: full.ids.filter((id) => id !== "event"), checklist: full.checklist },
    "google-calendar": { ids: full.ids.filter((id) => id !== "event"), checklist: full.checklist },
  };

  it.each(ALL_MODULE_IDS)("turning %s off drops only what needs it", (off) => {
    const on = new Set(ALL_MODULE_IDS.filter((m) => m !== off));
    expect(shape(agenda(on))).toEqual(expectedWithout[off] ?? full);
  });

  it("everything off leaves the agenda empty", () => {
    expect(agenda(new Set())).toEqual([]);
  });

  it("omitted gates count as on (callers that predate them are unchanged)", () => {
    const items = buildHeroItems({
      tasks: [task({ id: "with-checklist", linked_checklist_id: "cl1" })],
      appointments: [],
      apartments: [],
      today: TODAY,
      householdVisible: true,
      searchVisible: false,
      checklistByTaskId: {
        "with-checklist": { href: "/checklists/cl1", completionLabel: "1/3", completion: { done: 1, total: 3 } },
      },
      calendarEvents: [calendarEvent({ id: "event" })],
    });
    expect(items.map((i) => i.id).sort()).toEqual(["event", "with-checklist"]);
    expect(items.find((i) => i.id === "with-checklist")?.checklistHref).toBe("/checklists/cl1");
  });
});

// Modules (module-features.ts): summary-hero modules that show another
// module's data disappear with it; the rest never depend on a module.
describe("isHeroModuleAvailable", () => {
  const HERO_KEYS = [
    "weather", "count", "nextUp", "whosOnHook", "unassignedNudge", "streak",
    "budgetPulse", "billsDue", "shoppingList", "shopperWatch", "setupProgress", "countdown",
    "tipRain", "tipUv", "tipDrying", "tipSunset", "spaceBudget", "spaceBills",
  ];
  const availableWith = (enabled: ReadonlySet<string>) =>
    HERO_KEYS.filter((k) => isHeroModuleAvailable(k, (id) => isFeatureEnabled(id, enabled)));

  it("every gated key names a real feature", () => {
    for (const [key, id] of Object.entries(HERO_MODULE_FEATURES)) {
      expect(HERO_KEYS, key).toContain(key);
      expect(ALL_MODULE_FEATURE_IDS, key).toContain(id);
    }
  });

  it("everything on keeps every module", () => {
    expect(availableWith(new Set(ALL_MODULE_IDS))).toEqual(HERO_KEYS);
  });

  const goneWithout: Partial<Record<ModuleId, string[]>> = {
    household: ["whosOnHook", "unassignedNudge", "streak"],
    costs: ["budgetPulse", "billsDue", "spaceBudget", "spaceBills"],
    groceries: ["shoppingList"],
    setup: ["setupProgress"],
    shopper: ["shopperWatch"],
  };

  it.each(ALL_MODULE_IDS)("turning %s off removes only its hero modules", (off) => {
    const on = new Set(ALL_MODULE_IDS.filter((m) => m !== off));
    const gone = goneWithout[off] ?? [];
    expect(availableWith(on)).toEqual(HERO_KEYS.filter((k) => !gone.includes(k)));
  });

  it("an unknown key needs no module", () => {
    expect(isHeroModuleAvailable("somethingNew", () => false)).toBe(true);
  });
});

describe("countdownDisplay (FLUX-258)", () => {
  it("reads 'today' for a pin dated today", () => {
    expect(countdownDisplay({ label: "Dinner party", date: TODAY }, TODAY)).toEqual({
      label: "Dinner party",
      when: "today",
    });
  });

  it("reads 'tomorrow' for a pin one day out", () => {
    expect(countdownDisplay({ label: "Dinner party", date: "2026-08-01" }, TODAY)).toEqual({
      label: "Dinner party",
      when: "tomorrow",
    });
  });

  it("reads 'in N days' for a pin further out", () => {
    expect(countdownDisplay({ label: "Dinner party", date: "2026-08-04" }, TODAY)).toEqual({
      label: "Dinner party",
      when: "in 4 days",
    });
  });

  it("returns null once the pinned date has passed, without erasing the stored pin", () => {
    expect(countdownDisplay({ label: "Dinner party", date: "2026-07-30" }, TODAY)).toBeNull();
  });

  it("returns null when the label is missing", () => {
    expect(countdownDisplay({ label: "", date: "2026-08-04" }, TODAY)).toBeNull();
  });

  it("returns null when the date is missing", () => {
    expect(countdownDisplay({ label: "Dinner party", date: "" }, TODAY)).toBeNull();
  });

  it("returns null when nothing is pinned", () => {
    expect(countdownDisplay(null, TODAY)).toBeNull();
  });
});

describe("createWriteGate (FLUX-258)", () => {
  it("collapses rapid schedule() calls into exactly one write, with the last value", async () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn(async () => undefined);
      const gate = createWriteGate<number>(write, { delayMs: 500 });
      gate.schedule(1);
      gate.schedule(2);
      gate.schedule(3);
      await vi.advanceTimersByTimeAsync(500);
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flush() writes immediately and cancels the armed timer", async () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn(async () => undefined);
      const gate = createWriteGate<number>(write, { delayMs: 500 });
      gate.schedule(42);
      await gate.flush();
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(42);
      await vi.advanceTimersByTimeAsync(500);
      expect(write).toHaveBeenCalledTimes(1); // the armed timer was cancelled, not just pre-empted
    } finally {
      vi.useRealTimers();
    }
  });

  it("flush() is a no-op when nothing is pending", async () => {
    const write = vi.fn(async () => undefined);
    const gate = createWriteGate<number>(write, { delayMs: 500 });
    await gate.flush();
    expect(write).not.toHaveBeenCalled();
  });

  it("isHolding() is true from the first schedule() until the write settles, then false", async () => {
    vi.useFakeTimers();
    try {
      let resolveWrite: () => void = () => undefined;
      const write = vi.fn(() => new Promise<void>((resolve) => (resolveWrite = resolve)));
      const gate = createWriteGate<number>(write, { delayMs: 500 });

      expect(gate.isHolding()).toBe(false);
      gate.schedule(1);
      expect(gate.isHolding()).toBe(true); // armed timer
      await vi.advanceTimersByTimeAsync(500);
      expect(gate.isHolding()).toBe(true); // write in flight
      resolveWrite();
      await vi.advanceTimersByTimeAsync(0); // flush the resolved write's `.finally`
      expect(gate.isHolding()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("isHolding() returns false after a rejected write settles", async () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn(async () => {
        throw new Error("boom");
      });
      const gate = createWriteGate<number>(write, { delayMs: 500 });
      gate.schedule(1);
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(0); // flush the rejected write's `.finally` + swallowed catch
      expect(gate.isHolding()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still calls write() for a later scheduled value after an earlier write rejected", async () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn((value: number) =>
        value === 1 ? Promise.reject(new Error("boom")) : Promise.resolve(undefined),
      );
      const gate = createWriteGate<number>(write, { delayMs: 500 });

      gate.schedule(1);
      await vi.advanceTimersByTimeAsync(500); // write A starts and rejects
      await vi.advanceTimersByTimeAsync(0); // flush A's swallowed rejection
      expect(gate.isHolding()).toBe(false);

      gate.schedule(2);
      await vi.advanceTimersByTimeAsync(500); // write B must still run, not be silently dropped
      await vi.advanceTimersByTimeAsync(0);
      expect(write).toHaveBeenCalledTimes(2);
      expect(write).toHaveBeenNthCalledWith(2, 2);
      expect(gate.isHolding()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispose() flushes a pending scheduled value", async () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn(async () => undefined);
      const gate = createWriteGate<number>(write, { delayMs: 500 });
      gate.schedule(7);
      gate.dispose();
      // The write is chained through a promise (to serialize concurrent
      // writes in call order), so it now lands on the next microtask rather
      // than synchronously before dispose() returns.
      await vi.advanceTimersByTimeAsync(0);
      expect(write).toHaveBeenCalledWith(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays holding across a write that outlives the debounce, and serializes the second write after the first", async () => {
    vi.useFakeTimers();
    try {
      const resolvers: Array<() => void> = [];
      const write = vi.fn((value: number) => new Promise<void>((resolve) => {
        resolvers.push(resolve);
        void value;
      }));
      const gate = createWriteGate<number>(write, { delayMs: 500 });

      gate.schedule(1);
      await vi.advanceTimersByTimeAsync(500); // write A starts, still unresolved
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenNthCalledWith(1, 1);

      gate.schedule(2);
      await vi.advanceTimersByTimeAsync(500); // write B is scheduled while A is still in flight
      expect(gate.isHolding()).toBe(true); // must not drop to false while A is unresolved
      expect(write).toHaveBeenCalledTimes(1); // B must not start concurrently with A

      resolvers[0](); // resolve A
      await vi.advanceTimersByTimeAsync(0);
      expect(gate.isHolding()).toBe(true); // B has now started and is still in flight
      expect(write).toHaveBeenCalledTimes(2);
      expect(write).toHaveBeenNthCalledWith(2, 2); // A wrote before B, in order

      resolvers[1](); // resolve B
      await vi.advanceTimersByTimeAsync(0);
      expect(gate.isHolding()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls onSettle after each write settles", async () => {
    vi.useFakeTimers();
    try {
      const onSettle = vi.fn();
      const gate = createWriteGate<number>(async () => undefined, { delayMs: 500, onSettle });
      gate.schedule(1);
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(0); // flush the resolved write's `.finally`
      expect(onSettle).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('buildHeroItems: household events', () => {
  const ev = (id: string, startsAt: Date, extra: Partial<import('./types').GroupEvent> = {}) =>
    ({
      id,
      group_id: 'g',
      created_by: 'u1',
      title: `Event ${id}`,
      category: 'social',
      starts_at: startsAt.toISOString(),
      ends_at: null,
      is_all_day: false,
      location: null,
      notes: null,
      private: false,
      created_at: '',
      updated_at: '',
      deleted: false,
      ...extra,
    }) as import('./types').GroupEvent;
  const base = { tasks: [], appointments: [], apartments: [], today: '2026-10-19', householdVisible: true, searchVisible: true };

  it('shows events starting in the range, as inert calendar rows that open the calendar', () => {
    const items = buildHeroItems({
      ...base,
      range: 'week',
      groupEvents: [
        ev('a', new Date(2026, 9, 21, 18, 30), { location: 'Queen Victoria Market' }),
        ev('b', new Date(2026, 9, 30, 10, 0)),
        ev('c', new Date(2026, 9, 22, 9, 0), { deleted: true }),
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['a']);
    expect(items[0]).toMatchObject({ type: 'event', dueDate: '2026-10-21', dueTime: '18:30', sourceLabel: 'Queen Victoria Market' });
    expect(heroItemSectionId(items[0])).toBe('calendar');
    expect(heroItemOpenTarget(items[0])).toEqual({ kind: 'route', href: '/calendar?date=2026-10-21' });
  });

  it('gives an all-day event no time, and drops events when the feature is off', () => {
    const allDay = ev('d', new Date(2026, 9, 19, 0, 0), { is_all_day: true });
    expect(buildHeroItems({ ...base, groupEvents: [allDay] })[0].dueTime).toBeNull();
    expect(buildHeroItems({ ...base, groupEvents: [allDay], groupEventsVisible: false })).toEqual([]);
  });

  it("hides someone else's private event", () => {
    const mine = ev('m', new Date(2026, 9, 19, 9, 0), { private: true, created_by: 'me' });
    const theirs = ev('t', new Date(2026, 9, 19, 9, 0), { private: true, created_by: 'them' });
    expect(buildHeroItems({ ...base, groupEvents: [mine, theirs], viewerId: 'me' }).map((i) => i.id)).toEqual(['m']);
  });
});
