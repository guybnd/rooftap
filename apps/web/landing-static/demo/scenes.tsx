// One scene per screenshot: which page, on which route, with which household
// state, and what the screenshot script taps before it shoots. The landing
// page's eight stories are told with these frames.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { costItems, events, groceries, groceriesMidShop, grocery, SATURDAY, seed, seedTable, tasks, todaysSession } from "./fixtures";

/** A tap, a drag or a wait the screenshot script performs in order, in the page. */
export type Action =
  | { click: string }
  | { tap: [number, number] }
  | { fill: string; value: string }
  | { wait: number }
  | { scroll: number }
  /** A finger drag on an element: selector, dx, dy, and whether the finger stays down for the shot. */
  | { drag: [string, number, number, boolean?] };

export interface Scene {
  id: string;
  /** The route the page believes it is on. */
  path: string;
  params?: Record<string, string>;
  page: LazyExoticComponent<ComponentType>;
  /** Household changes and localStorage, applied before the page mounts. */
  prepare?: () => void;
  actions?: Action[];
  /** Things the landing page taps or points at: name to selector, or [selector, n] for the element's nth ancestor. Their rects are measured after the actions. */
  marks?: Record<string, string | [string, number]>;
}

const Home = lazy(() => import("../../src/app/home/page"));
const Groceries = lazy(() => import("../../src/app/groceries/page"));
const Calendar = lazy(() => import("../../src/app/calendar/page"));
const RecipeDetail = lazy(() => import("../../src/app/recipes/[id]/page"));
const Recipes = lazy(() => import("../../src/app/recipes/page"));
const Costs = lazy(() => import("../../src/app/costs/page"));
const Documents = lazy(() => import("../../src/app/documents/page"));
const ChecklistDetail = lazy(() => import("../../src/app/checklists/[id]/page"));
const Checklists = lazy(() => import("../../src/app/checklists/page"));
const Tasks = lazy(() => import("../../src/app/tasks/page"));

function groceriesView(mode: "aisle" | "flat") {
  localStorage.setItem("homeup_grocery_sort_mode", mode);
  localStorage.setItem("homeup_shopping_tooltip_dismissed", "1");
}

/** The calendar opens on today; the story's night out is on Saturday. */
const saturday = new Date();
saturday.setDate(saturday.getDate() + SATURDAY);
const toSaturday: Action[] = SATURDAY === 0 ? [] : [{ click: `text=/^${saturday.getDate()}$/` }, { wait: 300 }];

