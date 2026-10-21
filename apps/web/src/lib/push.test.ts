import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUsers, type PushPayload } from "./push";

type Row = Record<string, unknown>;

// Just enough of supabase-js for select().in() and delete().in().
function fakeAdmin(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    let deleting = false;
    const q = {
      select: () => q,
      delete: () => ((deleting = true), q),
      in: (col: string, values: unknown[]) => {
        const hit = (r: Row) => values.includes(r[col]);
        if (deleting) tables[table] = tables[table].filter((r) => !hit(r));
        return Promise.resolve({ data: deleting ? null : tables[table].filter(hit), error: null });
      },
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const payload: PushPayload = { title: "Rooftap answered", body: "Sunday works", url: "/assistant/c1", tag: "assistant-c1" };

function expoFetch(tickets: Row[]) {
  return vi.fn(async () => new Response(JSON.stringify({ data: tickets })));
}

describe("sendPushToUsers", () => {
  it("sends to browsers and devices and prunes the dead ones", async () => {
    const tables = {
      push_subscriptions: [
        { user_id: "u1", endpoint: "https://push/live", p256dh: "k", auth: "a" },
        { user_id: "u1", endpoint: "https://push/gone", p256dh: "k", auth: "a" },
        { user_id: "u2", endpoint: "https://push/other", p256dh: "k", auth: "a" },
      ],
      device_push_tokens: [
        { user_id: "u1", expo_push_token: "ExpoPushToken[live]" },
        { user_id: "u1", expo_push_token: "ExpoPushToken[gone]" },
      ],
    };
    const webPush = vi.fn(async (sub: { endpoint: string }, _body: string) => {
      void _body;
      if (sub.endpoint.endsWith("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    const fetchImpl = expoFetch([{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }]);

    const result = await sendPushToUsers(fakeAdmin(tables), ["u1", "u1"], payload, { webPush, fetchImpl });

    expect(result).toEqual({ sent: 2, pruned: 2 });
    expect(webPush).toHaveBeenCalledTimes(2);
    expect(JSON.parse(webPush.mock.calls[0][1])).toEqual(payload);
    const sentBody = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sentBody[0]).toEqual({ to: "ExpoPushToken[live]", title: payload.title, body: payload.body, data: { url: payload.url } });
    expect(tables.push_subscriptions.map((r) => r.endpoint)).toEqual(["https://push/live", "https://push/other"]);
    expect(tables.device_push_tokens.map((r) => r.expo_push_token)).toEqual(["ExpoPushToken[live]"]);
  });

  it("still sends to devices when browser push isn't configured", async () => {
    const tables = {
      push_subscriptions: [{ user_id: "u1", endpoint: "https://push/live", p256dh: "k", auth: "a" }],
      device_push_tokens: [{ user_id: "u1", expo_push_token: "ExpoPushToken[live]" }],
    };
    const result = await sendPushToUsers(fakeAdmin(tables), ["u1"], payload, {
      webPush: null,
      fetchImpl: expoFetch([{ status: "ok" }]),
    });
    expect(result).toEqual({ sent: 1, pruned: 0 });
    expect(tables.push_subscriptions).toHaveLength(1);
  });

  it("does nothing for nobody and never throws", async () => {
    const fetchImpl = vi.fn();
    expect(await sendPushToUsers(fakeAdmin({}), [], payload, { fetchImpl })).toEqual({ sent: 0, pruned: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();

    const broken = { from: () => { throw new Error("db down"); } } as unknown as SupabaseClient;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendPushToUsers(broken, ["u1"], payload)).toEqual({ sent: 0, pruned: 0 });
  });
});
