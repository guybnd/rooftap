// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ALL_MODULE_IDS,
  getModuleIdForPath,
  isModuleId,
  resetModulesStore,
  setModuleRows,
  type ModuleId,
} from "@homeup/core";

// Modules (.docs/modules.md, testing): a smoke pass over the screens that
// link across modules. The app shell and the home hub render with data in
// every module, then every link and button on them is followed one tap deep
// (each in a fresh mount). With a set of modules switched on, nothing may
// lead into a module that is off. The "every module on" run proves the crawl
// reaches each module, so the other runs can't pass by finding nothing.
//
// Only the surfaces are real: navigation, the data cache, Supabase and the
// group stores are stubbed, and the stores hold one fixture per module.

const nav = vi.hoisted(() => ({ visited: [] as string[] }));

vi.mock("next/navigation", () => {
  const router = {
    push: (href: string) => nav.visited.push(href),
    replace: (href: string) => nav.visited.push(href),
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  };
  return {
    useRouter: () => router,
    usePathname: () => "/home",
    useSelectedLayoutSegment: () => "home",
    useSearchParams: () => new URLSearchParams(),
  };
});

vi.mock("next/link", () => ({
  default: ({ href, children, className, onClick }: Omit<React.ComponentProps<"a">, "href"> & { href: string | { pathname: string } }) => (
    <a href={typeof href === "string" ? href : href.pathname} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const GROUP = "group-a";
const USER = "user-1";
const now = new Date();
const TODAY = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
// Each crawl mounts its surface once per control on it.
const CRAWL_TIMEOUT_MS = 60_000;

vi.mock("@/lib/data-cache", () => {
  const cache = {
    group: { id: "group-a", name: "Home", created_by: "user-1", created_at: "", updated_at: "" },
    groupMembers: [{ group_id: "group-a", user_id: "user-1", role: "owner", joined_at: "" }],
    memberProfiles: { "user-1": { email: "a@example.com", name: "Ana", avatar: null } },
    isGroupOwner: true,
    currentUserId: "user-1",
    pendingInvitations: [],
    sentInvitations: [],
    userSettings: null,
    preliminaryScores: [],
    loading: false,
    revalidating: false,
    isOnline: true,
    lastSyncedAt: null,
    refresh: async () => {},
  };
  return {
    useDataCache: () => cache,
    DataCacheProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

// Any Supabase call resolves empty: a chain whose every method returns itself.
vi.mock("@/lib/supabase/client", () => {
  const chain: unknown = new Proxy(() => chain, {
    get: (_t, prop) => {
      if (prop === "then") {
        const done = Promise.resolve({ data: null, error: null });
        return done.then.bind(done);
      }
      if (prop === "auth") return { getUser: async () => ({ data: { user: null }, error: null }) };
      return chain;
    },
    apply: () => chain,
  });
  return { createClient: () => chain };
});

vi.mock("@/lib/use-section", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/use-section")>()),
  useSectionSettings: () => ({
    settings: { defaultSection: null, lastUsedSection: "home", hiddenSections: [], sectionOrder: [] },
    loading: false,
    updateLastUsedSection: () => {},
    updateDefaultSection: () => {},
    updateHiddenSections: () => {},
    updateSectionOrder: () => {},
  }),
}));

vi.mock("@/hooks/use-overdue-task-count", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-overdue-task-count")>()),
  useOverdueTaskCount: () => 0,
}));

// Covered by their own tests (sync-status, capture, module-picker).
vi.mock("@/lib/legend/sync-status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/legend/sync-status")>()),
  LegendSyncBootstrap: () => null,
}));
vi.mock("@/components/capture/capture-sheet", () => ({ CaptureSheet: () => null }));
vi.mock("@/components/module-picker", () => ({ ModulePicker: () => null }));

// The group stores: one seeded observable per table, re-seeded before every
// mount. A store opened with no group id (a switched-off module) is empty.
const fixtures = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>> }));

