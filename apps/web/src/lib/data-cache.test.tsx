// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORES, clear as clearStore, putAll } from "@/lib/offline-store";
import { DataCacheProvider, useDataCache } from "@/lib/data-cache";
import { writeDataCacheSnapshot } from "@/lib/legend/data-cache-snapshot";
import type { Group } from '@homeup/core';

// FLUX-1549 fixed `fetchAll`'s auth-unavailable branch (data-cache.tsx:262-278,
// 402-412) so a network blip keeps the cached group instead of blanking every
// group.id-keyed section like a real sign-out. That fix was only unit-tested
// at the `isAuthUnavailable` leaf (packages/core/src/data/group-data.test.ts) — this file
// drives the same decision through `fetchAll` via `DataCacheProvider` itself,
// the caller that actually sequences the branch.

type QueryResult = { data: unknown; error: unknown };

const EMPTY: QueryResult = { data: [], error: null };

function makeQueryBuilder(defaultResult: QueryResult, singleResult?: QueryResult, maybeSingleResult?: QueryResult) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(singleResult ?? defaultResult)),
    maybeSingle: vi.fn(() => Promise.resolve(maybeSingleResult ?? defaultResult)),
    then: (resolve: (v: QueryResult) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(defaultResult).then(resolve, reject),
  };
  return builder;
}

function makeSupabaseMock(opts: {
  getUser: () => Promise<unknown>;
  membership?: { group_id: string; role: string } | null;
  group?: Group | null;
}) {
  const { getUser, membership = null, group = null } = opts;

  const tableBuilders: Record<string, () => unknown> = {
    user_settings: () => makeQueryBuilder(EMPTY, undefined, { data: null, error: null }),
    group_members: () =>
      makeQueryBuilder({ data: [], error: null }, undefined, { data: membership, error: null }),
    groups: () => makeQueryBuilder(EMPTY, { data: group, error: null }),
  };

  return {
    auth: { getUser },
    from: vi.fn((table: string) => (tableBuilders[table] ?? (() => makeQueryBuilder(EMPTY)))()),
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    channel: vi.fn(() => {
      const channel: Record<string, unknown> = {
        on: vi.fn(() => channel),
        subscribe: vi.fn(() => channel),
      };
      return channel;
    }),
    removeChannel: vi.fn(),
  };
}

// `vi.mock` factories are hoisted above the rest of the file, so the mutable
// client must live behind a `vi.hoisted` box rather than a plain `let` —
// referencing an un-hoisted local from inside the factory is a vitest error.
const mockClient = vi.hoisted(() => ({ current: null as ReturnType<typeof makeSupabaseMock> | null }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mockClient.current,
}));

function fixtureGroup(id: string): Group {
  return {
    id,
    name: "Cached Group",
    created_by: "user-1",
    created_at: "2026-01-01T00:00:00.000Z",
    region: "AU",
    home_address: null,
    home_lat: null,
    home_lng: null,
    home_move_in_date: null,
    chosen_apartment_id: null,
  };
}

async function renderProvider() {
  let latest: ReturnType<typeof useDataCache> | undefined;
  function Probe() {
    latest = useDataCache();
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(
      <DataCacheProvider>
        <Probe />
      </DataCacheProvider>
    );
  });

  const deadline = Date.now() + 2000;
  while ((latest?.loading ?? true) && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  return {
    root,
    container,
    getValue: () => {
      if (!latest) throw new Error("DataCacheProvider never rendered the probe");
      return latest;
    },
  };
}

describe("DataCacheProvider auth-unavailable fallback (FLUX-1549 fetchAll seam)", () => {
  let roots: Root[] = [];

  beforeEach(async () => {
    localStorage.clear();
    await Promise.all(Object.values(STORES).map((store) => clearStore(store)));
    Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
    roots = [];
  });

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount());
    }
    mockClient.current = null;
  });

  it("keeps the cached group when getUser resolves a retryable error (e.g. 503)", async () => {
    const cachedGroup = fixtureGroup("group-cached-a");
    await putAll(STORES.groups, [cachedGroup]);

    mockClient.current = makeSupabaseMock({
      getUser: () =>
        Promise.resolve({ data: { user: null }, error: { status: 503, message: "service unavailable" } }),
    });

    const { root, getValue } = await renderProvider();
    roots.push(root);

    expect(getValue().group).toEqual(cachedGroup);
  });

  it("keeps the cached group when getUser rejects (thrown fetch error)", async () => {
    const cachedGroup = fixtureGroup("group-cached-b");
    await putAll(STORES.groups, [cachedGroup]);

    mockClient.current = makeSupabaseMock({
      getUser: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    const { root, getValue } = await renderProvider();
    roots.push(root);

    expect(getValue().group).toEqual(cachedGroup);
  });

  it("clears the group on a clean no-session response (genuine sign-out)", async () => {
    const cachedGroup = fixtureGroup("group-cached-c");
    await putAll(STORES.groups, [cachedGroup]);
    writeDataCacheSnapshot({
      group: cachedGroup,
      groupMembers: [],
      memberProfiles: {},
      userSettings: null,
      currentUserId: "user-1",
    });

    mockClient.current = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    });

    const { root, getValue } = await renderProvider();
    roots.push(root);

    // The snapshot seed makes the mount's useLayoutEffect resolve `loading`
    // to false immediately (FLUX-150 cache-first paint), before the
    // loadFromOfflineStore().then(fetchAll) chain that actually clears the
    // group has resolved — so `renderProvider`'s loading-based wait isn't
    // enough here. Poll for the clear directly.
    const deadline = Date.now() + 2000;
    while (getValue().group !== null && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    expect(getValue().group).toBeNull();
  });

  it("populates the group for a real authenticated user", async () => {
    const remoteGroup = fixtureGroup("group-remote-d");

    mockClient.current = makeSupabaseMock({
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
      membership: { group_id: remoteGroup.id, role: "owner" },
      group: remoteGroup,
    });

    const { root, getValue } = await renderProvider();
    roots.push(root);

    expect(getValue().group).toEqual(remoteGroup);
    expect(getValue().currentUserId).toBe("user-1");
  });
});
