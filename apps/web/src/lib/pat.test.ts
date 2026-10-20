import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateToken,
  hashToken,
  resolvePatUser,
  resolveGroupId,
  checkPatRateLimit,
  isPatExpired,
  patExpiresAt,
  visibleTasks,
  visibleEvents,
  visibleGroceryItems,
} from "./pat";
import type { HouseholdTask, GroupEvent, GroceryItem } from '@homeup/core';

function task(overrides: Partial<HouseholdTask>): HouseholdTask {
  return {
    id: "task-id",
    group_id: "group-1",
    title: "Test task",
    due_date: null,
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
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
    deleted: false,
    ...overrides,
  };
}

function event(overrides: Partial<GroupEvent>): GroupEvent {
  return {
    id: "event-id",
    group_id: "group-1",
    created_by: null,
    title: "Test event",
    category: "general",
    starts_at: "2026-07-22T00:00:00.000Z",
    ends_at: null,
    is_all_day: false,
    location: null,
    notes: null,
    private: false,
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
    deleted: false,
    ...overrides,
  };
}

function groceryItem(overrides: Partial<GroceryItem>): GroceryItem {
  return {
    id: "grocery-id",
    group_id: "group-1",
    name: "Test item",
    aisle: "other",
    quantity: null,
    unit: null,
    status: "needed",
    notes: null,
    assigned_to: null,
    private: false,
    template_key: null,
    sort_order: 0,
    created_by: null,
    updated_by: null,
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
    deleted: false,
    recurrence_days: null,
    status_changed_at: null,
    last_purchased_at: null,
    last_price: null,
    lowest_price: null,
    expiry_date: null,
    shelf_life_days: null,
    price_cents: null,
    is_essential: false,
    recipe_note: null,
    recipe_source_id: null,
    re_add_snoozed_until: null,
    re_add_dismissed_at: null,
    ...overrides,
  };
}

// A throwing stub: proves header-parsing short-circuits never reach the DB.
const throwingAdmin = {
  from() {
    throw new Error("admin.from should never be called for malformed headers");
  },
} as unknown as SupabaseClient;

// A small local chainable-builder stub matching the shape `.from(...).select(...).eq(...).single()`
// used by resolvePatUser / resolveGroupId, plus a no-op `.update(...).eq(...)` for the
// fire-and-forget last_used_at bump.
function fakeAdmin(result: { data: unknown; error: unknown }): SupabaseClient {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    limit() {
      return builder;
    },
    single() {
      return Promise.resolve(result);
    },
    update() {
      return builder;
    },
  };
  return {
    from() {
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("hashToken", () => {
  it("is deterministic for the same input", () => {
    expect(hashToken("abc123")).toBe(hashToken("abc123"));
  });

  it("produces a 64-char lowercase hex digest", () => {
    expect(hashToken("abc123")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different inputs", () => {
    expect(hashToken("abc123")).not.toBe(hashToken("abc124"));
  });

  it("never echoes back the plaintext", () => {
    expect(hashToken("my-raw-token")).not.toContain("my-raw-token");
  });
});

describe("generateToken", () => {
  it("matches the houp_pat_ + 64 hex char shape", () => {
    expect(generateToken()).toMatch(/^houp_pat_[0-9a-f]{64}$/);
  });

  it("produces unique tokens across many calls", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateToken()));
    expect(tokens.size).toBe(20);
  });
});

describe("resolvePatUser header parsing (no DB call for malformed input)", () => {
  it("returns null for a null header", async () => {
    await expect(resolvePatUser(throwingAdmin, null)).resolves.toBeNull();
  });

  it("returns null for an empty header", async () => {
    await expect(resolvePatUser(throwingAdmin, "")).resolves.toBeNull();
  });

  it("returns null for a non-Bearer scheme", async () => {
    await expect(resolvePatUser(throwingAdmin, "Basic abc123")).resolves.toBeNull();
  });

  it("returns null for 'Bearer' with no token", async () => {
    await expect(resolvePatUser(throwingAdmin, "Bearer")).resolves.toBeNull();
  });

  it("returns null for 'Bearer ' with trailing space and nothing else", async () => {
    await expect(resolvePatUser(throwingAdmin, "Bearer ")).resolves.toBeNull();
  });
});

