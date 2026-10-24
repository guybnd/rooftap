import { MODULE_FEATURES, type ModuleFeatureId, type ModuleId } from "@homeup/core";
import type { ScreenId } from "./screens";

// The landing page's module map: every line is a pair of modules that a
// cross-module feature in packages/core (module-features.ts) joins, plus the
// Rewards card in Groceries (rewards enhances groceries, no gated feature).
// module-map-data.test.ts fails when a two-module feature has no line here,
// or a line names a feature that does not join its two modules.

// Money insights is part of Costs on the map, and MCP is not a module people see.
export type MapModule = Exclude<ModuleId, "mcp" | "money-insights">;

/** Short names: the map has no room for "Tasks & Reminders". */
export const MAP_LABEL: Record<MapModule, string> = {
  household: "Tasks",
  calendar: "Calendar",
  checklists: "Checklists",
  documents: "Documents",
  groceries: "Groceries",
  recipes: "Recipes",
  costs: "Costs & Budget",
  setup: "Home Setup",
  search: "Home Search",
  shopper: "Shopper",
  rewards: "Rewards",
  "google-calendar": "Google Calendar",
  assistant: "Assistant",
  meals: "Meal plan",
  occasions: "Occasions",
  bins: "Bin night",
  "home-care": "Home care",
};

/** The section whose hue a module's tile takes. */
export const mapSection = (id: MapModule) => ({ "google-calendar": "calendar", meals: "recipes", "home-care": "setup" } as Partial<Record<MapModule, string>>)[id] ?? id;

/** Where each module sits, in map units: wide (1200 by 560) and tall (360 by 680). */
export const MAP_WIDE = { w: 1200, h: 560 } as const;
export const MAP_TALL = { w: 360, h: 680 } as const;
export const POS: Record<MapModule, { wide: [number, number]; tall: [number, number] }> = {
  checklists: { wide: [130, 60], tall: [62, 40] },
  household: { wide: [420, 60], tall: [180, 40] },
  calendar: { wide: [720, 60], tall: [290, 40] },
  "google-calendar": { wide: [1040, 60], tall: [262, 150] },
  shopper: { wide: [130, 240], tall: [62, 160] },
  costs: { wide: [500, 240], tall: [180, 220] },
  search: { wide: [1080, 230], tall: [282, 270] },
  setup: { wide: [1080, 340], tall: [284, 420] },
  documents: { wide: [800, 345], tall: [180, 380] },
  rewards: { wide: [130, 420], tall: [62, 530] },
  groceries: { wide: [400, 420], tall: [62, 360] },
  recipes: { wide: [650, 420], tall: [180, 530] },
  assistant: { wide: [290, 330], tall: [62, 262] },
  occasions: { wide: [300, 150], tall: [100, 100] },
  bins: { wide: [830, 150], tall: [300, 340] },
  meals: { wide: [530, 510], tall: [100, 620] },
  "home-care": { wide: [1060, 460], tall: [270, 620] },
};

export interface MapShot {
  scene: ScreenId;
  mark: string;
}

export interface MapLink {
  a: MapModule;
  b: MapModule;
  /** The core features this line stands for. Empty only for Rewards and Groceries. */
  features: readonly ModuleFeatureId[];
  /** What the link does, for a person reading the landing page. */
  text: string;
  /** Demo frames that show it, cropped to the measured mark. Every link has one (the test holds it). */
  shots: readonly MapShot[];
}