export const SCENES: Scene[] = [
  // 1. Home: everything at a glance, with the Upcoming feed fed by every room.
  {
    id: "home",
    path: "/home",
    page: Home,
    marks: { count: ["text=left today", 2], weather: ["text=Rain from", 1], now: ["text=Bins out >> visible=true", 4], upcoming: ["text=Upcoming", 3] },
  },
  {
    id: "home-upcoming",
    path: "/home",
    page: Home,
    actions: [{ scroll: 560 }, { wait: 400 }],
    marks: {
      dentist: '[class*="list-item"]:has-text("Dentist")',
      plumber: '[class*="list-item"]:has-text("Book the plumber")',
      warranty: '[class*="list-item"]:has-text("Renew Dishwasher warranty")',
      hosting: '[class*="list-item"]:has-text("Hosting Saturday")',
    },
  },

  // 2. Groceries.
  { id: "groceries-aisles", path: "/groceries", page: Groceries, prepare: () => groceriesView("aisle"), marks: { oneList: "text=One list", lemons: "text=Lemons", addAll: "text=Add all 2", reAdd: ["text=Re-add suggestions", 2], needSoon: ["text=Need soon", 2] } },
  { id: "groceries-flat", path: "/groceries", page: Groceries, prepare: () => groceriesView("flat"), marks: { byAisle: "text=By aisle", ricotta: "text=Ricotta", sheets: "text=Lasagne sheets" } },
  // A swipe to the right marks an item as got: held mid-way, then released.
  { id: "groceries-swipe", path: "/groceries", page: Groceries, prepare: () => groceriesView("aisle"), actions: [{ drag: ["text=Lemons", 90, 0, true] }, { wait: 200 }], marks: { lemons: "text=Lemons" } },
  { id: "groceries-got", path: "/groceries", page: Groceries, prepare: () => groceriesView("aisle"), actions: [{ drag: ["text=Lemons", 180, 0] }, { wait: 700 }], marks: { track: ["text=Track today", 2] } },
  // The list before and after a recipe adds its two missing ingredients.
  { id: "groceries-no-recipe", path: "/groceries", page: Groceries, prepare: () => { groceriesView("flat"); seed({ grocery_items: groceries.filter((g) => g.recipe_source_id !== "r-lasagne") }); }, actions: [{ scroll: 330 }, { wait: 300 }] },
  { id: "groceries-recipe", path: "/groceries", page: Groceries, prepare: () => groceriesView("flat"), actions: [{ scroll: 330 }, { wait: 300 }], marks: { ricotta: "text=Ricotta", sheets: "text=Lasagne sheets" } },
  {
    id: "groceries-track",
    path: "/groceries",
    page: Groceries,
    prepare: () => {
      groceriesView("aisle");
      seed({ grocery_items: groceriesMidShop() });
    },
  },
  {
    id: "groceries-shopping",
    path: "/groceries",
    page: Groceries,
    prepare: () => {
      groceriesView("aisle");
      seed({ grocery_items: groceriesMidShop() });
      seedTable("grocery_sessions", [todaysSession()]);
    },
    marks: { rewards: "[aria-label='Rewards cards']", done: "text=Done shopping" },
  },
  {
    id: "groceries-rewards",
    path: "/groceries",
    page: Groceries,
    prepare: () => {
      groceriesView("aisle");
      seed({ grocery_items: groceriesMidShop() });
      seedTable("grocery_sessions", [todaysSession()]);
    },
    actions: [{ click: "[aria-label='Rewards cards']" }, { wait: 500 }, { click: "text=Flybuys" }, { wait: 600 }],
  },
  // The list without the assistant's batteries, for the before frame.
  { id: "groceries-plain", path: "/groceries", page: Groceries, prepare: () => groceriesView("flat") },

  // The assistant added batteries for the hallway sensor.
  {
    id: "groceries-batteries",
    path: "/groceries",
    page: Groceries,
    prepare: () => {
      groceriesView("flat");
      seed({ grocery_items: [grocery("g-batteries", "AA batteries", "household", { quantity: 4, price_cents: 900, notes: "Hallway motion sensor", sort_order: -1, created_by: null, updated_by: null }), ...groceries] });
    },
    marks: { batteries: "text=AA batteries" },
  },

  // 3. Calendar.
  { id: "calendar", path: "/calendar", page: Calendar, actions: [...toSaturday, { click: "text=Agenda" }, { wait: 500 }], marks: { jazz: "text=Jazz at the Lighthouse >> visible=true", hosting: '[class*="min-h-[56px]"]:has-text("Hosting Saturday")', sensor: '[class*="min-h-[56px]"]:has-text("Replace hallway")', agenda: ["text=Agenda", 1] } },
  { id: "calendar-no-jazz", path: "/calendar", page: Calendar, prepare: () => seed({ events: events.filter((e) => e.id !== "e-jazz") }), actions: [...toSaturday, { click: "text=Agenda" }, { wait: 500 }] },
  { id: "calendar-event", path: "/calendar", page: Calendar, actions: [...toSaturday, { click: "text=Agenda" }, { wait: 400 }, { click: "text=Jazz at the Lighthouse >> visible=true" }, { wait: 600 }], marks: { fill: "text=Fill", save: "text=Save" } },

  // 4. Recipes.
  { id: "recipes", path: "/recipes", page: Recipes, marks: { scan: "text=Scan a recipe", lasagne: "text=Lasagne >> visible=true", canMake: "text=Can make now" } },
  { id: "recipe-lasagne", path: "/recipes/r-lasagne", params: { id: "r-lasagne" }, page: RecipeDetail, marks: { addMissing: "text=/Add \\d+ missing/", have: "text=/\\d of \\d have/" } },
  { id: "recipe-lasagne-steps", path: "/recipes/r-lasagne", params: { id: "r-lasagne" }, page: RecipeDetail, actions: [{ scroll: 720 }, { wait: 400 }] },

  // 6. Costs.
  { id: "costs", path: "/costs", page: Costs, marks: { jazz: "text=Jazz at the Lighthouse >> visible=true", planned: ["text=planned", 1], chart: ["text=Projected", 2], recurring: ["text=Rent", 2] } },
  { id: "costs-groceries", path: "/costs", page: Costs, actions: [{ click: "text=Groceries >> visible=true" }, { wait: 500 }, { scroll: 520 }, { wait: 300 }], marks: { trip: "text=FreshCo >> visible=true" } },
  { id: "costs-groceries-before", path: "/costs", page: Costs, prepare: () => seed({ cost_items: costItems.filter((c) => c.id !== "c-trip-0") }), actions: [{ click: "text=Groceries >> visible=true" }, { wait: 500 }, { scroll: 520 }, { wait: 300 }] },

  // 7. Documents.
  { id: "documents", path: "/documents", page: Documents, marks: { warranty: "text=Dishwasher warranty >> visible=true", gym: "text=Gym membership contract >> visible=true" } },

  // 8. Checklists.
  { id: "checklists", path: "/checklists", page: Checklists },
  { id: "checklist-hosting", path: "/checklists/cl-hosting", params: { id: "cl-hosting" }, page: ChecklistDetail, marks: { date: "text=Date on dashboard", wine: "text=Wine >> visible=true", logCosts: "text=Log checked items in Costs" } },

  // Tasks, for the assistant's to-do.
  { id: "tasks", path: "/tasks", page: Tasks, marks: { warranty: "text=Renew Dishwasher warranty >> visible=true", gym: "text=Gym membership contract ends >> visible=true", hosting: "text=Hosting Saturday >> visible=true", sensor: "text=Replace hallway sensor battery >> visible=true", insurance: "text=Home insurance contract ends >> visible=true" } },
  // Tasks scrolled to the gym contract's renewal task, which sits under the fold.
  { id: "tasks-gym", path: "/tasks", page: Tasks, actions: [{ scroll: 300 }, { wait: 400 }], marks: { gym: "text=Gym membership contract ends >> visible=true" } },
  // Tasks before the other rooms added theirs: only the chores people wrote.
  {
    id: "tasks-plain",
    path: "/tasks",
    page: Tasks,
    prepare: () => {
      const own = tasks.filter((t) => ["t-bins", "t-plants", "t-plumber"].includes(t.id));
      seed({ household_tasks: own });
      seedTable("household_tasks", own);
    },
  },
];

/** The live demo's pages, by path; a path with an id matches its prefix. */
const LIVE_PAGES: ReadonlyArray<[path: string, page: LazyExoticComponent<ComponentType>]> = [
  ["/home", Home],
  ["/groceries", Groceries],
  ["/calendar", Calendar],
  ["/recipes/", RecipeDetail],
  ["/recipes", Recipes],
  ["/costs", Costs],
  ["/documents", Documents],
  ["/checklists/", ChecklistDetail],
  ["/checklists", Checklists],
  ["/tasks", Tasks],
];

export function livePage(path: string): LazyExoticComponent<ComponentType> | null {
  return LIVE_PAGES.find(([p]) => (p.endsWith("/") ? path.startsWith(p) : path === p))?.[1] ?? null;
}

export function findScene(id: string | null): Scene {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}
