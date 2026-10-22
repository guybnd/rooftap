// One scene per screenshot: which page, on which route, with which household
// state, and what the screenshot script taps before it shoots. The landing
// page's eight stories are told with these frames.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { buildPlanToBuyTask } from "@homeup/core";
import { costItems, documentLinks, documents, events, fridgeReceipt, groceries, groceriesMidShop, grocery, HOUSEHOLD, jazzTicket, jazzTicketLink, lasagnePhoto, mapDocumentLinks, SATURDAY, seed, seedTable, shopperOffers, shopperWants, tasks, ticketsFolder, todaysSession, vacuumWarranty } from "./fixtures";

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
const Shopper = lazy(() => import("../../src/app/shopper/page"));
const ShopperItem = lazy(() => import("../../src/app/shopper/[id]/page"));
const ScoutRun = lazy(() => import("../../src/app/shopper/scout/[id]/page"));
const Assistant = lazy(() => import("../../src/app/assistant/page"));
const AssistantThread = lazy(() => import("../../src/app/assistant/[id]/page"));
const Rewards = lazy(() => import("../../src/app/rewards/page"));
const Settings = lazy(() => import("../../src/app/settings/[key]/page"));
const SettingsHome = lazy(() => import("../../src/app/settings/page"));
const ChecklistTemplates = lazy(() => import("../../src/app/checklists/templates/page"));
const ChecklistNew = lazy(() => import("../../src/app/checklists/new/page"));
const RecipeNew = lazy(() => import("../../src/app/recipes/new/page"));
const Setup = lazy(() => import("../../src/app/setup/page"));
const HomeSearch = lazy(() => import("../../src/app/homesearch/page"));
const Appointments = lazy(() => import("../../src/app/appointments/page"));
const ApartmentNew = lazy(() => import("../../src/app/apartment/new/page"));
const Apartment = lazy(() => import("../../src/app/apartment/[id]/page"));
const MapView = lazy(() => import("../../src/app/map/page"));
const SearchChecklist = lazy(() => import("../../src/app/checklist/page"));
const ShelfLife = lazy(() => import("../../src/app/groceries/shelf-life/page"));

/** The to-do that Plan to buy writes for the robot vacuum, at the cheapest store. */
const planToBuyTask = () =>
  buildPlanToBuyTask({ id: "t-buy-vacuum", want: shopperWants.find((w) => w.id === "w-vacuum")!, offer: shopperOffers.find((o) => o.id === "o-vac-jb")!, priceLabel: "$449.00 at JB Hi-Fi" });

/**
 * The Groceries View menu (By aisle, One list, Only needed) and the rewards
 * card button. The first of each sits in the collapsed bar, hidden until the
 * list scrolls, so these take the second: the one in the head.
 */
const VIEW = "[aria-label^='View options'] >> nth=1";
const REWARDS = "[aria-label='Rewards cards'] >> nth=1";
const ROOF = "button[aria-label^='Add (hold']";
const CAPTURE_FIELD = "input[placeholder='Add or ask anything']";
const QUOTE = "Compare insurance quotes";
const STORE_SEARCH = "[placeholder='Which store are you at?']";

function groceriesView(mode: "aisle" | "flat") {
  localStorage.setItem("homeup_grocery_sort_mode", mode);
  localStorage.setItem("homeup_shopping_tooltip_dismissed", "1");
}

/** The Jazz night's ticket in Documents' Event tickets folder, linked to the event. */
function withTicket() {
  seed({ documents: [...documents, jazzTicket] });
  // The demo client does not filter or embed, so the ticket's row carries its document for the event's list.
  seedTable("document_links", [...documentLinks, { ...jazzTicketLink, documents: jazzTicket }]);
  seedTable("document_folders", [ticketsFolder]);
}

/** Documents linked to a grocery trip, a recipe and a setup item, for the module map. */
function withMapDocuments() {
  const docs = [...documents, lasagnePhoto, fridgeReceipt];
  seed({ documents: docs });
  // The demo client does not filter or embed, so each row carries its document for Home Setup's Doc chip.
  seedTable("document_links", [...documentLinks, ...mapDocumentLinks].map((l) => ({ ...l, documents: docs.find((d) => d.id === l.document_id) })));
}

