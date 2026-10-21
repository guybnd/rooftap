import { describe, expect, it } from "vitest";
import {
  NOW_QUEUE_MAX,
  earnedAllClear,
  feedDayLabel,
  feedRowWhen,
  groupFeedItems,
  heroItemOpenTarget,
  heroItemSectionId,
  meterSegments,
  nowQueueIndex,
  pickNowItem,
  pickNowQueue,
  todayProgress,
} from "./feed";
import type { HeroItem } from "./hero";
import type { Appointment, GoogleCalendarEventWithAttribution, HouseholdTask } from "./types";

const TODAY = "2026-10-18"; // a Sunday

function item(overrides: Partial<HeroItem> = {}): HeroItem {
  return {
    id: overrides.id ?? "i1",
    type: "task",
    ownerSection: "household",
    title: "Bins",
    dueDate: TODAY,
    dueTime: null,
    overdue: false,
    done: false,
    assignedTo: null,
    sourceLabel: "Task",
    ...overrides,
  };
}

function taskWithKey(template_key: string | null): HouseholdTask {
  return { template_key } as HouseholdTask;
}

describe("feedDayLabel", () => {
  it("collapses past dates into Earlier", () => {
    expect(feedDayLabel("2026-10-01", TODAY)).toBe("Earlier");
    expect(feedDayLabel("2026-10-17", TODAY)).toBe("Earlier");
  });

  it("names today and tomorrow", () => {
    expect(feedDayLabel(TODAY, TODAY)).toBe("Today");
    expect(feedDayLabel("2026-10-19", TODAY)).toBe("Tomorrow");
  });

  it("uses the weekday inside the coming week, a short date past it", () => {
    expect(feedDayLabel("2026-10-21", TODAY)).toBe("Wednesday");
    expect(feedDayLabel("2026-10-24", TODAY)).toBe("Saturday");
    expect(feedDayLabel("2026-10-25", TODAY)).toBe("Sun, Oct 25");
  });
});

describe("groupFeedItems", () => {
  it("orders Earlier, then days, then undated, keeping item order inside a group", () => {
    const groups = groupFeedItems(
      [
        item({ id: "a", dueDate: "2026-10-19" }),
        item({ id: "b", dueDate: "2026-10-10", overdue: true }),
        item({ id: "c", dueDate: null }),
        item({ id: "d", dueDate: TODAY }),
        item({ id: "e", dueDate: "2026-10-16", overdue: true }),
        item({ id: "f", dueDate: TODAY }),
      ],
      TODAY
    );
    expect(groups.map((g) => [g.key, g.label, g.items.map((i) => i.id)])).toEqual([
      ["earlier", "Earlier", ["b", "e"]],
      [TODAY, "Today", ["d", "f"]],
      ["2026-10-19", "Tomorrow", ["a"]],
      ["none", "No date", ["c"]],
    ]);
  });

  it("returns no groups for no items", () => {
    expect(groupFeedItems([], TODAY)).toEqual([]);
  });
});

describe("heroItemSectionId", () => {
  it("maps each kind of item to the section whose tile it wears", () => {
    expect(heroItemSectionId(item())).toBe("household");
    expect(heroItemSectionId(item({ type: "appointment" }))).toBe("search");
    expect(heroItemSectionId(item({ type: "calendar" }))).toBe("calendar");
    expect(heroItemSectionId(item({ checklistHref: "/checklists/x" }))).toBe("checklists");
    expect(heroItemSectionId(item({ type: "reminder", task: taskWithKey("cost-reminder:c1:expiry") }))).toBe("costs");
    expect(heroItemSectionId(item({ type: "reminder", task: taskWithKey("doc-reminder:d1:expiry") }))).toBe("documents");
    expect(heroItemSectionId(item({ type: "reminder", task: taskWithKey("tracked-item-reminder:t1:expiry") }))).toBe("household");
  });
});