describe("resolvePatUser DB-backed lookups", () => {
  it("resolves to { userId, patId } for a matching non-revoked row", async () => {
    const admin = fakeAdmin({ data: { id: "pat-1", user_id: "user-1", revoked_at: null }, error: null });
    await expect(resolvePatUser(admin, "Bearer houp_pat_abc")).resolves.toEqual({
      userId: "user-1",
      patId: "pat-1",
    });
  });

  it("returns null when no row matches", async () => {
    const admin = fakeAdmin({ data: null, error: null });
    await expect(resolvePatUser(admin, "Bearer houp_pat_abc")).resolves.toBeNull();
  });

  it("returns null for a revoked token", async () => {
    const admin = fakeAdmin({
      data: { id: "pat-1", user_id: "user-1", revoked_at: "2026-07-01T00:00:00.000Z" },
      error: null,
    });
    await expect(resolvePatUser(admin, "Bearer houp_pat_abc")).resolves.toBeNull();
  });
});

describe("resolveGroupId", () => {
  it("returns the group_id when a membership row exists", async () => {
    const admin = fakeAdmin({ data: { group_id: "group-1" }, error: null });
    await expect(resolveGroupId(admin, "user-1")).resolves.toBe("group-1");
  });

  it("returns null (not throw) when the user belongs to zero groups", async () => {
    const admin = fakeAdmin({ data: null, error: null });
    await expect(resolveGroupId(admin, "user-1")).resolves.toBeNull();
  });
});

describe("visibleTasks", () => {
  it("excludes a tombstoned task even if not private", () => {
    const tasks = [task({ id: "t1", deleted: true, private: false })];
    expect(visibleTasks(tasks, "user-a")).toEqual([]);
  });

  it("excludes a private task assigned to another user", () => {
    const tasks = [task({ id: "t1", private: true, assigned_to: "user-b" })];
    expect(visibleTasks(tasks, "user-a")).toEqual([]);
  });

  it("includes a private task assigned to the requesting user", () => {
    const tasks = [task({ id: "t1", private: true, assigned_to: "user-b" })];
    expect(visibleTasks(tasks, "user-b").map((t) => t.id)).toEqual(["t1"]);
  });

  it("includes a non-private task regardless of assigned_to", () => {
    const tasks = [task({ id: "t1", private: false, assigned_to: "user-b" })];
    expect(visibleTasks(tasks, "user-a").map((t) => t.id)).toEqual(["t1"]);
  });

  it("excludes a tombstoned task for every user, not just non-owners", () => {
    const tasks = [task({ id: "t1", deleted: true, private: true, assigned_to: "user-a" })];
    expect(visibleTasks(tasks, "user-a")).toEqual([]);
    expect(visibleTasks(tasks, "user-b")).toEqual([]);
  });
});

describe("visibleEvents", () => {
  it("excludes a tombstoned event even if not private", () => {
    const events = [event({ id: "e1", deleted: true, private: false })];
    expect(visibleEvents(events, "user-a")).toEqual([]);
  });

  it("excludes a private event created by another user", () => {
    const events = [event({ id: "e1", private: true, created_by: "user-b" })];
    expect(visibleEvents(events, "user-a")).toEqual([]);
  });

  it("includes a private event created by the requesting user", () => {
    const events = [event({ id: "e1", private: true, created_by: "user-b" })];
    expect(visibleEvents(events, "user-b").map((e) => e.id)).toEqual(["e1"]);
  });

  it("includes a non-private event regardless of created_by", () => {
    const events = [event({ id: "e1", private: false, created_by: "user-b" })];
    expect(visibleEvents(events, "user-a").map((e) => e.id)).toEqual(["e1"]);
  });

  it("excludes a tombstoned event for every user, not just non-owners", () => {
    const events = [event({ id: "e1", deleted: true, private: true, created_by: "user-a" })];
    expect(visibleEvents(events, "user-a")).toEqual([]);
    expect(visibleEvents(events, "user-b")).toEqual([]);
  });
});