export const MAP_LINKS: readonly MapLink[] = [
  {
    a: "recipes",
    b: "groceries",
    features: ["recipes.groceries"],
    text: "A recipe shows what you have and what you need. Add missing puts the rest on the list, in their aisles, with the recipe on each item.",
    shots: [
      { scene: "recipe-lasagne", mark: "addMissing" },
      { scene: "groceries-recipe", mark: "ricotta" },
    ],
  },
  {
    a: "groceries",
    b: "costs",
    features: ["costs.from-groceries"],
    text: "Done shopping writes the trip to Costs as one line with its total.",
    shots: [{ scene: "costs-groceries", mark: "trip" }],
  },
  {
    a: "rewards",
    b: "groceries",
    features: [],
    text: "Your rewards cards are one tap from the shopping list.",
    shots: [{ scene: "groceries-shopping", mark: "rewards" }],
  },
  {
    a: "checklists",
    b: "household",
    features: ["tasks.checklists", "hub.task-checklists"],
    text: "Attach a checklist to a task and see its progress, on the task and on Home. A checklist with a date makes its own task.",
    shots: [
      { scene: "checklist-hosting", mark: "date" },
      { scene: "tasks", mark: "hosting" },
    ],
  },
  {
    a: "household",
    b: "calendar",
    features: ["calendar.tasks"],
    text: "Tasks with a date show on the calendar. You can add a to-do from the calendar.",
    shots: [{ scene: "calendar", mark: "hosting" }],
  },
  {
    a: "checklists",
    b: "costs",
    features: ["costs.from-checklists"],
    text: "A checklist with Log costs adds a cost line for each item you check.",
    shots: [{ scene: "checklist-hosting", mark: "logCosts" }],
  },
  {
    a: "documents",
    b: "household",
    features: ["tasks.from-document"],
    text: "A document can have a reminder task, for example when a warranty ends. Each one links to the other.",
    shots: [
      { scene: "documents", mark: "warranty" },
      { scene: "tasks", mark: "warranty" },
    ],
  },
  {
    a: "costs",
    b: "household",
    features: ["tasks.from-cost"],
    text: "A bill can have a reminder task. Each one links to the other.",
    shots: [
      { scene: "tasks-gym", mark: "gym@row" },
    ],
  },
  {
    a: "shopper",
    b: "household",
    features: ["shopper.tasks"],
    text: "Plan to buy on a Shopper item adds a Buy it to-do.",
    shots: [
      { scene: "shopper-item-buy", mark: "plan" },
      { scene: "tasks-shopper", mark: "buy" },
    ],
  },
  {
    a: "shopper",
    b: "costs",
    features: ["shopper.costs"],
    text: "Plan to buy on a Shopper item adds a planned one-off cost to the budget.",
    shots: [{ scene: "shopper-item-buy", mark: "plan" }],
  },
  {
    a: "assistant",
    b: "shopper",
    features: ["shopper.assistant-scout"],
    text: "Ask the Assistant to find something and it starts a Scout search. On the search you ask about a pick or change what you want, and new picks land below.",
    shots: [
      { scene: "assistant-scout", mark: "open" },
      { scene: "shopper-scout-thread", mark: "again" },
    ],
  },
  {
    a: "calendar",
    b: "documents",
    features: ["calendar.event-documents"],
    text: "Attach documents to a calendar event, for example its tickets.",
    shots: [
      { scene: "readme-event-ticket", mark: "ticket" },
    ],
  },
  {
    a: "calendar",
    b: "costs",
    features: ["calendar.budget"],
    text: "An event's ticket cost goes in the budget as a Going out line.",
    shots: [
      { scene: "readme-event-ticket", mark: "budget" },
      { scene: "map-costs-jazz", mark: "jazz@row" },
    ],
  },
  {
    a: "calendar",
    b: "search",
    features: ["calendar.viewings"],
    text: "Viewings show on the calendar. You can book one from it.",
    shots: [
      { scene: "map-calendar-sunday", mark: "viewing@row" },
    ],
  },
  {
    a: "calendar",
    b: "google-calendar",
    features: ["calendar.google-events", "hub.calendar-events"],
    text: "Your Google Calendar events show on the calendar and in the Home agenda.",
    shots: [
      { scene: "map-calendar-sunday", mark: "birthday@row" },
    ],
  },
  {
    a: "search",
    b: "google-calendar",
    features: ["search.google-suggestions"],
    text: "Home Search suggests viewings from your Google Calendar.",
    shots: [
      { scene: "map-appointments", mark: "suggestion@row" },
    ],
  },
  {
    a: "search",
    b: "costs",
    features: ["costs.suggest-rent"],
    text: "Costs suggests the rent from the apartment you chose.",
    shots: [
      { scene: "map-costs-suggest", mark: "rent@row" },
    ],
  },
  {
    a: "setup",
    b: "costs",
    features: ["costs.suggest-setup"],
    text: "Costs suggests the moving costs from your Home Setup purchases.",
    shots: [
      { scene: "map-costs-suggest", mark: "setup@row" },
    ],
  },
  {
    a: "documents",
    b: "costs",
    features: ["documents.costs"],
    text: "Attach documents to a bill. A document shows the bills it belongs to.",
    shots: [
      { scene: "documents", mark: "gym@row" },
    ],
  },
  {
    a: "documents",
    b: "groceries",
    features: ["documents.groceries"],
    text: "Grocery receipts are filed as documents and link back to Groceries.",
    shots: [
      { scene: "map-documents-receipts", mark: "receipt@row" },
    ],
  },
  {
    a: "documents",
    b: "setup",
    features: ["documents.setup"],
    text: "A setup item shows a Doc chip for its document. A document shows its setup items.",
    shots: [
      { scene: "map-setup-doc", mark: "doc" },
      { scene: "map-documents-receipts", mark: "fridge@row" },
    ],
  },
  {
    a: "documents",
    b: "recipes",
    features: ["documents.recipes"],
    text: "A scanned recipe keeps its source photo in Documents.",
    shots: [
      { scene: "map-documents-recipe", mark: "photo@row" },
    ],
  },
  {
    a: "recipes",
    b: "meals",
    features: ["recipes.meal-plan", "hub.meals"],
    text: "The meal plan is the This week tab in Recipes. Each night takes a recipe and a cook. Home shows the dinner for tonight.",
    shots: [{ scene: "recipes-week", mark: "count" }],
  },
  {
    a: "meals",
    b: "groceries",
    features: ["meals.groceries"],
    text: "Each night shows what is in stock. The week's missing ingredients go to Groceries in one tap.",
    shots: [{ scene: "recipes-week", mark: "curry@row" }],
  },
  {
    a: "meals",
    b: "assistant",
    features: ["meals.assistant-draft"],
    text: "Draft my week: the Assistant plans the empty nights from your recipes and the food in the house.",
    shots: [{ scene: "recipes-week", mark: "draft" }],
  },
  {
    a: "meals",
    b: "calendar",
    features: ["meals.calendar"],
    text: "A dinner out on the calendar shows as a hint on its night.",
    shots: [{ scene: "recipes-week", mark: "hint" }],
  },
  {
    a: "calendar",
    b: "occasions",
    features: ["calendar.occasions"],
    text: "Birthdays and other occasions show on the calendar as all-day rows.",
    shots: [{ scene: "map-calendar-occasion", mark: "birthday@row" }],
  },
  {
    a: "occasions",
    b: "shopper",
    features: ["occasions.shopper"],
    text: "Watch the price on a gift idea. The Shopper watch is kept from the same people as the gift.",
    shots: [{ scene: "occasions-noa", mark: "watching@row" }],
  },
  {
    a: "occasions",
    b: "costs",
    features: ["occasions.costs"],
    text: "A gift writes a Budget line named Gift until the day has passed.",
    shots: [{ scene: "map-costs-gift", mark: "gift@row" }],
  },
  {
    a: "calendar",
    b: "bins",
    features: ["calendar.bins"],
    text: "Bin collection days show on the calendar.",
    shots: [{ scene: "map-calendar-bins", mark: "bins@row" }],
  },
  {
    a: "bins",
    b: "assistant",
    features: ["bins.home-assistant"],
    text: "Bin night reads the bin days from Home Assistant's Waste Collection Schedule, through the Assistant's Home Assistant connection.",
    shots: [{ scene: "bins-setup", mark: "ha" }],
  },
  {
    a: "home-care",
    b: "setup",
    features: [],
    text: "Home care is the Care tab in Home Setup: upkeep jobs with a schedule, a person and a reminder.",
    shots: [{ scene: "setup-care", mark: "smoke@row" }],
  },
];

export const MAP_MODULES = Object.keys(POS) as MapModule[];

/**
 * Every two-module feature in core between modules on the map, so the test can
 * hold the map to it. Money insights is part of Costs on the map, so its
 * features (Compare with Scout, a reminder to cancel) have no line of their own.
 * A meal plan feature names Recipes too (the plan is a tab there), so a line
 * from Meal plan may stand for a feature of three modules.
 */
export const PAIR_FEATURES = (Object.keys(MODULE_FEATURES) as ModuleFeatureId[]).filter(
  (id) => MODULE_FEATURES[id].modules.length === 2 && MODULE_FEATURES[id].modules.every((m) => m in POS),
);
