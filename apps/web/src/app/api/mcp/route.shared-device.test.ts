import { describe, expect, it, vi } from "vitest";
import { ALL_MODULE_IDS } from "@homeup/core";
import { MCP_TOOLS } from "@/lib/mcp-tools";

// A connection marked as a shared device on the consent screen, end to end
// through the real POST handler. A voice speaker signs in as one person, but
// anyone in the room hears it.
// undefined: the column is not migrated yet, so "*" leaves it out.
let sharedDevice: boolean | undefined = false;
const tablesRead: string[] = [];

const OCCASIONS = [
  { id: "o1", group_id: "group-a", title: "Noa's birthday", kind: "birthday", date: "1990-03-14", repeats: true, person_id: "user-b", person_name: null, budget_cents: 12300, notes: "secret-note", hidden_from: [], deleted: false },
  { id: "o2", group_id: "group-a", title: "Surprise party", kind: "other", date: "2099-01-01", repeats: false, person_id: null, person_name: "Jo", budget_cents: null, notes: null, hidden_from: ["user-b"], deleted: false },
];
const GIFTS = [{ id: "g1", group_id: "group-a", occasion_id: "o1", title: "secret-gift", status: "idea", price_cents: 500, url: null, notes: null, for_user_id: "user-b", for_name: null, hidden_from: [], deleted: false }];
const WISHES = [{ id: "w1", group_id: "group-a", user_id: "user-b", title: "secret-wish", price_cents: null, url: null, notes: null, deleted: false }];

function chainable(row: unknown, error: unknown = null, rows: unknown[] = []) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    limit: () => builder,
    update: () => builder,
    then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
    single: async () => ({ data: row, error }),
    maybeSingle: async () => ({ data: row, error }),
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: true, error: null }),
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }), getUserById: async () => ({ data: { user: null }, error: null }) } },
    from: (table: string) => {
      tablesRead.push(table);
      if (table === "oauth_tokens") {
        return chainable({
          id: "tok-1",
          user_id: "user-a",
          client_id: "rt_client_x",
          revoked_at: null,
          access_expires_at: new Date(Date.now() + 60_000).toISOString(),
          ...(sharedDevice === undefined ? {} : { shared_device: sharedDevice }),
        });
      }
      if (table === "group_members") return chainable({ group_id: "group-a" }, null, [{ user_id: "user-a" }, { user_id: "user-b" }]);
      if (table === "group_modules") {
        const rows = ALL_MODULE_IDS.map((id) => ({ module_id: id, enabled: true }));
        return { select: () => ({ eq: async () => ({ data: rows, error: null }) }) };
      }
      if (table === "occasions") return chainable(null, null, OCCASIONS);
      if (table === "gift_ideas") return chainable(null, null, GIFTS);
      if (table === "wishlist_items") return chainable(null, null, WISHES);
      return chainable(null);
    },
  }),
}));

import { POST } from "./route";

function rpc(method: string, params?: unknown): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer rt_oat_home-scope-test",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
}

async function listTools(): Promise<{ name: string; description: string }[]> {
  const res = await POST(rpc("tools/list"));
  expect(res.status).toBe(200);
  return (await res.json()).result.tools;
}
const toolNames = async () => (await listTools()).map((t) => t.name).sort();

const ALL_NAMES = MCP_TOOLS.map((t) => t.name).sort();
const BLOCKED = ["add_gift_ideas", "add_occasion", "add_wishlist_items"];

function limited() {
  sharedDevice = true;
}

describe("shared device connection", () => {
  it("keeps every tool for a normal connection, and with the column not migrated yet", async () => {
    sharedDevice = false;
    expect(await toolNames()).toEqual(ALL_NAMES);

    sharedDevice = undefined;
    expect(await toolNames()).toEqual(ALL_NAMES);
  });

  it("hides gift, wishlist and add-occasion tools from a shared device, and only those", async () => {
    limited();
    expect(await toolNames()).toEqual(ALL_NAMES.filter((n) => !BLOCKED.includes(n)));
  });

  it("rejects a direct call to a hidden tool", async () => {
    limited();
    for (const name of BLOCKED) {
      const res = await POST(rpc("tools/call", { name, arguments: {} }));
      const body = await res.json();
      expect(body.error ?? body.result?.isError).toBeTruthy();
    }
  });

  it("gives occasion dates without any gift data, and never reads the gift tables", async () => {
    limited();
    const tools = await listTools();
    expect(tools.find((t) => t.name === "get_occasions")!.description).not.toMatch(/budget|wishlist|ideas/i);

    tablesRead.length = 0;
    const res = await POST(rpc("tools/call", { name: "get_occasions", arguments: {} }));
    const body = await res.json();
    const text = body.result.content[0].text as string;
    const out = JSON.parse(text);

    // The kept occasion stays out; the plain one gives what and when only.
    expect(out.occasions.map((o: { title: string }) => o.title)).toEqual(["Noa's birthday"]);
    expect(Object.keys(out.occasions[0]).sort()).toEqual(["days_to", "kind", "next_date", "person", "title"]);
    for (const leak of ["secret", "12300", "budget", "ideas", "wishlist", "Surprise", "kept_from", "notes"]) {
      expect(text).not.toContain(leak);
    }
    expect(tablesRead).not.toContain("gift_ideas");
    expect(tablesRead).not.toContain("wishlist_items");
  });

  it("still gives the full occasions output to a normal connection", async () => {
    sharedDevice = false;
    const res = await POST(rpc("tools/call", { name: "get_occasions", arguments: {} }));
    const text = (await res.json()).result.content[0].text as string;
    expect(text).toContain("secret-gift");
    expect(text).toContain("secret-wish");
  });
});
