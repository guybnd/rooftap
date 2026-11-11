// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getModulesSnapshot, MODULES, resetModulesStore, setModuleRows, type GroupModuleRow } from "@homeup/core";

// Modules (.docs/modules.md, step 9): the first-run picker shows once, to the
// owner of a household that has never chosen, on the Everyday set (the
// defaults), and whatever it saves (the ticks, or the defaults on Escape) is
// a row per module.
const cache = vi.hoisted(() => ({
  group: { id: "group-a" } as { id: string } | null,
  isGroupOwner: true,
  currentUserId: "user-1",
  pendingInvitations: [] as unknown[],
}));
const upsert = vi.hoisted(() => vi.fn(async () => ({ error: null as { message: string } | null })));

vi.mock("@/lib/data-cache", () => ({ useDataCache: () => cache }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({ upsert }) }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { ModulePicker } from "./module-picker";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(cache, { group: { id: "group-a" }, isGroupOwner: true, pendingInvitations: [] });
  upsert.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetModulesStore();
});

async function mount() {
  await act(async () => root.render(<ModulePicker />));
}

const button = (text: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.startsWith(text));
const radio = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent?.includes(label));
async function openOwnList() {
  await act(async () => button("Choose myself")!.click());
}
const toggle = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="switch"]')).find((b) => b.getAttribute("aria-label") === label);
const saved = () =>
  Object.fromEntries((upsert.mock.calls[0] as unknown as [GroupModuleRow[]])[0].map((r) => [r.module_id, r.enabled]));
const defaults = Object.fromEntries(MODULES.map((m) => [m.id, m.defaultEnabled]));

describe("ModulePicker", () => {
  it("shows for the owner of a household that has never chosen, with the defaults ticked", async () => {
    setModuleRows([]);
    await mount();
    expect(document.body.textContent).toContain("What does your household need?");
    expect(radio("Everyday")?.getAttribute("aria-checked")).toBe("true");
    expect(button("Start with Everyday")).toBeDefined();
    await openOwnList();
    for (const m of MODULES) expect(toggle(m.label)?.getAttribute("aria-checked")).toBe(String(m.defaultEnabled));
  });

  it("stays away for a household that has chosen, a member, or someone with an invitation", async () => {
    setModuleRows([{ group_id: "group-a", module_id: "household", enabled: true, updated_by: null, updated_at: "" }]);
    await mount();
    expect(button("Start with")).toBeUndefined();

    act(() => setModuleRows([]));
    cache.isGroupOwner = false;
    await mount();
    expect(button("Start with")).toBeUndefined();

    cache.isGroupOwner = true;
    cache.pendingInvitations = [{ id: "inv-1" }];
    await mount();
    expect(button("Start with")).toBeUndefined();
  });

  it("a set saves its tiles", async () => {
    setModuleRows([]);
    await mount();
    await act(async () => radio("Moving house")!.click());
    await act(async () => button("Start with Moving house")!.click());
    expect(saved()).toMatchObject({ search: true, setup: true });
  });

  it("Choose myself saves the ticks as a row per module and closes", async () => {
    setModuleRows([]);
    await mount();
    await openOwnList();
    const groceries = defaults.groceries;
    await act(async () => toggle("Groceries")!.click());
    await act(async () => toggle("Checklists")!.click());
    expect(button("Start with my tiles")).toBeDefined();
    await act(async () => button("Start with my tiles")!.click());
    expect(saved()).toEqual({ ...defaults, groceries: !groceries, checklists: false });
    expect(getModulesSnapshot().rows).toHaveLength(MODULES.length);
    expect(button("Start with")).toBeUndefined();
  });

  it("Escape saves the defaults, whatever was ticked", async () => {
    setModuleRows([]);
    await mount();
    await openOwnList();
    await act(async () => toggle("Groceries")!.click());
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(saved()).toEqual(defaults);
  });

  it("offers a look around the sample home that links back", async () => {
    setModuleRows([]);
    await mount();
    const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent === "Look around a sample home first");
    expect(link?.getAttribute("href")).toContain("/demo/?live=1&back=");
  });

  it("ticking Google Calendar ticks Calendar and locks it", async () => {
    setModuleRows([]);
    await mount();
    await openOwnList();
    await act(async () => toggle("Calendar")!.click());
    expect(toggle("Calendar")?.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle("Google Calendar")!.click());
    expect(toggle("Calendar")?.getAttribute("aria-checked")).toBe("true");
    expect(toggle("Calendar")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Google Calendar uses this");
  });

  it("a refused Continue reopens it with the ticks kept", async () => {
    setModuleRows([]);
    upsert.mockResolvedValueOnce({ error: { message: "offline" } });
    await mount();
    await openOwnList();
    const groceries = defaults.groceries;
    await act(async () => toggle("Groceries")!.click());
    await act(async () => button("Start with")!.click());
    expect(getModulesSnapshot().rows).toEqual([]);
    expect(toggle("Groceries")?.getAttribute("aria-checked")).toBe(String(!groceries));
  });
});
