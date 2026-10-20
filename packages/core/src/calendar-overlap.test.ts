import { describe, expect, it } from "vitest";
import {
  AGENT_COLORS,
  computeCalendarOverlapLayout,
  computeEventOverlapLayout,
  computeOverlapLayout,
  getEventDayBounds,
  getEventsForDay,
  getWeekDays,
  isEventStartDay,
  pickAgentColor,
  startOfWeekFor,
} from "./calendar-overlap";
import type { Appointment, GoogleCalendarEventWithAttribution, GroupEvent } from "./types";

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: "apt-1",
    user_id: "u1",
    group_id: "g1",
    apartment_id: "a1",
    scheduled_at: "2026-08-01T09:00:00.000Z",
    notes: null,
    status: "scheduled",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    deleted: false,
    ...overrides,
  };
}

function groupEvent(overrides: Partial<GroupEvent>): GroupEvent {
  return {
    id: "ev-1",
    group_id: "g1",
    created_by: "u1",
    title: "Test event",
    category: "general",
    starts_at: "2026-08-01T09:00:00.000Z",
    ends_at: null,
    is_all_day: false,
    location: null,
    notes: null,
    private: false,
    deleted: false,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  } as GroupEvent;
}

describe("computeOverlapLayout (appointments)", () => {
  it("places non-overlapping appointments in a single column", () => {
    const local = (h: number, m = 0) => new Date(2026, 7, 1, h, m).toISOString();
    const apps = [appointment({ id: "a", scheduled_at: local(9) }), appointment({ id: "b", scheduled_at: local(11) })];
    const layout = computeOverlapLayout(apps, 30);
    expect(layout.every((e) => e.col === 0 && e.totalCols === 1)).toBe(true);
  });

  it("splits overlapping appointments into separate columns", () => {
    const local = (h: number, m = 0) => new Date(2026, 7, 1, h, m);
    const apps = [
      appointment({ id: "a", scheduled_at: local(9, 0).toISOString() }),
      appointment({ id: "b", scheduled_at: local(9, 15).toISOString() }),
    ];
    const layout = computeOverlapLayout(apps, 30);
    expect(layout).toHaveLength(2);
    expect(new Set(layout.map((e) => e.col)).size).toBe(2);
    expect(layout.every((e) => e.totalCols === 2)).toBe(true);
  });
});

describe("computeEventOverlapLayout (group events) / computeCalendarOverlapLayout (google events)", () => {
  it("excludes all-day events", () => {
    const events = [groupEvent({ id: "allday", is_all_day: true })];
    expect(computeEventOverlapLayout(events)).toHaveLength(0);
  });

  it("gives a solo timed event a single full-width column", () => {
    const events = [groupEvent({})];
    const layout = computeEventOverlapLayout(events);
    expect(layout).toHaveLength(1);
    expect(layout[0].col).toBe(0);
    expect(layout[0].totalCols).toBe(1);
  });

  it("clamps into the visible window instead of dropping an out-of-range event (FLUX-1562 parity)", () => {
    const local = (h: number) => new Date(2026, 7, 1, h, 0).toISOString();
    // starts before the visible window (startHour=8), ends inside it.
    const events = [groupEvent({ starts_at: local(6), ends_at: local(9) })];
    const layout = computeEventOverlapLayout(events, 8, 20);
    expect(layout).toHaveLength(1);
    expect(layout[0].start).toBe(0);
  });

  it("drops an event that falls entirely outside the visible window", () => {
    const local = (h: number) => new Date(2026, 7, 1, h, 0).toISOString();
    const events = [groupEvent({ starts_at: local(1), ends_at: local(2) })];
    expect(computeEventOverlapLayout(events, 8, 20)).toHaveLength(0);
  });

  it("computeCalendarOverlapLayout applies the same packing to Google events", () => {
    const local = (h: number, m = 0) => new Date(2026, 7, 1, h, m).toISOString();
    const events: GoogleCalendarEventWithAttribution[] = [
      { id: "g1", starts_at: local(10), ends_at: local(11), is_all_day: false } as GoogleCalendarEventWithAttribution,
      { id: "g2", starts_at: local(10, 30), ends_at: local(11, 30), is_all_day: false } as GoogleCalendarEventWithAttribution,
    ];
    const layout = computeCalendarOverlapLayout(events);
    expect(new Set(layout.map((e) => e.col)).size).toBe(2);
  });

  it("runs a multi-day timed event's start-day block to the bottom of the column instead of a 15-min sliver (HOUP-104)", () => {
    const events = [
      groupEvent({
        starts_at: new Date(2026, 7, 1, 20, 0).toISOString(),
        ends_at: new Date(2026, 7, 3, 2, 0).toISOString(),
      }),
    ];
    const layout = computeEventOverlapLayout(events, 0, 24);
    expect(layout).toHaveLength(1);
    expect(layout[0].start).toBe(20);
    expect(layout[0].end).toBe(24);
  });
});

