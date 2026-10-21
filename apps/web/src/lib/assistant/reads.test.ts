import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantConversation, AssistantMessage } from "@homeup/core";

vi.mock("@/lib/push", () => ({ sendPushToUsers: vi.fn(async () => ({ sent: 1, pruned: 0 })) }));

import { sendPushToUsers } from "@/lib/push";
import { isUnread, markConversationRead, notifyIfAway, replyPush } from "./reads";

type Row = Record<string, unknown>;

// Just the shapes reads.ts uses: select/eq/in/maybeSingle and upsert.
function fakeAdmin(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    tables[table] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    const rows = () => tables[table].filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null }),
      upsert: async (row: Row, { onConflict }: { onConflict: string }) => {
        const keys = onConflict.split(",");
        const hit = tables[table].find((r) => keys.every((k) => r[k] === row[k]));
        if (hit) Object.assign(hit, row);
        else tables[table].push({ ...row });
        return { error: null };
      },
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const conversation: AssistantConversation = {
  id: "c1",
  kind: "chat",
  title: "Plan Sunday BBQ",
  pinned: false,
  last_active_at: "2026-10-26T18:42:05Z",
  closes_at: null,
  pending: 0,
};

const reply: AssistantMessage = {
  id: "m2",
  role: "assistant",
  content: "Sunday works, **nobody** has plans after 2pm. [Calendar](https://example.com/cal)",
  author: null,
  channel: "app",
  created_at: "2026-10-26T18:42:05Z",
  proposal: null,
  cost_micros: null,
};

const noWait = { sleep: async () => {} };

describe("isUnread", () => {
  it("treats no row as read and a later activity as news", () => {
    expect(isUnread("2026-10-26T18:00:00Z", undefined)).toBe(false);
    expect(isUnread("2026-10-26T18:00:00Z", { read_at: null, seen_at: "2026-10-26T18:00:01Z" })).toBe(true);
    expect(isUnread("2026-10-26T18:00:00Z", { read_at: "2026-10-26T17:59:00Z", seen_at: null })).toBe(true);
    expect(isUnread("2026-10-26T18:00:00Z", { read_at: "2026-10-26T18:00:00Z", seen_at: null })).toBe(false);
  });
});

describe("replyPush", () => {
  it("shows plain text, or nothing when previews are off", () => {
    expect(replyPush(conversation, reply, { replies: true, preview: true })).toEqual({
      title: "Rooftap answered: Plan Sunday BBQ",
      body: "Sunday works, nobody has plans after 2pm. Calendar",
      url: "/assistant/c1",
      tag: "assistant-c1",
    });
    expect(replyPush(conversation, reply, { replies: true, preview: false })?.body).toBe("Tap to read it.");
  });

  it("leads with a change waiting on an OK", () => {
    const asking = {
      ...reply,
      proposal: { state: "pending" as const, items: [{ tool: "add", module: "groceries" as const, args: {}, summary: 'Add "Milk" to Groceries' }] },
    };
    expect(replyPush(conversation, asking, { replies: true, preview: true })).toMatchObject({
      title: "Rooftap needs your OK",
      body: 'Add "Milk" to Groceries',
    });
  });
});

describe("notifyIfAway", () => {
  it("pushes a reply nobody saw", async () => {
    const admin = fakeAdmin({ assistant_reads: [{ user_id: "u1", conversation_id: "c1", read_at: "2026-10-26T18:41:50Z", seen_at: null }] });
    expect(await notifyIfAway({ admin, userId: "u1", groupId: "g1" }, conversation, reply, noWait)).toBe("sent");
    expect(sendPushToUsers).toHaveBeenCalledWith(admin, ["u1"], expect.objectContaining({ url: "/assistant/c1" }), noWait);
  });

  it("stays quiet once the app read or showed it", async () => {
    const admin = fakeAdmin({});
    const who = { admin, userId: "u1", groupId: "g1" };
    await markConversationRead(who, "c1", { seen: true, at: new Date("2026-10-26T18:42:06Z") });
    expect(await notifyIfAway(who, conversation, reply, noWait)).toBe("noticed");
  });

  it("respects the person's switch", async () => {
    const admin = fakeAdmin({ assistant_notify_prefs: [{ user_id: "u1", replies: false, preview: true }] });
    expect(await notifyIfAway({ admin, userId: "u1", groupId: "g1" }, conversation, reply, noWait)).toBe("off");
  });
});