// Every group store is built by createGroupStore, so swapping the factory
// swaps them all, including the ones core's own hooks import directly.
vi.mock("../../../../packages/core/src/data/create-group-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../packages/core/src/data/create-group-store")>();
  const { observable } = await import("@legendapp/state");
  const live = new Map<string, unknown>();
  (globalThis as { __resetStores?: () => void }).__resetStores = () => live.clear();
  return {
    ...actual,
    createGroupStore: ({ collection }: { collection: string }) => {
      const empty = observable({});
      return Object.assign(
        (groupId: string | null | undefined) => {
          if (!groupId) return empty;
          if (!live.has(collection)) live.set(collection, observable(structuredClone(fixtures.rows[collection] ?? {})));
          return live.get(collection);
        },
        { collection },
      );
    },
    useReconnectSync: () => {},
  };
});

const base = { group_id: GROUP, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", deleted: false };
const task = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  ...base,
  id,
  title,
  due_date: TODAY,
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
  priority: "medium",
  linked_checklist_id: null,
  ...extra,
});

function seed() {
  const byId = <T extends { id: string }>(...rows: T[]) => Object.fromEntries(rows.map((r) => [r.id, r]));
  fixtures.rows = {
    household_tasks: byId(
      task("t-chore", "Water the plants"),
      task("t-bill", "Pay the power bill", { template_key: "cost-reminder:c-power:due" }),
      task("t-doc", "Renew the warranty", { template_key: "doc-reminder:d-warranty:expiry" }),
      task("t-list", "Pack for the trip", { linked_checklist_id: "cl-trip" }),
    ),
    checklists: byId({
      ...base,
      id: "cl-trip",
      title: "Trip",
      type: "plain",
      template_key: null,
      source_checklist_id: null,
      completed_at: null,
      scheduled_date: TODAY,
      linked_task_id: "t-list",
      log_costs: false,
      repeat_cadence_days: null,
      repeat_renewal_mode: null,
      created_by: USER,
    }),
    checklist_task_items: byId({
      ...base,
      id: "cli-1",
      checklist_id: "cl-trip",
      label: "Passport",
      is_done: false,
      checked_by: null,
      checked_at: null,
      cost_cents: null,
      linked_cost_item_id: null,
      order: 0,
    }),
    grocery_items: byId({
      ...base,
      id: "g-milk",
      name: "Milk",
      aisle: "dairy",
      quantity: 1,
      unit: null,
      status: "needed",
      notes: null,
      assigned_to: null,
      private: false,
      template_key: null,
      sort_order: 0,
      created_by: USER,
      updated_by: USER,
      recurrence_days: null,
      status_changed_at: null,
      last_purchased_at: null,
      last_price: null,
      lowest_price: null,
      expiry_date: null,
      shelf_life_days: null,
      price_cents: null,
      is_essential: true,
      recipe_note: null,
      recipe_source_id: null,
    }),
    cost_items: byId({
      ...base,
      id: "c-power",
      name: "Power",
      category: "utilities",
      amount: 12000,
      cadence: "monthly",
      is_estimate: false,
      start_date: TODAY,
      end_date: null,
      discount_end_date: null,
      provider: null,
      assigned_to: null,
      linked_section: null,
      notes: null,
      sort_order: 0,
      created_by: USER,
    }),
    setup_items: byId({
      ...base,
      id: "s-desk",
      name: "Desk",
      room: "Office",
      priority: "high",
      status: "needed",
      est_price: null,
      actual_price: null,
      where_to_buy: null,
      store_id: null,
      url: null,
      notes: null,
      assigned_to: null,
      private: false,
      template_key: null,
      ai_suggestion: null,
      sort_order: 0,
      created_by: USER,
    }),
    apartments: byId({
      ...base,
      id: "apt-1",
      user_id: USER,
      address: "1 Main St",
      suburb: "Centre",
      rent_per_week: 500,
      bedrooms: 2,
      bathrooms: 1,
      parking: false,
      listing_url: null,
      notes: null,
      lat: null,
      lng: null,
      agent_id: null,
      preliminary_score: null,
      nearest_supermarket_m: null,
      nearest_transport_m: null,
      disposition: null,
      move_in_date: null,
      main_location: null,
      archived: false,
    }),
    // Bin night: a collection tomorrow, so tonight's card is on Home.
    bin_streams: byId({
      ...base,
      id: "bin-red",
      name: "Red",
      lid: "red",
      weekday: (now.getDay() + 1) % 7,
      every_weeks: 1,
      anchor_date: TODAY,
      sort_order: 0,
      created_by: USER,
    }),
    appointments: byId({
      ...base,
      id: "appt-1",
      user_id: USER,
      apartment_id: "apt-1",
      scheduled_at: `${TODAY}T18:00:00`,
      notes: null,
      status: "scheduled",
    }),
  };
  (globalThis as { __resetStores?: () => void }).__resetStores?.();
}

