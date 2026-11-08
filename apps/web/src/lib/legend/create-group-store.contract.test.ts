// @vitest-environment jsdom
//
// Sync contract tests: the real createGroupStore (packages/core) and the web
// StoreEnvironment against a real Supabase database. The other store tests use
// a fake query builder, and the sync bugs it could not model were each found
// in production: a foreign key (#644), a unique index (#520), full-pull
// tombstones (#661), and a deleted row that came back after an offline edit.
//
// Skipped unless SYNC_CONTRACT_SUPABASE_URL and SYNC_CONTRACT_SERVICE_KEY name
// a local Supabase with the migrations applied. The nightly "Sync contract"
// workflow starts one. By hand:
//
//   npx supabase start -x studio,imgproxy,storage-api,edge-runtime,logflare,vector,mailpit,supavisor,postgres-meta
//   SYNC_CONTRACT_SUPABASE_URL=http://127.0.0.1:54321 \
//   SYNC_CONTRACT_SERVICE_KEY=<SERVICE_ROLE_KEY from `npx supabase status`> \
//   npx vitest run src/lib/legend/create-group-store.contract.test.ts
//
// The client uses the service role, so row-level security is not under test
// here. Realtime is stubbed: each test pulls by hand, so the order of events
// is the test's, not the network's.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { createClient as createSupabaseJs } from "@supabase/supabase-js";
import { syncState } from "@legendapp/state";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const URL_ = process.env.SYNC_CONTRACT_SUPABASE_URL;
const KEY = process.env.SYNC_CONTRACT_SERVICE_KEY;

type Row = Record<string, unknown>;

let online = true;
/** Extra wait before a request to a table reaches the server. */
const slowTables = new Map<string, number>();

async function contractFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!online) throw new TypeError("Failed to fetch");
  const url = String(input instanceof Request ? input.url : input);
  for (const [table, ms] of slowTables) {
    if (url.includes(`/rest/v1/${table}?`) && (init?.method ?? "GET") !== "GET") await new Promise((r) => setTimeout(r, ms));
  }
  return fetch(input, init);
}

// The app's client: real requests, switchable offline, realtime stubbed.
const real = URL_ && KEY ? createSupabaseJs(URL_, KEY, { auth: { persistSession: false }, global: { fetch: contractFetch } }) : null;
// The other device and the test's own checks: always online.
const admin = URL_ && KEY ? createSupabaseJs(URL_, KEY, { auth: { persistSession: false } }) : null;

const appClient = real && {
  from: real.from.bind(real),
  rpc: real.rpc.bind(real),
  auth: real.auth,
  channel() {
    const chain = { on: () => chain, subscribe: (cb?: (s: string) => void) => (cb?.("SUBSCRIBED"), chain) };
    return chain;
  },
  removeChannel: () => {},
};

vi.mock("@/lib/supabase/client", () => ({ createClient: () => appClient }));

Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });

async function pollUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("pollUntil: timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Store = any;

async function loaded(store$: Store): Promise<void> {
  store$.peek();
  await pollUntil(() => Boolean(syncState(store$).peek()?.isLoaded));
}

/** A fresh device: no local cache, a fresh module graph and StoreEnvironment. */
async function freshDevice() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  await import("./environment");
  return import("@homeup/core");
}

async function serverRow(table: string, id: string): Promise<Row | null> {
  const { data, error } = await admin!.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Row | null;
}

let userId = "";
let groupId = "";