describe("visibleGroceryItems", () => {
  it("excludes a tombstoned item even if not private", () => {
    const items = [groceryItem({ id: "g1", deleted: true, private: false })];
    expect(visibleGroceryItems(items, "user-a")).toEqual([]);
  });

  it("excludes a private item assigned to another user", () => {
    const items = [groceryItem({ id: "g1", private: true, assigned_to: "user-b" })];
    expect(visibleGroceryItems(items, "user-a")).toEqual([]);
  });

  it("includes a private item assigned to the requesting user", () => {
    const items = [groceryItem({ id: "g1", private: true, assigned_to: "user-b" })];
    expect(visibleGroceryItems(items, "user-b").map((i) => i.id)).toEqual(["g1"]);
  });

  it("includes a non-private item regardless of assigned_to", () => {
    const items = [groceryItem({ id: "g1", private: false, assigned_to: "user-b" })];
    expect(visibleGroceryItems(items, "user-a").map((i) => i.id)).toEqual(["g1"]);
  });

  it("excludes a tombstoned item for every user, not just non-owners", () => {
    const items = [groceryItem({ id: "g1", deleted: true, private: true, assigned_to: "user-a" })];
    expect(visibleGroceryItems(items, "user-a")).toEqual([]);
    expect(visibleGroceryItems(items, "user-b")).toEqual([]);
  });
});

describe("token expiry", () => {
  it("uses expires_at when set", () => {
    expect(patExpiresAt({ expires_at: "2027-01-01T00:00:00.000Z" })).toBe("2027-01-01T00:00:00.000Z");
  });

  it("treats a missing or infinite expiry as never", () => {
    expect(patExpiresAt({ expires_at: null })).toBeNull();
    expect(patExpiresAt({})).toBeNull();
    expect(patExpiresAt({ expires_at: "infinity" })).toBeNull();
  });

  it("treats a past expiry as expired and a future or missing one as live", () => {
    const now = Date.parse("2026-10-19T00:00:00.000Z");
    expect(isPatExpired("2026-10-18T00:00:00.000Z", now)).toBe(true);
    expect(isPatExpired("2026-10-20T00:00:00.000Z", now)).toBe(false);
    expect(isPatExpired(null, now)).toBe(false);
  });

  it("resolvePatUser rejects an expired token", async () => {
    const admin = fakeAdmin({
      data: { id: "pat-1", user_id: "user-1", revoked_at: null, expires_at: "2020-01-01T00:00:00.000Z" },
      error: null,
    });
    await expect(resolvePatUser(admin, "Bearer houp_pat_abc")).resolves.toBeNull();
  });

  it("resolvePatUser accepts a key that never expires", async () => {
    const admin = fakeAdmin({
      data: { id: "pat-1", user_id: "user-1", revoked_at: null, expires_at: "infinity" },
      error: null,
    });
    await expect(resolvePatUser(admin, "Bearer houp_pat_abc")).resolves.toEqual({ userId: "user-1", patId: "pat-1" });
  });
});

describe("checkPatRateLimit", () => {
  function rpcAdmin(result: { data: unknown; error: unknown }): SupabaseClient {
    return { rpc: async () => result } as unknown as SupabaseClient;
  }

  it("allows a request within budget", async () => {
    await expect(checkPatRateLimit(rpcAdmin({ data: true, error: null }), "pat-1")).resolves.toBe(true);
  });

  it("blocks a request over budget", async () => {
    await expect(checkPatRateLimit(rpcAdmin({ data: false, error: null }), "pat-1")).resolves.toBe(false);
  });

  it("fails open when the counter errors", async () => {
    await expect(
      checkPatRateLimit(rpcAdmin({ data: null, error: { message: "function does not exist" } }), "pat-1"),
    ).resolves.toBe(true);
  });
});
