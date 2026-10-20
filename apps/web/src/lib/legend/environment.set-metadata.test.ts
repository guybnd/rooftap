// HOUP-299: the persist plugin's `setMetadata` writes sync metadata —
// including `pending` (queued offline changes), which carries Legend's
// Symbol(delete) tombstone sentinel — through IndexedDB's structured clone.
// environment.ts must strip symbols from metadata the same way HOUP-7 did for
// `set`, or every metadata write with a pending delete throws DataCloneError
// and offline pending-change bookkeeping never persists. The underlying
// plugin is mocked with spies so the assertion is exactly the contract: what
// reaches the real plugin is already structured-clone-safe.
import { describe, expect, it, vi } from "vitest";
import type { ObservablePersistPlugin, PersistMetadata, PersistOptions } from "@legendapp/state/sync";

const { setSpy, setMetadataSpy } = vi.hoisted(() => ({
  setSpy: vi.fn(),
  setMetadataSpy: vi.fn(() => Promise.resolve("idb-request")),
}));

vi.mock("@legendapp/state/persist-plugins/indexeddb", () => ({
  // environment.ts overwrites `.set`/`.setMetadata` on this object with its
  // sanitizing wrappers; the hoisted spies keep a handle on the originals so
  // the test observes what the wrappers delegate downward.
  observablePersistIndexedDB: () => ({ set: setSpy, setMetadata: setMetadataSpy }),
}));

// environment.ts imports the Supabase client module at load; stub it so this
// test needs no env vars. createClient is only invoked lazily, never here.
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

describe("environment.ts setMetadata sanitizer (HOUP-299)", () => {
  it("strips Symbol(delete) sentinels from pending metadata before the underlying plugin sees it", async () => {
    await import("./environment");
    const { getStoreEnvironment } = await import("@homeup/core");

    const persistConfig = getStoreEnvironment().getPersistConfig("grocery_items", "group-1") as unknown as PersistOptions & {
      plugin: ObservablePersistPlugin;
    };
    const plugin = persistConfig.plugin;

    const symbolDelete = Symbol("delete");
    const metadata: PersistMetadata = {
      lastSync: 1234,
      pending: {
        // v IS the sentinel (a queued delete of the whole row)…
        "row-1": { p: { id: "row-1", name: "Milk" }, t: ["object"], v: symbolDelete },
        // …and a row carrying a symbol-keyed marker property.
        "row-2": { p: null, t: [], v: { id: "row-2", [symbolDelete]: true } },
      },
    };

    await plugin.setMetadata("grocery_items", metadata, persistConfig);

    expect(setMetadataSpy).toHaveBeenCalledTimes(1);
    const [table, passed, config] = setMetadataSpy.mock.calls[0] as unknown as [string, PersistMetadata, PersistOptions];
    expect(table).toBe("grocery_items");
    expect(config).toBe(persistConfig);

    // The production failure mode, verbatim: IDBObjectStore.put structured-
    // clones its value. What reaches the plugin must survive that.
    expect(() => structuredClone(passed)).not.toThrow();

    expect(passed.lastSync).toBe(1234);
    // Symbol VALUE dropped (the `v` key goes with it)…
    expect(passed.pending["row-1"]).toEqual({ p: { id: "row-1", name: "Milk" }, t: ["object"] });
    // …symbol KEY stripped from the nested row.
    expect(passed.pending["row-2"].v).toEqual({ id: "row-2" });

    // stripSymbolKeys copied on strip — the plugin's own
    // `Object.assign(metadata, { id })` mutation stays off the caller's object.
    expect(passed).not.toBe(metadata);

    // The caller's original metadata (Legend's in-memory sync state) is untouched.
    expect(metadata.pending["row-1"].v).toBe(symbolDelete);
  });
});