describe("todayProgress", () => {
  it("counts open and finished items", () => {
    expect(todayProgress([item({ done: true }), item(), item({ type: "appointment" })])).toEqual({ left: 2, done: 1, total: 3 });
    expect(todayProgress([])).toEqual({ left: 0, done: 0, total: 0 });
  });
});

describe("pickNowItem", () => {
  it("prefers the soonest timed open item", () => {
    const now = pickNowItem(
      [
        item({ id: "late", dueTime: "18:00" }),
        item({ id: "done", dueTime: "07:00", done: true }),
        item({ id: "soon", dueTime: "09:30" }),
        item({ id: "overdue", dueDate: "2026-10-15", overdue: true }),
      ],
      TODAY
    );
    expect(now?.id).toBe("soon");
  });

  it("falls back to an overdue to-do, then one due today", () => {
    expect(pickNowItem([item({ id: "today" }), item({ id: "old", dueDate: "2026-10-01", overdue: true })], TODAY)?.id).toBe("old");
    expect(pickNowItem([item({ id: "undated", dueDate: null }), item({ id: "today" })], TODAY)?.id).toBe("today");
  });

  it("never picks an undated or finished item", () => {
    expect(pickNowItem([item({ dueDate: null }), item({ done: true })], TODAY)).toBeNull();
  });
});

describe("pickNowQueue", () => {
  it("orders timed items soonest first, then overdue, then due today, without repeats", () => {
    const queue = pickNowQueue(
      [
        item({ id: "today-a" }),
        item({ id: "late", dueTime: "18:00" }),
        item({ id: "old", dueDate: "2026-10-01", overdue: true }),
        item({ id: "done", dueTime: "07:00", done: true }),
        item({ id: "undated", dueDate: null }),
        item({ id: "soon", dueTime: "09:30" }),
        item({ id: "old-timed", dueDate: "2026-10-12", dueTime: "20:00", overdue: true }),
        item({ id: "today-b" }),
      ],
      TODAY
    );
    expect(queue.map((i) => i.id)).toEqual(["old-timed", "soon", "late", "old", "today-a", "today-b"]);
  });

  it("caps the queue and always leads with pickNowItem", () => {
    const many = Array.from({ length: 12 }, (_, n) => item({ id: `t${n}` }));
    expect(pickNowQueue(many, TODAY)).toHaveLength(NOW_QUEUE_MAX);
    expect(pickNowQueue(many, TODAY, 3).map((i) => i.id)).toEqual(["t0", "t1", "t2"]);
    expect(pickNowQueue(many, TODAY)[0]).toBe(pickNowItem(many, TODAY));
  });

  it("is empty when nothing can take the card", () => {
    expect(pickNowQueue([item({ dueDate: null }), item({ done: true }), item({ dueDate: "2026-10-19" })], TODAY)).toEqual([]);
  });
});

describe("nowQueueIndex", () => {
  const ids = ["a", "b", "c"];
  it("follows the head until the person pages, then stays on their item", () => {
    expect(nowQueueIndex(ids, null, 2)).toBe(0);
    expect(nowQueueIndex(ids, "b", 0)).toBe(1);
    expect(nowQueueIndex(["z", ...ids], "b", 1)).toBe(2);
  });

  it("keeps the position when the item leaves, so the next one takes its place", () => {
    expect(nowQueueIndex(["a", "c"], "b", 1)).toBe(1);
    expect(nowQueueIndex(["a", "b"], "c", 2)).toBe(1);
    expect(nowQueueIndex([], "c", 2)).toBe(0);
  });
});

