// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_MODULE_IDS, resetModulesStore, setModuleRows, type GroupModuleRow, type ModuleId } from "@homeup/core";

// Modules (.docs/modules.md, step 8): the app-wide bootstrap activates only
// the stores of modules that are on, and a module switched on starts its
// stores without a reload. Each store is swapped for a spy that records
// which group it was opened for.
const opened = vi.hoisted(() => new Map<string, string[]>());

vi.mock("@homeup/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@homeup/core")>();
  const spyStore = (store: { collection: string }) =>
    Object.assign(
      (groupId: string | null | undefined) => {
        if (groupId) opened.set(store.collection, [...(opened.get(store.collection) ?? []), groupId]);
        return { get: () => ({}) };
      },
      { collection: store.collection },
    );
  const swapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    if (typeof value === "function" && "collection" in value) swapped[name] = spyStore(value as { collection: string });
  }
  return { ...actual, ...swapped };
});

vi.mock("@/lib/data-cache", () => ({ useDataCache: () => ({ group: { id: "group-a" } }) }));

import { LegendSyncBootstrap } from "./sync-status";

const rowsWithOff = (...off: ModuleId[]): GroupModuleRow[] =>
  ALL_MODULE_IDS.map((id) => ({
    group_id: "group-a",
    module_id: id,
    enabled: !off.includes(id),
    updated_by: null,
    updated_at: "2026-10-18T00:00:00Z",
  }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  opened.clear();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  resetModulesStore();
});

function mount() {
  act(() => root.render(<LegendSyncBootstrap />));
}

describe("LegendSyncBootstrap", () => {
  it("activates every store with every module on", () => {
    setModuleRows(rowsWithOff());
    mount();
    expect([...opened.keys()]).toContain("grocery_items");
    expect([...opened.keys()]).toContain("apartments");
    expect(opened.get("household_tasks")).toEqual(["group-a"]);
  });

  it("skips the stores of switched-off modules", () => {
    setModuleRows(rowsWithOff("groceries", "search"));
    mount();
    expect(opened.has("grocery_items")).toBe(false);
    expect(opened.has("apartments")).toBe(false);
    expect(opened.has("appointments")).toBe(false);
    expect(opened.has("cost_items")).toBe(true);
  });

  it("keeps tasks syncing for reminders while Costs is on, even with Tasks off", () => {
    setModuleRows(rowsWithOff("household"));
    mount();
    expect(opened.has("household_tasks")).toBe(true);
  });

  it("starts a module's stores when it is switched on, without remounting", () => {
    setModuleRows(rowsWithOff("groceries"));
    mount();
    expect(opened.has("grocery_items")).toBe(false);
    act(() => setModuleRows(rowsWithOff()));
    expect(opened.get("grocery_items")).toEqual(["group-a"]);
  });
});
