// @vitest-environment jsdom
//
// Legend-State's `create-group-store.ts` (packages/core) reads its
// StoreEnvironment lazily, via getStoreEnvironment() — this test needs the
// real browser env (IndexedDB persist, mocked Supabase client) registered, so
// it runs under jsdom (already used elsewhere, e.g. data-cache.test.tsx)
// rather than the repo's default node environment.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncState } from "@legendapp/state";

// HOUP-70 spike / HOUP-73 move: mechanical proof of the offline-write ->
// reconnect -> sync loop and cross-group isolation, run against the ACTUAL
// production code (packages/core's create-group-store.ts + grocery-items-store.ts
// + apps/web's environment.ts) rather than a hand-written stand-in. A fake
// Supabase client (below) replaces the network boundary; fake-indexeddb
// replaces the browser's IndexedDB with a real (non-mocked) implementation,
// so persistence semantics are genuine.
//
// This is the spike's "Recommended Tests" offline-loop / idempotency /
// group-isolation assertions, runnable under vitest with no browser or
// Android emulator.

type Row = Record<string, unknown>;

let online = true;
const rowsByTable = new Map<string, Row[]>();
// HOUP-267: every upsert (create/update) the fake "server" receives, so
// tests can assert on OUTBOUND writes — not just the resulting row state —
// e.g. proving a local-only removal never echoes a redundant push.
const upsertCalls: { table: string; payload: Row }[] = [];
// Optional server-side check run before an upsert lands, e.g. a foreign key
// that refuses a child row whose parent is not there yet.
type ServerError = { error: { message: string; code?: string }; status: number };
let beforeUpsert: ((table: string, item: Row) => Promise<ServerError | void>) | null = null;

function table(name: string): Row[] {
  if (!rowsByTable.has(name)) rowsByTable.set(name, []);
  return rowsByTable.get(name)!;
}

// Minimal fake matching exactly the surface syncedSupabase + create-group-store.ts
// touch: from().select/.eq/.gt (read+filter), from().upsert().select() (our
// idempotent create/update override), and channel().on().subscribe() (realtime).
type FakeResult = { data: Row[] | null; error: { message: string; code?: string } | null; status?: number };

class FakeBuilder implements PromiseLike<FakeResult> {
  private filters: Array<(r: Row) => boolean> = [];
  constructor(
    private tableName: string,
    private op: "select" | "upsert",
    private payload?: Row,
  ) {}

  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  gt(col: string, val: unknown) {
    this.filters.push((r) => new Date(String(r[col])).getTime() > new Date(String(val)).getTime());
    return this;
  }
  select() {
    return this;
  }
  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.run().then(onfulfilled, onrejected);
  }

  private async run(): Promise<FakeResult> {
    if (!online) {
      // Real supabase-js swallows the network TypeError and returns it as
      // `error`, not a thrown rejection — matches create-group-store.ts's
      // `isTransientWriteError` contract, which reads `error.message`.
      return { data: null, error: { message: "Failed to fetch" } };
    }
    const rows = table(this.tableName);
    if (this.op === "select") {
      return { data: rows.filter((r) => this.filters.every((f) => f(r))), error: null };
    }
    // upsert(onConflict: 'id') — the idempotent create/update path (FLUX-263/265).
    const item = this.payload!;
    const refused = await beforeUpsert?.(this.tableName, item);
    if (refused) return { data: null, ...refused };
    upsertCalls.push({ table: this.tableName, payload: item });
    const existing = rows.find((r) => r.id === item.id);
    if (existing) {
      Object.assign(existing, item, { updated_at: new Date().toISOString() });
      return { data: [existing], error: null };
    }
    const created = { ...item, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    rows.push(created);
    return { data: [created], error: null };
  }
}

const fakeClient = {
  from(name: string) {
    return {
      select: () => new FakeBuilder(name, "select"),
      upsert: (payload: Row) => new FakeBuilder(name, "upsert", payload),
    };
  },
  channel(_name: string) {
    const chain = {
      on: () => chain,
      subscribe: (cb?: (status: string) => void) => {
        cb?.("SUBSCRIBED");
        return chain;
      },
    };
    return chain;
  },
  removeChannel: () => {},
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => fakeClient,
}));