describe("heroItemOpenTarget", () => {
  const task = { id: "t1", template_key: null } as HouseholdTask;
  it("opens a dated checklist's to-do on its checklist", () => {
    expect(heroItemOpenTarget(item({ task, checklistHref: "/checklists/c1" }))).toEqual({ kind: "route", href: "/checklists/c1" });
  });

  it("opens a reminder shown while Tasks isn't on its owner screen, other tasks in their editor", () => {
    expect(heroItemOpenTarget(item({ type: "reminder", task, opensAt: "/costs" }))).toEqual({ kind: "route", href: "/costs" });
    expect(heroItemOpenTarget(item({ task }))).toEqual({ kind: "task", task });
  });

  it("opens a viewing's listing and a pulled event in Google Calendar", () => {
    const appointment = { id: "a1", apartment_id: "apt1" } as Appointment;
    expect(heroItemOpenTarget(item({ type: "appointment", appointment }))).toEqual({ kind: "route", href: "/apartment/apt1" });
    const googleEvent = { id: "e1", html_link: "https://calendar.google.com/e1" } as GoogleCalendarEventWithAttribution;
    expect(heroItemOpenTarget(item({ type: "calendar", googleEvent }))).toEqual({ kind: "external", url: "https://calendar.google.com/e1" });
  });

  it("has nowhere to go for an event without a link", () => {
    const googleEvent = { id: "e1", html_link: null } as GoogleCalendarEventWithAttribution;
    expect(heroItemOpenTarget(item({ type: "calendar", googleEvent }))).toBeNull();
  });
});

describe("meterSegments", () => {
  it("draws one segment per item up to the cap", () => {
    expect(meterSegments(3, 7)).toEqual({ count: 7, filled: 3 });
    expect(meterSegments(0, 7)).toEqual({ count: 7, filled: 0 });
    expect(meterSegments(0, 0)).toEqual({ count: 0, filled: 0 });
  });

  it("scales a big day down to the cap", () => {
    expect(meterSegments(10, 20)).toEqual({ count: 10, filled: 5 });
    expect(meterSegments(20, 20)).toEqual({ count: 10, filled: 10 });
  });

  it("never rounds a real finish away, and fills the last segment only when everything is done", () => {
    expect(meterSegments(1, 25)).toEqual({ count: 10, filled: 1 });
    expect(meterSegments(0, 25)).toEqual({ count: 10, filled: 0 });
    expect(meterSegments(24, 25)).toEqual({ count: 10, filled: 9 });
    expect(meterSegments(25, 25)).toEqual({ count: 10, filled: 10 });
  });
});

describe("earnedAllClear", () => {
  const items = [item({ id: "a", done: true }), item({ id: "b" })];
  it("fires when the last open item is finished", () => {
    expect(earnedAllClear(items, "b", null, TODAY)).toBe(true);
    expect(earnedAllClear(items, "b", "2026-10-17", TODAY)).toBe(true);
  });

  it("stays quiet while something else is open, for an item off today's list, or once shown today", () => {
    expect(earnedAllClear([...items, item({ id: "c", type: "appointment" })], "b", null, TODAY)).toBe(false);
    expect(earnedAllClear(items, "zzz", null, TODAY)).toBe(false);
    expect(earnedAllClear(items, "a", null, TODAY)).toBe(false);
    expect(earnedAllClear(items, "b", TODAY, TODAY)).toBe(false);
  });
});

describe("feedRowWhen", () => {
  it("says nothing for an untimed item, since its day header names the day", () => {
    expect(feedRowWhen(item({ dueDate: "2026-10-19" }), TODAY)).toBeNull();
    expect(feedRowWhen(item({ dueDate: null }), TODAY)).toBeNull();
  });

  it("gives a timed item its time", () => {
    expect(feedRowWhen(item({ dueTime: "18:30" }), TODAY)).toEqual({ kind: "time", time: "18:30" });
  });

  it("counts how late an overdue item is", () => {
    expect(feedRowWhen(item({ dueDate: "2026-10-15", overdue: true }), TODAY)).toEqual({ kind: "overdue", text: "3d overdue" });
    expect(feedRowWhen(item({ dueDate: TODAY, dueTime: "08:00", overdue: true }), TODAY)).toEqual({ kind: "overdue", text: "Overdue" });
  });
});