describe.skipIf(!real)("createGroupStore against a real database", () => {
  beforeAll(async () => {
    const email = `contract-${crypto.randomUUID()}@example.com`;
    const { data, error } = await admin!.auth.admin.createUser({ email, password: crypto.randomUUID(), email_confirm: true });
    if (error) throw new Error(error.message);
    userId = data.user.id;
  });

  beforeEach(async () => {
    online = true;
    slowTables.clear();
    groupId = crypto.randomUUID();
    const { error } = await admin!.from("groups").insert({ id: groupId, name: "Contract", created_by: userId });
    if (error) throw new Error(error.message);
  });

  it("keeps a row deleted when an offline edit to it arrives after another device deleted it", async () => {
    const id = crypto.randomUUID();
    await admin!.from("grocery_items").insert({ id, group_id: groupId, name: "Milk" });

    const { groceryItems$ } = await freshDevice();
    const store$ = groceryItems$(groupId) as Store;
    await loaded(store$);
    expect(store$[id].name.peek()).toBe("Milk");

    // This device goes offline. Another device deletes the row.
    online = false;
    await new Promise((r) => setTimeout(r, 1100));
    const del = await admin!.from("grocery_items").update({ deleted: true }).eq("id", id);
    expect(del.error).toBeNull();

    // This device edits its old copy, then comes back online and pushes it.
    store$[id].name.set("Oat milk");
    online = true;
    await pollUntil(async () => (await serverRow("grocery_items", id))?.name === "Oat milk");

    expect((await serverRow("grocery_items", id))?.deleted).toBe(true);
    // The server's answer reaches this device, so the row leaves here too.
    await pollUntil(() => {
      const local = store$[id].peek() as Row | undefined;
      return !local || local.deleted === true;
    });
  }, 30_000);

  it("still restores a deleted row from a device that saw the delete", async () => {
    const { groceryItems$ } = await freshDevice();
    const store$ = groceryItems$(groupId) as Store;
    await loaded(store$);
    const id = crypto.randomUUID();
    store$[id].set({ id, group_id: groupId, name: "Eggs", deleted: false, created_at: null, updated_at: null });
    await pollUntil(() => Boolean(store$[id].created_at.peek()));

    store$[id].deleted.set(true);
    await pollUntil(async () => (await serverRow("grocery_items", id))?.deleted === true);
    await pollUntil(() => {
      const local = store$[id].peek() as Row | undefined;
      return !local || local.deleted === true;
    });
    await new Promise((r) => setTimeout(r, 300));

    // Undo: the same device writes the row back.
    const local = store$[id].peek() as Row | undefined;
    store$[id].set({ ...(local ?? { id, group_id: groupId, name: "Eggs", created_at: "x" }), deleted: false });
    await pollUntil(async () => (await serverRow("grocery_items", id))?.deleted === false);
  }, 30_000);

  it("saves a checklist's items when they reach the server before the checklist (foreign key)", async () => {
    const { checklists$, checklistItems$ } = await freshDevice();
    const lists$ = checklists$(groupId) as Store;
    const items$ = checklistItems$(groupId) as Store;
    await loaded(lists$);
    await loaded(items$);

    slowTables.set("checklists", 800);
    const listId = crypto.randomUUID();
    const itemIds = [crypto.randomUUID(), crypto.randomUUID()];
    lists$[listId].set({ id: listId, group_id: groupId, title: "Move out", deleted: false, created_at: null, updated_at: null });
    itemIds.forEach((id, i) =>
      items$[id].set({ id, group_id: groupId, checklist_id: listId, label: `Step ${i + 1}`, deleted: false, created_at: null, updated_at: null }),
    );

    await pollUntil(async () => {
      const { data } = await admin!.from("checklist_task_items").select("id").eq("checklist_id", listId);
      return (data ?? []).length === itemIds.length;
    }, 25_000);
  }, 40_000);

  it("drops a write the server refuses for good (unique index) and keeps syncing the rest", async () => {
    const { costItems$ } = await freshDevice();
    const store$ = costItems$(groupId) as Store;
    await loaded(store$);

    const key = `payee-${crypto.randomUUID()}`;
    const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const base = { group_id: groupId, created_by: userId, deleted: false, created_at: null, updated_at: null };
    store$[a].set({ ...base, id: a, name: "Rent", bank_payee_key: key });
    await pollUntil(async () => Boolean(await serverRow("cost_items", a)));
    store$[b].set({ ...base, id: b, name: "Rent again", bank_payee_key: key });
    store$[c].set({ ...base, id: c, name: "Power" });

    await pollUntil(async () => Boolean(await serverRow("cost_items", c)));
    expect(await serverRow("cost_items", b)).toBeNull();
    const { data } = await admin!.from("cost_items").select("id").eq("bank_payee_key", key);
    expect(data).toHaveLength(1);
  }, 30_000);

  it("leaves no blank or deleted rows after a full pull over tombstones", async () => {
    const live = crypto.randomUUID();
    const gone = crypto.randomUUID();
    await admin!.from("grocery_items").insert([
      { id: live, group_id: groupId, name: "Bread" },
      { id: gone, group_id: groupId, name: "Butter" },
    ]);
    await admin!.from("grocery_items").update({ deleted: true }).eq("id", gone);

    const { groceryItems$ } = await freshDevice();
    const store$ = groceryItems$(groupId) as Store;
    await loaded(store$);
    const values = Object.values((store$.peek() ?? {}) as Record<string, unknown>);
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ id: live, name: "Bread", deleted: false });

    // A later delta pull brings the tombstone of a row deleted since, and the
    // row leaves without a blank value in its place.
    await admin!.from("grocery_items").update({ deleted: true }).eq("id", live);
    await syncState(store$).peek().sync();
    await pollUntil(() => store$[live].peek() === undefined);
    expect(Object.values((store$.peek() ?? {}) as Record<string, unknown>)).toEqual([]);
  }, 30_000);
});