/** The calendar opens on today; the story's night out is on Saturday. */
const saturday = new Date();
saturday.setDate(saturday.getDate() + SATURDAY);
const toSaturday: Action[] = SATURDAY === 0 ? [] : [{ click: `text=/^${saturday.getDate()}$/` }, { wait: 300 }];
/** The Sunday after it opens the next week of the strip: the arrow, then the day. */
const sunday = new Date(saturday);
sunday.setDate(sunday.getDate() + 1);
const toSunday: Action[] = [{ tap: [360, 178] }, { wait: 400 }, { click: `text=/^${sunday.getDate()}$/` }, { wait: 300 }];

export const SCENES: Scene[] = [
  // 1. Home: everything at a glance, with the Upcoming feed fed by every room.
  {
    id: "home",
    path: "/home",
    page: Home,
    marks: { count: ["text=left today", 2], weather: ["text=Rain from", 1], now: ["text=Bins out >> visible=true", 4], upcoming: ["text=Upcoming", 3], roof: ROOF },
  },
  // Capture: the + opens one sheet for every module; what's typed searches them all.
  {
    id: "capture",
    path: "/home",
    page: Home,
    actions: [{ click: ROOF }, { wait: 700 }],
    marks: { field: CAPTURE_FIELD, chat: "text=Chat with Rooftap", grocery: ["text=Grocery", 1] },
  },
  {
    id: "capture-search",
    path: "/home",
    page: Home,
    actions: [{ click: ROOF }, { wait: 600 }, { fill: CAPTURE_FIELD, value: "insurance" }, { wait: 700 }],
    marks: { ask: "button:has-text('Ask Rooftap')", todo: "button:has-text('To-do') >> visible=true", cost: "button:has-text('Cost') >> visible=true", costRow: ["text=NRMA", 2], taskRow: "text=Home insurance contract ends >> nth=-1" },
  },
  {
    id: "capture-todo",
    path: "/home",
    page: Home,
    actions: [{ click: ROOF }, { wait: 600 }, { fill: CAPTURE_FIELD, value: QUOTE }, { wait: 700 }, { click: "button:has-text('To-do') >> visible=true" }, { wait: 800 }],
    marks: { task: "input[value='Compare insurance quotes']", due: "text=Due date" },
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
  { id: "groceries-aisles", path: "/groceries", page: Groceries, prepare: () => groceriesView("aisle"), marks: { view: VIEW, lemons: "text=Lemons", addAll: "text=Add all >> visible=true", reAdd: "[aria-label='Might be running low']", onions: "text=Onions >> visible=true" } },
  // The View menu open, on each sort.
  { id: "groceries-aisles-menu", path: "/groceries", page: Groceries, prepare: () => groceriesView("aisle"), actions: [{ click: VIEW }, { wait: 400 }], marks: { oneList: "text=One list >> visible=true" } },
  { id: "groceries-flat-menu", path: "/groceries", page: Groceries, prepare: () => groceriesView("flat"), actions: [{ click: VIEW }, { wait: 400 }], marks: { byAisle: "text=By aisle >> visible=true" } },
  { id: "groceries-flat", path: "/groceries", page: Groceries, prepare: () => groceriesView("flat"), marks: { view: VIEW, ricotta: "text=Ricotta", sheets: "text=Lasagne sheets" } },
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
    marks: { rewards: REWARDS, done: "button:has-text('Done') >> visible=true" },
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
    actions: [{ click: REWARDS }, { wait: 500 }, { click: "text=Flybuys" }, { wait: 600 }],
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
  { id: "costs", path: "/costs", page: Costs, marks: { jazz: "text=Jazz at the Lighthouse >> visible=true", planned: ["text=planned", 2], chart: ["text=Projected", 2], recurring: ["text=Rent", 2] } },
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

  // Shopper: the watchlist, one item's price history and stores, and the to-do Plan to buy writes.
  {
    id: "shopper",
    path: "/shopper",
    page: Shopper,
    marks: {
      good: ["text=at a good price now", 2],
      vacuum: '[class*="list-item"]:has-text("Roborock")',
      airfryer: '[class*="list-item"]:has-text("air fryer")',
      bike: '[class*="list-item"]:has-text("bike")',
      desk: '[class*="list-item"]:has-text("Standing desk")',
    },
  },
  {
    id: "shopper-item",
    path: "/shopper/w-vacuum",
    params: { id: "w-vacuum" },
    page: ShopperItem,
    marks: { hero: 'div.space-y-1\\.5:has-text("cheapest nearby")', verdict: "text=/Hit target/", history: ["text=Price history", 2], jb: '[class*="list-item"]:has-text("JB Hi-Fi")' },
  },
  {
    id: "shopper-item-buy",
    path: "/shopper/w-vacuum",
    params: { id: "w-vacuum" },
    page: ShopperItem,
    actions: [{ scroll: 600 }, { wait: 400 }],
    marks: { offers: ["text=Where to buy", 2], manual: '[class*="list-item"]:has-text("Bing Lee")', deals: ["text=Deals people shared", 1], plan: "text=Plan to buy", sources: "text=/Prices from/" },
  },
  {
    id: "tasks-shopper",
    path: "/tasks",
    page: Tasks,
    prepare: () => seed({ household_tasks: [planToBuyTask(), ...tasks] }),
    marks: { buy: "text=Buy Roborock Q7 robot vacuum at JB Hi-Fi >> visible=true" },
  },

  // Scout: one finished run, three picks, the second already on the watchlist.
  {
    id: "shopper-scout-list",
    path: "/shopper",
    page: Shopper,
    actions: [{ scroll: 900 }, { wait: 400 }],
    marks: { run: '[class*="list-item"]:has-text("TV for the lounge")', tv: '[class*="list-item"]:has-text("QN85D")' },
  },
  {
    id: "shopper-scout",
    path: "/shopper/scout/scout-tv",
    params: { id: "scout-tv" },
    page: ScoutRun,
    marks: { hero: ["text=/picks? (under|for)/", 2], best: '[class*="list-item"]:has-text("Hisense")', picture: '[class*="list-item"]:has-text("QN85D")', stretch: '[class*="list-item"]:has-text("OLED")' },
  },
  {
    id: "shopper-scout-pick",
    path: "/shopper/scout/scout-tv",
    params: { id: "scout-tv" },
    page: ScoutRun,
    actions: [{ click: "text=Hisense 65" }, { wait: 700 }],
    marks: { watch: "text=Watch the price", why: "text=Bright enough for a sunny room" },
  },
  // A Scout thread: a question answered, then a change that searched again.
  {
    id: "shopper-scout-thread",
    path: "/shopper/scout/scout-mw",
    params: { id: "scout-mw" },
    page: ScoutRun,
    actions: [{ scroll: 2000 }, { wait: 400 }],
    marks: {
      ask: ["text=Why is there nothing under $120?", 1],
      answer: "text=/cheapest 25 litre/",
      again: "text=Searching again",
      grill: '[class*="list-item"]:has-text("Sharp 25L")',
      composer: "textarea",
    },
  },

  // Rewards: the wallet, a store lookup, the card at the till, and the perks.
  {
    id: "rewards",
    path: "/rewards",
    page: Rewards,
    marks: { search: "[placeholder='Which store are you at?']", chips: ["button:has-text('Ampol')", 1], flybuys: "button:has-text('Flybuys')", costco: "button:has-text('Costco') >> nth=1" },
  },
  {
    id: "rewards-store",
    path: "/rewards",
    page: Rewards,
    actions: [{ fill: STORE_SEARCH, value: "Officeworks" }, { wait: 400 }],
    marks: { hero: ["text=/works? at Officeworks/", 2], match: '[class*="list-item"]:has-text("Flybuys")', show: "text=Show Flybuys card" },
  },
  {
    id: "rewards-card",
    path: "/rewards",
    page: Rewards,
    actions: [{ fill: STORE_SEARCH, value: "Officeworks" }, { wait: 400 }, { click: "text=Show Flybuys card" }, { wait: 700 }],
    marks: { stores: "text=Stores and perks", perk: "text=10% off print and copy >> visible=true" },
  },
  {
    id: "rewards-perks",
    path: "/rewards",
    page: Rewards,
    actions: [{ click: "text=Perks >> visible=true" }, { wait: 400 }],
    marks: { ending: ["text=Ending soon", 1], bws: "text=$10 off a $50 spend >> visible=true", print: "text=10% off print and copy >> visible=true" },
  },

  // Assistant: the space, the household thread with Telegram in it, and its settings.
  {
    id: "assistant",
    path: "/assistant",
    page: Assistant,
    marks: { pending: ["text=waiting on your OK", 2], ask: "textarea", household: '[class*="list-item"]:has-text("Household")', chats: '[class*="list-item"]:has-text("Hosting Saturday")', quick: '[class*="list-item"]:has-text("Dinner tonight")', house: '[class*="list-item"]:has-text("The house tonight")' },
  },
  {
    id: "assistant-household",
    path: "/assistant/household",
    params: { id: "household" },
    page: AssistantThread,
    actions: [{ scroll: 2000 }, { wait: 400 }],
    marks: { ava: ["text=Book the plumber", 1], proposal: ["text=Add \"Plumber\" to Calendar", 3], doAll: "text=Do all 2" },
  },
  // The same thread from its start: Noa's message came from Telegram.
  {
    id: "assistant-telegram",
    path: "/assistant/household",
    params: { id: "household" },
    page: AssistantThread,
    actions: [{ scroll: -2000 }, { wait: 400 }],
    marks: { noa: ["text=Are the bins tonight", 1], tag: "text=52m ago · Telegram", groceries: ["text=Add \"Milk\" to Groceries", 3] },
  },
  // A named chat that reached Home Assistant: a look-up, then lights and heating.
  {
    id: "assistant-house",
    path: "/assistant/conv-house",
    params: { id: "conv-house" },
    page: AssistantThread,
    actions: [{ scroll: 2000 }, { wait: 400 }],
    marks: { garage: ["text=Turn off \"Garage door\" in Home Assistant", 1], porch: ["text=Turn on \"Porch light\" in Home Assistant", 3], ask: ["text=Turn on the porch light", 1] },
  },
  // A named chat where the assistant started a Scout search.
  {
    id: "assistant-scout",
    path: "/assistant/conv-microwave",
    params: { id: "conv-microwave" },
    page: AssistantThread,
    marks: { ask: ["text=Can you find us a microwave", 1], scout: ["text=Ask Scout to find", 3], open: 'p:has-text("I asked Scout to look")' },
  },
  // A named chat that planned Saturday across Recipes, Checklists and Tasks.
  {
    id: "assistant-hosting",
    path: "/assistant/conv-hosting",
    params: { id: "conv-hosting" },
    page: AssistantThread,
    actions: [{ scroll: 2000 }, { wait: 400 }],
    marks: { recipe: ["text=Add a recipe's ingredients to Groceries", 3], task: ["text=Add \"Pick up the chairs\" to Tasks", 3] },
  },
  // Settings > Assistant, scrolled to the Home Assistant panel.
  {
    id: "assistant-home-assistant",
    path: "/settings/assistant",
    params: { key: "assistant" },
    page: Settings,
    actions: [{ click: "text=Home Assistant >> visible=true" }, { wait: 300 }],
    marks: { panel: ["text=Home Assistant >> visible=true", 3], connected: "text=/^Connected to/", trust: ["text=What it may do >> nth=1", 1], tools: "text=Tools the assistant may use" },
  },
  {
    id: "assistant-settings",
    path: "/settings/assistant",
    params: { key: "assistant" },
    page: Settings,
    marks: { trust: ["text=What it may do", 3], models: ["text=Models", 3] },
  },
  {
    id: "assistant-spending",
    path: "/settings/assistant",
    params: { key: "assistant" },
    page: Settings,
    actions: [{ scroll: 900 }, { wait: 400 }],
  },

  // README journeys: frames the landing stories do not use.
  {
    id: "readme-event-ticket",
    path: "/calendar",
    page: Calendar,
    prepare: withTicket,
    actions: [...toSaturday, { click: "text=Agenda" }, { wait: 400 }, { click: "text=Jazz at the Lighthouse >> visible=true" }, { wait: 600 }, { scroll: 2000 }, { wait: 600 }],
    marks: { ticket: "text=Jazz at the Lighthouse ticket", budget: ["text=Kept in the Budget as Going out.", 1] },
  },
  { id: "readme-documents-tickets", path: "/documents", page: Documents, prepare: withTicket },
  { id: "readme-assistant-week", path: "/assistant/conv-week", params: { id: "conv-week" }, page: AssistantThread, actions: [{ scroll: 2000 }, { wait: 400 }] },
  { id: "readme-homesearch", path: "/homesearch", page: HomeSearch },
  { id: "readme-setup", path: "/setup", page: Setup },
  { id: "readme-documents-lease", path: "/documents", page: Documents, actions: [{ click: "text=Leases >> visible=true" }, { wait: 400 }] },
  { id: "readme-tasks-lease", path: "/tasks", page: Tasks, actions: [{ scroll: 800 }, { wait: 400 }] },
  { id: "readme-documents-vacuum", path: "/documents", page: Documents, prepare: () => seed({ documents: [...documents, vacuumWarranty] }), actions: [{ click: "text=Warranties >> visible=true" }, { wait: 400 }] },

  // The landing page's module map: one frame for each link the stories do not show.
  {
    id: "map-costs-suggest",
    path: "/costs",
    page: Costs,
    prepare: () => {
      HOUSEHOLD.group.chosen_apartment_id = "ap-ocean";
      HOUSEHOLD.userSettings.costs_hide_section_suggestions = false;
      seed({ cost_items: costItems.filter((c) => c.id !== "c-rent") });
    },
    actions: [{ scroll: 640 }, { wait: 400 }],
    marks: { rent: "text=/chosen home/", setup: "text=/estimated$/" },
  },
  // Sunday's agenda: two viewings and a birthday from Google Calendar.
  { id: "map-calendar-sunday", path: "/calendar", page: Calendar, actions: [...toSunday, { click: "text=Agenda" }, { wait: 500 }], marks: { viewing: "text=/Rose St/ >> visible=true", birthday: "text=Mia's birthday >> visible=true" } },
  { id: "map-appointments", path: "/appointments", page: Appointments, actions: [{ wait: 400 }], marks: { suggestion: "text=Inspection 12 Separation St" } },
  { id: "map-documents-receipts", path: "/documents", page: Documents, prepare: withMapDocuments, actions: [{ click: "text=Receipts >> visible=true" }, { wait: 400 }], marks: { receipt: "text=FreshCo receipt >> visible=true", fridge: "text=Fridge receipt >> visible=true" } },
  { id: "map-documents-recipe", path: "/documents", page: Documents, prepare: withMapDocuments, actions: [{ fill: "input[placeholder^='Search documents']", value: "Lasagne" }, { wait: 500 }], marks: { photo: "text=Lasagne recipe photo >> visible=true" } },
  { id: "map-setup-doc", path: "/setup", page: Setup, prepare: withMapDocuments, actions: [{ wait: 400 }], marks: { doc: "text=/^Doc$/ >> visible=true" } },
];

/** The live demo's pages, by path; a path with an id matches its prefix. */
const LIVE_PAGES: ReadonlyArray<[path: string, page: LazyExoticComponent<ComponentType>]> = [
  ["/home", Home],
  ["/groceries/shelf-life", ShelfLife],
  ["/groceries", Groceries],
  ["/calendar", Calendar],
  ["/recipes/new", RecipeNew],
  ["/recipes/", RecipeDetail],
  ["/recipes", Recipes],
  ["/costs", Costs],
  ["/documents", Documents],
  ["/checklists/templates", ChecklistTemplates],
  ["/checklists/new", ChecklistNew],
  ["/checklists/", ChecklistDetail],
  ["/checklists", Checklists],
  ["/tasks", Tasks],
  ["/shopper/scout/", ScoutRun],
  ["/shopper/", ShopperItem],
  ["/shopper", Shopper],
  ["/rewards", Rewards],
  ["/setup", Setup],
  ["/homesearch", HomeSearch],
  ["/appointments", Appointments],
  ["/map", MapView],
  ["/checklist", SearchChecklist],
  ["/apartment/new", ApartmentNew],
  ["/apartment/", Apartment],
  ["/assistant/", AssistantThread],
  ["/assistant", Assistant],
  ["/settings/", Settings],
  ["/settings", SettingsHome],
];

export function livePage(path: string): LazyExoticComponent<ComponentType> | null {
  return LIVE_PAGES.find(([p]) => (p.endsWith("/") ? path.startsWith(p) : path === p))?.[1] ?? null;
}

export function findScene(id: string | null): Scene {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}