describe("getEventDayBounds / isEventStartDay / getEventsForDay (multi-day spanning, HOUP-112)", () => {
  const local = (y: number, m: number, d: number, h = 0) => new Date(y, m, d, h).toISOString();

  it("collapses a null ends_at to a single-day range", () => {
    const ev = groupEvent({ starts_at: local(2026, 7, 1, 9), ends_at: null });
    const { startDay, endDay } = getEventDayBounds(ev);
    expect(startDay.getDate()).toBe(1);
    expect(endDay.getDate()).toBe(1);
  });

  it("spans multiple calendar days when ends_at falls on a later day", () => {
    const ev = groupEvent({ starts_at: local(2026, 7, 1, 9), ends_at: local(2026, 7, 3, 17) });
    const { startDay, endDay } = getEventDayBounds(ev);
    expect(startDay.getDate()).toBe(1);
    expect(endDay.getDate()).toBe(3);
  });

  it("clamps an ends_at before starts_at to a single-day range rather than an inverted span", () => {
    const ev = groupEvent({ starts_at: local(2026, 7, 3, 9), ends_at: local(2026, 7, 1, 17) });
    const { startDay, endDay } = getEventDayBounds(ev);
    expect(startDay.getDate()).toBe(3);
    expect(endDay.getDate()).toBe(3);
  });

  it("treats an end landing exactly on local midnight as belonging to the previous day, not spilling into the next (HOUP-104)", () => {
    // 20:00 -> 00:00 the next day: should occupy only day 1, not day 2.
    const ev = groupEvent({ starts_at: local(2026, 7, 1, 20), ends_at: local(2026, 7, 2, 0) });
    const { startDay, endDay } = getEventDayBounds(ev);
    expect(startDay.getDate()).toBe(1);
    expect(endDay.getDate()).toBe(1);
    expect(isEventStartDay(ev, new Date(2026, 7, 2))).toBe(false);
  });

  it("a midnight end that spans multiple full days still reaches the last calendar day (midnight isn't always exclusive)", () => {
    // 9:00 day1 -> 00:00 day3 legitimately occupies days 1 and 2.
    const ev = groupEvent({ starts_at: local(2026, 7, 1, 9), ends_at: local(2026, 7, 3, 0) });
    const { startDay, endDay } = getEventDayBounds(ev);
    expect(startDay.getDate()).toBe(1);
    expect(endDay.getDate()).toBe(2);
  });

  it("isEventStartDay is true only on the first day of the span", () => {
    const ev = groupEvent({ starts_at: local(2026, 7, 1, 9), ends_at: local(2026, 7, 3, 17) });
    expect(isEventStartDay(ev, new Date(2026, 7, 1))).toBe(true);
    expect(isEventStartDay(ev, new Date(2026, 7, 2))).toBe(false);
    expect(isEventStartDay(ev, new Date(2026, 7, 3))).toBe(false);
  });

  it("getEventsForDay matches every day within [starts_at, ends_at], not just the start day", () => {
    const spanning = groupEvent({ id: "span", starts_at: local(2026, 7, 1, 9), ends_at: local(2026, 7, 3, 17) });
    const single = groupEvent({ id: "single", starts_at: local(2026, 7, 5, 9), ends_at: null });
    const events = [spanning, single];

    expect(getEventsForDay(events, new Date(2026, 7, 1)).map((e) => e.id)).toEqual(["span"]);
    expect(getEventsForDay(events, new Date(2026, 7, 2)).map((e) => e.id)).toEqual(["span"]);
    expect(getEventsForDay(events, new Date(2026, 7, 3)).map((e) => e.id)).toEqual(["span"]);
    expect(getEventsForDay(events, new Date(2026, 7, 4))).toHaveLength(0);
    expect(getEventsForDay(events, new Date(2026, 7, 5)).map((e) => e.id)).toEqual(["single"]);
  });
});

describe("pickAgentColor", () => {
  it("picks a color not already in use when one is available", () => {
    const used = [{ color: "#ef4444" }, { color: "#f97316" }];
    const color = pickAgentColor(used);
    expect(used.some((a) => a.color === color)).toBe(false);
  });

  it("falls back to reusing a color once every color in the pool is already used", () => {
    const used = AGENT_COLORS.map((color) => ({ color }));
    const color = pickAgentColor(used);
    expect(AGENT_COLORS).toContain(color);
  });
});

describe("startOfWeekFor / getWeekDays", () => {
  it("returns the Sunday at local midnight for the containing week", () => {
    const wed = new Date(2026, 7, 5); // Wed 5 Aug 2026
    const start = startOfWeekFor(wed);
    expect(start.getDay()).toBe(0);
    expect(start.getHours()).toBe(0);
    expect(start.getDate()).toBe(2); // Sun 2 Aug 2026
  });

  it("returns 7 consecutive days starting from Sunday", () => {
    const days = getWeekDays(new Date(2026, 7, 5));
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.getDay())).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