import { AppSidebar } from "@/components/app-sidebar";
import HomeHubPage from "./home/page";

// Each surface, and the modules it must reach with every module on. If a
// redesign stops a surface linking one of these, drop it from its list.
const SURFACES: Record<string, { render: () => React.ReactElement; reaches: ModuleId[] }> = {
  "app shell": {
    render: () => <AppSidebar>{null}</AppSidebar>,
    reaches: ["household", "calendar", "checklists", "documents", "groceries", "recipes", "costs", "setup", "search", "shopper", "rewards", "occasions", "bins", "assistant"],
  },
  "home hub": {
    render: () => <HomeHubPage />,
    reaches: ["household", "groceries", "costs", "setup", "search", "bins", "assistant"],
  },
};

/** The module a link leads into: its route's module, or the section a settings link opens. */
function linkedModule(href: string): string | null {
  if (/^[a-z]+:/i.test(href)) return null; // external (Google Calendar, tel:, mailto:)
  const path = href.split(/[?#]/)[0];
  const settings = /^\/settings\/([^/]+)/.exec(path);
  if (settings && isModuleId(settings[1])) return settings[1];
  return getModuleIdForPath(path);
}

let container: HTMLDivElement;
let root: Root;

async function mount(surface: () => React.ReactElement) {
  seed();
  nav.visited = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(surface()));
}

async function unmount() {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
}

const CLICKABLE = 'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="tab"]';

function anchors(): string[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) => a.getAttribute("href")!);
}

/** Every place the surface leads to: its links, and wherever a tap on each control goes. */
async function crawl(surface: () => React.ReactElement): Promise<Set<string>> {
  const reached = new Set<string>();
  await mount(surface);
  const count = document.querySelectorAll(CLICKABLE).length;
  for (const href of [...anchors(), ...nav.visited]) reached.add(href);
  await unmount();

  for (let i = 0; i < count; i++) {
    await mount(surface);
    const target = document.querySelectorAll<HTMLElement>(CLICKABLE)[i];
    if (target && target.tagName !== "A") {
      await act(async () => target.click());
      // A tap that opens a menu or sheet shows links one level deeper.
      for (const href of [...anchors(), ...nav.visited]) reached.add(href);
    }
    await unmount();
  }
  return reached;
}

function rowsWithOn(on: readonly ModuleId[]) {
  return ALL_MODULE_IDS.map((id) => ({
    group_id: GROUP,
    module_id: id,
    enabled: on.includes(id),
    updated_by: null,
    updated_at: "2026-10-18T00:00:00Z",
  }));
}

const BASE_MODULES: ModuleId[] = ["household", "calendar", "checklists", "documents"];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Browser APIs jsdom lacks.
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList;
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.ResizeObserver ??= Observer as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver ??= Observer as unknown as typeof IntersectionObserver;
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView ??= () => {};
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  resetModulesStore();
});

describe.each(Object.keys(SURFACES))("module links: %s", (name) => {
  const { render: surface, reaches } = SURFACES[name];

  it("reaches its modules with every module on, so the crawl works", async () => {
    setModuleRows(rowsWithOn(ALL_MODULE_IDS));
    const modules = new Set([...(await crawl(surface))].map(linkedModule));
    expect(reaches.filter((m) => !modules.has(m))).toEqual([]);
  }, CRAWL_TIMEOUT_MS);

  it.each([
    ["the base modules", BASE_MODULES],
    ["Tasks alone", ["household"] as ModuleId[]],
    ["every module off", [] as ModuleId[]],
  ])("leads nowhere switched off with %s on", async (_label, on) => {
    setModuleRows(rowsWithOn(on));
    const off = [...(await crawl(surface))].filter((href) => {
      const m = linkedModule(href);
      return m !== null && !(on as readonly string[]).includes(m);
    });
    expect(off).toEqual([]);
  }, CRAWL_TIMEOUT_MS);
});