async function pollUntil(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("pollUntil: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function waitForInitialLoad(store$: any): Promise<void> {
  // `syncedSupabase`'s `list()` fetch is lazy — it only fires once something
  // actually reads the observable's value (mirroring how a mounted component's
  // `use$(() => store$.get())` triggers it in production). `.peek()` forces
  // that resolution without subscribing.
  store$.peek();
  await pollUntil(() => Boolean(syncState(store$).peek()?.isLoaded));
}

// HOUP-73: the StoreEnvironment lives on the (also reset by vi.resetModules())
// @homeup/core module instance, so it must be re-registered after every
// resetModules — importing environment.ts for its side effect does that,
// then @homeup/core is re-imported to get store factories bound to the fresh
// registration.
async function importStores() {
  await import("./environment");
  return import("@homeup/core");
}

describe("createGroupStore — offline write / reconnect / group isolation (HOUP-70/HOUP-73)", () => {
  beforeEach(() => {
    online = true;
    rowsByTable.clear();
    upsertCalls.length = 0;
    beforeUpsert = null;
    // HOUP-293: fresh IndexedDB per test. "fake-indexeddb/auto" installs ONE
    // global factory for the whole file, and vi.resetModules() below drops the
    // app module graph but NOT that global — without this, a later test's
    // store hydrates earlier tests' cached rows and pending-change metadata,
    // and retrySync replays them as surprise outbound upserts mid-test. The
    // factory stays stable within a test, so the restart test's persistence
    // assertions still hold.
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
  });
  afterEach(() => {
    online = true;
  });

  it("queues an offline write, survives a simulated app restart, and syncs exactly once on reconnect", async () => {
    const { groceryItems$ } = await importStores();

    const groupId = "group-a";
    const store$ = groceryItems$(groupId);

    // Realistic sequencing: the app has already completed its initial sync
    // (mounted online) before the user goes offline and adds an item — not a
    // cold-start-while-offline scenario.
    await waitForInitialLoad(store$);

    // Drive the observable the same way useStoreHelpers().writeRow does for a
    // brand-new row (gotcha 5: null created_at/updated_at signals INSERT to
    // Legend's CRUD plugin) — exercised directly so this test has no React
    // dependency; the store factory + sync plugin under test is unchanged.
    online = false;
    (store$ as Record<string, { set: (v: unknown) => void }>)["item-1"].set({
      id: "item-1",
      group_id: groupId,
      deleted: false,
      name: "Milk",
      created_at: null,
      updated_at: null,
    });

    // Optimistic: visible locally immediately even though the network is down.
    expect(store$["item-1"].peek()).toMatchObject({ id: "item-1", name: "Milk" });
    // Never reached the fake "server" — proves the write queued instead of
    // silently succeeding/dropping while offline.
    expect(table("grocery_items")).toHaveLength(0);

    // Give the IndexedDB persist plugin a beat to flush the optimistic write
    // before we simulate a restart (persistence is async; the in-memory
    // `.set()` above returns before the IndexedDB transaction commits).
    await new Promise((r) => setTimeout(r, 300));

    // Simulate an app restart: drop the in-memory module graph (a fresh
    // `createGroupStore` Map with no observable yet, and a fresh
    // StoreEnvironment registration) but keep the same fake-indexeddb backing
    // store — exactly what persist.retrySync:true is for. Re-importing
    // re-hydrates from IndexedDB and Legend re-queues the pending write
    // automatically.
    vi.resetModules();
    const restarted = await importStores();
    const store2$ = restarted.groceryItems$(groupId);

    await pollUntil(() => store2$["item-1"].peek() !== undefined);
    expect(store2$["item-1"].peek()).toMatchObject({ id: "item-1", name: "Milk" });
    // Still hasn't reached the server — the queued write survived the
    // "restart" but reconnect hasn't happened yet.
    expect(table("grocery_items")).toHaveLength(0);

    // Reconnect: bring the fake server back online. Legend's infinite retry
    // (backoff 1s→30s, see create-group-store.ts) picks the queued write back up.
    online = true;
    await pollUntil(() => table("grocery_items").length === 1, 15000);

    expect(table("grocery_items")[0]).toMatchObject({ id: "item-1", group_id: groupId, name: "Milk" });
    // Idempotency (FLUX-263/265): even though the write may have been
    // attempted more than once while offline/retrying, the upsert(onConflict:
    // 'id') collapses every attempt into exactly one row — no duplicate/ghost
    // row regardless of how many retries fired before reconnect.
    expect(table("grocery_items")).toHaveLength(1);
  }, 20000);

  it("keeps two groups' local caches isolated (HOUP-70 group-scoping fix)", async () => {
    const { groceryItems$ } = await importStores();

    const storeA$ = groceryItems$("group-a") as unknown as Record<string, { set: (v: unknown) => void; peek: () => unknown }>;
    const storeB$ = groceryItems$("group-b") as unknown as Record<string, { set: (v: unknown) => void; peek: () => unknown }>;
    await waitForInitialLoad(storeA$);
    await waitForInitialLoad(storeB$);

    storeA$["a-1"].set({ id: "a-1", group_id: "group-a", deleted: false, name: "Bread", created_at: null, updated_at: null });
    storeB$["b-1"].set({ id: "b-1", group_id: "group-b", deleted: false, name: "Eggs", created_at: null, updated_at: null });

    // A busy CI runner can push these well past the default wait (main and
    // PRs timed out here at 8 s on Oct 23), so give it the restart test's.
    await pollUntil(() => table("grocery_items").length === 2, 15000);

    // The fake "server" (standing in for Postgres+RLS) only ever received
    // each row tagged with its own group_id — the write path is correctly
    // group-scoped end to end.
    expect(table("grocery_items").find((r) => r.id === "a-1")).toMatchObject({ group_id: "group-a" });
    expect(table("grocery_items").find((r) => r.id === "b-1")).toMatchObject({ group_id: "group-b" });

    // HOUP-70 GROUP-SCOPING FIX (was previously a genuine leak — see history):
    // apps/web's StoreEnvironment.getPersistConfig now sets `indexedDB.prefixID:
    // groupId`, so Legend's IndexedDB plugin keys each group's local table
    // separately instead of by `storageName` alone. Two groups' Observables
    // loaded in the SAME browser/app session no longer read or write the same
    // local table — each group's client-side view contains only its own rows.
    expect(storeA$["b-1"].peek()).toBeUndefined();
    expect(storeB$["a-1"].peek()).toBeUndefined();
  }, 25000);
});

// HOUP-267: reconcileDeletedRows against a REAL synced-observable push path
// (not the plain observable() the leaf unit tests in
// packages/core/src/data/create-group-store.test.ts use), so the
// `.delete()` -> crud-plugin `set` side effect this ticket is about is
// actually exercised.
describe("reconcileDeletedRows — synced-observable push path (HOUP-267)", () => {
  beforeEach(() => {
    online = true;
    rowsByTable.clear();
    upsertCalls.length = 0;
    beforeUpsert = null;
    // HOUP-293: fresh IndexedDB per test. "fake-indexeddb/auto" installs ONE
    // global factory for the whole file, and vi.resetModules() below drops the
    // app module graph but NOT that global — without this, a later test's
    // store hydrates earlier tests' cached rows and pending-change metadata,
    // and retrySync replays them as surprise outbound upserts mid-test. The
    // factory stays stable within a test, so the restart test's persistence
    // assertions still hold.
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
  });

  it("removes a stranded soft-deleted row locally without re-pushing a redundant deleted:true write", async () => {
    const { groceryItems$, reconcileDeletedRows } = await importStores();
    // HOUP-293: ids unique to this test. Earlier tests in this file abandon
    // store instances (vi.resetModules() orphans — not cancels — their
    // infinite-retry timers), and those instances share this file's fake
    // client and `online` flag, so an abandoned store can push its own
    // "item-1" upsert at an arbitrary later moment. Unique ids make any such
    // stray write invisible to this test's reconcile target and assertions.
    const groupId = "group-reconcile";
    const itemId = "item-r1";
    const store$ = groceryItems$(groupId) as unknown as Record<string, { set: (v: unknown) => void; peek: () => unknown }>;
    await waitForInitialLoad(store$);

    store$[itemId].set({
      id: itemId, group_id: groupId, deleted: false, name: "Milk", created_at: null, updated_at: null,
    });
    // Drain this test's own send pipeline before capturing the baseline: the
    // row landing on the fake "server" only proves the create FIRED; the
    // round-trip is complete once Legend applies the create's saveResult back
    // onto the local row (real timestamps replacing the created_at:null
    // INSERT marker). Only then is a later write for this id necessarily the
    // reconcile's fault.
    await pollUntil(() => table("grocery_items").some((r) => r.id === itemId));
    await pollUntil(() => Boolean((store$[itemId].peek() as Row | undefined)?.created_at));

    // Simulate HOUP-243's stranded-delete scenario: the row is deleted
    // server-side (e.g. a tombstone missed while the realtime channel briefly
    // dropped) but the client's copy is still visible. Flip it directly on
    // the fake "server" without going through the store.
    const serverRow = table("grocery_items").find((r) => r.id === itemId)!;
    serverRow.deleted = true;
    const upsertsBeforeReconcile = upsertCalls.length;

    await reconcileDeletedRows({ supabase: fakeClient } as never, "grocery_items", groupId, store$ as never);

    // Removed from the local cache.
    expect(store$[itemId].peek()).toBeUndefined();

    // Give any (incorrect) outbound push a chance to land before asserting
    // its absence — the crud plugin's set path is async (queued via
    // queueMicrotask + retry).
    await new Promise((r) => setTimeout(r, 300));

    // No redundant `{ id, deleted: true }` UPDATE reached the "server": the
    // removal must be classified as a remote-applied change (onChangeRemote),
    // not re-fed through the crud plugin's outbound set/update path.
    // toEqual([]) rather than toHaveLength(0) so a failure prints the payload:
    // deleted:true would be a genuine HOUP-267 regression; deleted:false means
    // test contamination (see HOUP-293).
    const redundantWrites = upsertCalls
      .slice(upsertsBeforeReconcile)
      .filter((call) => call.table === "grocery_items" && call.payload.id === itemId);
    expect(redundantWrites).toEqual([]);
  }, 15000);
  it("saves a checklist's items when they reach the server before the checklist does", async () => {
    // A checklist made from a template writes the checklist and its items to
    // two stores, which push on their own. The server refuses an item whose
    // checklist is not there yet (foreign key), so a slow checklist push used
    // to lose every item: "insert or update on table checklist_task_items
    // violates foreign key constraint".
    const { checklists$, checklistItems$ } = await importStores();
    const groupId = "group-template";
    const lists$ = checklists$(groupId) as unknown as Record<string, { set: (v: unknown) => void; assign: (v: unknown) => void; peek: () => unknown }>;
    const items$ = checklistItems$(groupId) as unknown as Record<string, { set: (v: unknown) => void; peek: () => unknown }>;
    await waitForInitialLoad(lists$);
    await waitForInitialLoad(items$);

    beforeUpsert = async (tableName, item) => {
      if (tableName === "checklists") await new Promise((r) => setTimeout(r, 400));
      if (tableName === "checklist_task_items" && !table("checklists").some((r) => r.id === item.checklist_id)) {
        return {
          error: {
            code: "23503",
            message: 'insert or update on table "checklist_task_items" violates foreign key constraint "checklist_task_items_checklist_id_fkey"',
          },
          status: 409,
        };
      }
    };

    lists$["list-1"].set({ id: "list-1", group_id: groupId, deleted: false, title: "Pre-Flight", scheduled_date: null, created_at: null, updated_at: null });
    for (const n of [1, 2, 3]) {
      items$[`li-${n}`].set({ id: `li-${n}`, group_id: groupId, checklist_id: "list-1", deleted: false, label: `Item ${n}`, order: n, created_at: null, updated_at: null });
    }

    await pollUntil(() => table("checklist_task_items").length === 3, 15000);
    expect(table("checklists")).toHaveLength(1);

    // The new list's date still saves after the create settles.
    await pollUntil(() => Boolean((lists$["list-1"].peek() as Row | undefined)?.created_at));
    lists$["list-1"].assign({ scheduled_date: "2026-10-29" });
    lists$["list-1"].assign({ scheduled_date: "2026-10-30" });
    expect((lists$["list-1"].peek() as Row).scheduled_date).toBe("2026-10-30");
    await pollUntil(() => table("checklists")[0]?.scheduled_date === "2026-10-30", 15000);
    await new Promise((r) => setTimeout(r, 900));
    expect((lists$["list-1"].peek() as Row).scheduled_date).toBe("2026-10-30");
  }, 30000);
});
