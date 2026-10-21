// The household the landing page's screens show: Ava, Noa and Mia, one
// Saturday in their week. Dates are relative to the day the screens are
// built, so relative labels ("in 4h", "Fri") read right.
import type {
  Checklist,
  ChecklistTaskItem,
  CostItem,
  Document,
  DocumentLink,
  GroceryItem,
  Group,
  GroupEvent,
  GroupMember,
  HouseholdTask,
  LoyaltyCard,
  Recipe,
  RecipeIngredient,
  RewardPartner,
  RewardPerk,
  RewardScheme,
  AssistantConversation,
  AssistantMessage,
  AssistantStatus,
  AssistantUsage,
  ShopperOffer,
  ShopperPick,
  ShopperPriceSnapshot,
  ShopperSearch,
  ShopperWant,
  UserSettings,
  SetupItem,
  Apartment,
  Appointment,
  ChecklistItem,
} from "@homeup/core";
import type { AssistantScope, AssistantSettings, HomeAssistantStatus, HomeAssistantToolInfo } from "@homeup/core";

export const GROUP = "demo-home";
export const AVA = "user-ava";
export const NOA = "user-noa";
export const MIA = "user-mia";

const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
/** YYYY-MM-DD, `days` from today (local). */
export function day(days = 0): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** An ISO timestamp `days` from today at a local wall-clock time. */
export function at(days: number, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h, m).toISOString();
}
/** Days until the coming Saturday (this one if today is Saturday). */
export const SATURDAY = (6 - now.getDay() + 7) % 7;
const STAMP = at(-30, "09:00");

const base = { group_id: GROUP, created_at: STAMP, updated_at: STAMP, deleted: false };

export const group: Group = {
  id: GROUP,
  name: "Home",
  created_by: AVA,
  created_at: STAMP,
  region: "AU",
  home_address: "14 Wattle St, Brunswick",
  home_lat: -37.7664,
  home_lng: 144.9602,
  home_move_in_date: null,
  lease_end_date: day(63),
  lease_notice_days: 42,
  chosen_apartment_id: null,
};

export const groupMembers: GroupMember[] = [
  { group_id: GROUP, user_id: AVA, role: "owner", joined_at: STAMP },
  { group_id: GROUP, user_id: NOA, role: "member", joined_at: STAMP },
  { group_id: GROUP, user_id: MIA, role: "member", joined_at: STAMP },
] as GroupMember[];

export const memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }> = {
  [AVA]: { email: "ava@example.com", name: "Ava", avatar: null },
  [NOA]: { email: "noa@example.com", name: "Noa", avatar: null },
  [MIA]: { email: "mia@example.com", name: "Mia", avatar: null },
};

export const userSettings: UserSettings = {
  id: "settings-ava",
  user_id: AVA,
  rent_min: null,
  rent_max: null,
  appointment_duration_minutes: 30,
  default_section: null,
  last_used_section: "home",
  hidden_sections: null,
  section_order: null,
  costs_period: "monthly",
  costs_budget_monthly: 420000,
  costs_this_month_only: true,
  costs_hide_section_suggestions: true,
  grocery_aisle_order: null,
  grocery_aisle_units: null,
  grocery_sort_mode: null,
  grocery_suggest_dismiss: "not_now",
  checklists_completed_to_bottom: true,
  checklists_collapse_completed: false,
  checklists_default_sort: null,
  home_hero_modules: null,
  home_hero_countdown: null,
  reminder_lead_days: 14,
  tasks_upcoming_days: 90,
  calendar_todo_mode: "all_day",
  calendar_todo_default_time: "09:00",
  calendar_todo_default_duration_minutes: 30,
  calendar_show_pulled_events_in_todo: true,
  timezone: "Australia/Melbourne",
  mcp_enabled: true,
  mcp_read_only: false,
  mcp_allowed_tools: null,
  created_at: STAMP,
  updated_at: STAMP,
};

// ── Costs ────────────────────────────────────────────────────────────────────
const cost = (id: string, name: string, category: CostItem["category"], amount: number, cadence: CostItem["cadence"], extra: Partial<CostItem> = {}): CostItem => ({
  ...base,
  id,
  name,
  category,
  amount,
  cadence,
  is_estimate: false,
  start_date: day(-400),
  end_date: null,
  discount_end_date: null,
  provider: null,
  assigned_to: null,
  linked_section: null,
  notes: null,
  sort_order: 0,
  created_by: AVA,
  ...extra,
});

export const costItems: CostItem[] = [
  cost("c-rent", "Rent", "rent", 184000, "monthly", { start_date: day(-400) }),
  cost("c-power", "Power", "utilities", 11800, "monthly", { provider: "Origin" }),
  cost("c-internet", "Internet", "internet", 7900, "monthly", { provider: "Aussie Broadband" }),
  cost("c-insurance", "Home insurance", "insurance", 4200, "monthly", { provider: "NRMA", end_date: day(14) }),
  cost("c-gym", "Gym membership", "subscription", 5900, "monthly", { provider: "Fitness First", end_date: day(21) }),
  cost("c-netflix", "Netflix", "subscription", 2299, "monthly"),
  cost("c-jazz", "Jazz at the Lighthouse", "outing", 5600, "one_off", { start_date: day(SATURDAY), linked_section: "calendar" }),
  cost("c-grocery-est", "Groceries", "grocery_estimate", 64000, "monthly", { is_estimate: true }),
  // Shopping trips land here at the real spend, one line each.
  ...[-3, -10, -17, -24, -31, -38].map((d, i) =>
    cost(`c-trip-${i}`, "Groceries", "grocery_estimate", [6420, 11850, 7210, 9930, 8480, 10200][i], "one_off", {
      start_date: day(d),
      provider: ["FreshCo", "Woolworths", "FreshCo", "Aldi", "FreshCo", "Woolworths"][i],
      linked_section: "groceries",
      notes: "Grocery trip",
    })
  ),
];

// ── Tasks ────────────────────────────────────────────────────────────────────
export const task = (id: string, title: string, extra: Partial<HouseholdTask> = {}): HouseholdTask => ({
  ...base,
  id,
  title,
  due_date: day(0),
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

export const tasks: HouseholdTask[] = [
  task("t-bins", "Bins out", { due_time: "19:00", assigned_to: AVA, recurrence_days: 7 }),
  task("t-plants", "Water the plants", { due_date: day(1), assigned_to: NOA, recurrence_days: 3 }),
  task("t-insurance", "Home insurance contract ends", { due_date: day(0), template_key: "cost-reminder:c-insurance:contract", notes: "Compare quotes before it renews." }),
  task("t-lease", "Renew the lease or give notice", { due_date: day(21), template_key: `lease-reminder:${GROUP}:notice`, notes: `The lease ends on ${day(63)}; 42 days' notice.` }),
  task("t-warranty", "Renew Dishwasher warranty", { due_date: day(4), template_key: "doc-reminder:d-warranty:expiry", notes: "Check the dishwasher before the warranty ends." }),
  task("t-gym", "Gym membership contract ends", { due_date: day(7), template_key: "cost-reminder:c-gym:contract" }),
  task("t-hosting", "Hosting Saturday", { due_date: day(SATURDAY), assigned_to: NOA, linked_checklist_id: "cl-hosting" }),
  task("t-plumber", "Book the plumber", { due_date: day(3), assigned_to: AVA, priority: "high", notes: "Kitchen tap drips." }),
  task("t-sheets", "Change the bed sheets", { due_date: day(SATURDAY + 1), assigned_to: NOA, recurrence_days: 14 }),
  task("t-library", "Return the library books", { due_date: day(SATURDAY + 2), assigned_to: MIA }),
  task("t-gutters", "Clean the gutters", { due_date: day(SATURDAY + 6), priority: "low", notes: "Before the storms." }),
  task("t-vacuum", "Vacuum the lounge", { due_date: day(-1), assigned_to: MIA, done: true, completed_at: at(-1, "17:20"), recurrence_days: 7 }),
  task("t-water", "Pay the water bill", { due_date: day(-2), assigned_to: AVA, done: true, completed_at: at(-2, "08:45") }),
  task("t-sensor", "Replace hallway sensor battery", { due_date: day(SATURDAY), assigned_to: AVA, notes: "Added by your assistant: the sensor reported 8%." }),
];

// ── Checklists ───────────────────────────────────────────────────────────────
export const checklists: Checklist[] = [
  {
    ...base,
    id: "cl-hosting",
    title: "Hosting Saturday",
    type: "shopping",
    template_key: null,
    source_checklist_id: null,
    completed_at: null,
    scheduled_date: day(SATURDAY),
    linked_task_id: "t-hosting",
    log_costs: true,
    repeat_cadence_days: null,
    repeat_renewal_mode: null,
    created_by: NOA,
  },
  {
    ...base,
    id: "cl-reset",
    title: "Weekly reset",
    type: "repeating",
    template_key: null,
    source_checklist_id: null,
    completed_at: null,
    scheduled_date: null,
    linked_task_id: null,
    log_costs: false,
    repeat_cadence_days: 7,
    repeat_renewal_mode: "reset",
    created_by: AVA,
  },
  {
    ...base,
    id: "cl-beach",
    title: "Beach bag",
    type: "plain",
    template_key: null,
    source_checklist_id: null,
    completed_at: null,
    scheduled_date: null,
    linked_task_id: null,
    log_costs: false,
    repeat_cadence_days: null,
    repeat_renewal_mode: null,
    created_by: MIA,
  },
];

const clItem = (id: string, checklist_id: string, label: string, order: number, extra: Partial<ChecklistTaskItem> = {}): ChecklistTaskItem => ({
  ...base,
  id,
  checklist_id,
  label,
  is_done: false,
  checked_by: null,
  checked_at: null,
  cost_cents: null,
  linked_cost_item_id: null,
  order,
  ...extra,
});

export const checklistItems: ChecklistTaskItem[] = [
  ...["Wine", "Ice", "Lemons", "Olives", "Flowers", "Charcoal", "Napkins", "Bread", "Cheese"].map((label, i) =>
    clItem(`cli-h-${i}`, "cl-hosting", label, i, {
      cost_cents: [2800, 500, 400, 650, 1800, 1200, 300, 700, 1400][i],
      is_done: i < 3,
      checked_by: i < 3 ? NOA : null,
      checked_at: i < 3 ? at(0, "10:00") : null,
    })
  ),
  ...["Strip the beds", "Vacuum", "Bathroom", "Fridge clear-out", "Bins", "Plants"].map((label, i) => clItem(`cli-r-${i}`, "cl-reset", label, i, { is_done: i < 4, checked_by: i < 4 ? AVA : null })),
  ...["Towels", "Sunscreen", "Snacks", "Water", "Hats", "Bucket", "Book"].map((label, i) => clItem(`cli-b-${i}`, "cl-beach", label, i)),
];

// ── Groceries ────────────────────────────────────────────────────────────────
export const grocery = (id: string, name: string, aisle: string, extra: Partial<GroceryItem> = {}): GroceryItem => ({
  ...base,
  id,
  name,
  aisle,
  quantity: 1,
  unit: null,
  status: "needed",
  notes: null,
  assigned_to: null,
  private: false,
  template_key: null,
  sort_order: 0,
  created_by: AVA,
  updated_by: AVA,
  recurrence_days: null,
  status_changed_at: at(-1, "18:00"),
  last_purchased_at: null,
  last_price: null,
  lowest_price: null,
  expiry_date: null,
  shelf_life_days: null,
  price_cents: null,
  is_essential: false,
  recipe_note: null,
  recipe_source_id: null,
  re_add_snoozed_until: null,
  re_add_dismissed_at: null,
  ...extra,
});

export const groceries: GroceryItem[] = [
  grocery("g-milk", "Milk", "dairy_eggs", { quantity: 2, unit: "L", price_cents: 360, is_essential: true, shelf_life_days: 7 }),
  grocery("g-ricotta", "Ricotta", "dairy_eggs", { quantity: 250, unit: "g", price_cents: 480, recipe_note: "250 g for Lasagne", recipe_source_id: "r-lasagne" }),
  grocery("g-sheets", "Lasagne sheets", "pantry", { price_cents: 320, recipe_note: "12 for Lasagne", recipe_source_id: "r-lasagne" }),
  grocery("g-lemons", "Lemons", "produce", { quantity: 4, price_cents: 300 }),
  grocery("g-spinach", "Spinach", "produce", { price_cents: 350 }),
  grocery("g-bread", "Sourdough", "bakery", { price_cents: 750, is_essential: true }),
  grocery("g-oatmilk", "Oat milk", "drinks", { price_cents: 420 }),
  grocery("g-binbags", "Bin bags", "household", { price_cents: 650 }),
  // Named to sort after the story's rows (essentials first, then A to Z), so those stay in view.
  grocery("g-oats", "Rolled oats", "pantry", { unit: "kg", price_cents: 450, last_price: 450, lowest_price: 380 }),
  grocery("g-salmon", "Salmon fillets", "meat_seafood", { quantity: 2, price_cents: 1600, created_by: NOA }),
  grocery("g-strawberries", "Strawberries", "produce", { price_cents: 500, assigned_to: MIA, notes: "For school lunches", created_by: MIA }),
  grocery("g-toothpaste", "Toothpaste", "household", { price_cents: 400, created_by: NOA }),
  grocery("g-washing", "Washing powder", "household", { price_cents: 1400 }),
  // In the house, and past its shelf life: Groceries suggests buying it again.
  grocery("g-yoghurt", "Greek yoghurt", "dairy_eggs", { status: "have", shelf_life_days: 7, last_purchased_at: at(-10, "11:00"), status_changed_at: at(-10, "11:00"), price_cents: 590, last_price: 590 }),
  grocery("g-berries", "Blueberries", "produce", { status: "have", shelf_life_days: 5, last_purchased_at: at(-8, "11:00"), status_changed_at: at(-8, "11:00"), price_cents: 650, last_price: 650 }),
  // In the house, fine.
  grocery("g-mince", "Beef mince", "meat_seafood", { status: "have", quantity: 500, unit: "g", shelf_life_days: 3, last_purchased_at: at(-1, "11:00"), status_changed_at: at(-1, "11:00"), price_cents: 900 }),
  grocery("g-passata", "Passata", "pantry", { status: "have", last_purchased_at: at(-3, "11:00"), status_changed_at: at(-3, "11:00"), price_cents: 280 }),
  grocery("g-onion", "Onions", "produce", { status: "have", last_purchased_at: at(-3, "11:00"), status_changed_at: at(-3, "11:00"), price_cents: 200 }),
  grocery("g-parmesan", "Parmesan", "dairy_eggs", { status: "have", last_purchased_at: at(-6, "11:00"), status_changed_at: at(-6, "11:00"), price_cents: 820 }),
  grocery("g-eggs", "Eggs", "dairy_eggs", { status: "have", last_purchased_at: at(-2, "11:00"), status_changed_at: at(-2, "11:00"), price_cents: 700 }),
  grocery("g-potatoes", "Potatoes", "produce", { status: "have", quantity: 2, unit: "kg", last_purchased_at: at(-3, "11:00"), status_changed_at: at(-3, "11:00"), price_cents: 500 }),
  grocery("g-steak", "Scotch fillet", "meat_seafood", { status: "have", quantity: 2, last_purchased_at: at(-1, "11:00"), status_changed_at: at(-1, "11:00"), price_cents: 2400 }),
  grocery("g-rice", "Jasmine rice", "pantry", { status: "have", unit: "kg", last_purchased_at: at(-12, "11:00"), status_changed_at: at(-12, "11:00"), price_cents: 450 }),
  grocery("g-butter", "Butter", "dairy_eggs", { status: "have", last_purchased_at: at(-4, "11:00"), status_changed_at: at(-4, "11:00"), price_cents: 650 }),
  grocery("g-cereal", "Weet-Bix", "pantry", { status: "have", last_purchased_at: at(-9, "11:00"), status_changed_at: at(-9, "11:00"), price_cents: 520 }),
];

/** The same list mid-shop: most of it in the trolley today. */
export function groceriesMidShop(): GroceryItem[] {
  const got = new Set(["g-milk", "g-ricotta", "g-sheets", "g-lemons", "g-spinach", "g-bread"]);
  // Early afternoon: the same date in UTC, which the day comparison uses.
  return groceries.map((g) => (got.has(g.id) ? { ...g, status: "bought", last_purchased_at: at(0, "14:00"), status_changed_at: at(0, "14:00"), last_price: g.price_cents } : g));
}

/** Today's shopping trip, tracked, before Done shopping. */
export function todaysSession() {
  return {
    id: "gs-today",
    group_id: GROUP,
    session_date: day(0),
    summed_total_cents: 2560,
    override_total_cents: null,
    receipt_total_cents: null,
    retailer: null,
    receipt_path: null,
    receipt_name: null,
    tracking: "on",
    cost_item_id: "c-trip-today",
    closed_at: null,
    created_by: AVA,
    created_at: at(0, "14:00"),
    updated_at: at(0, "14:00"),
  };
}

export const loyaltyCards: LoyaltyCard[] = [
  { ...base, id: "lc-flybuys", created_by: AVA, name: "Flybuys", number: "6014355001234568", format: "code128", scheme_id: "rs-flybuys", private: false, expires_on: null, notes: null },
  { ...base, id: "lc-rewards", created_by: NOA, name: "Everyday Rewards", number: "9355000012345", format: "ean13", scheme_id: "rs-everyday", private: false, expires_on: null, notes: null },
  { ...base, id: "lc-ikea", created_by: MIA, name: "IKEA Family", number: "6275980123456789", format: "code128", scheme_id: "rs-ikea", private: false, expires_on: null, notes: null },
  { ...base, id: "lc-costco", created_by: AVA, name: "Costco", number: "111234567890", format: "code128", scheme_id: "rs-costco", private: true, expires_on: day(24), notes: "Renew at the membership desk" },
];

// ── Rewards ──────────────────────────────────────────────────────────────────
// Each scheme with its partner stores (core's AU starter list) and perks. The
// brand keys are core's brandKey(name), written out: core's runtime is not
// loaded yet when the stores read these fixtures.
const scheme = (id: string, name: string, kind: RewardScheme["kind"], color: string, catalog: string | null): RewardScheme => ({
  ...base,
  id,
  name,
  kind,
  website: null,
  partners_url: null,
  color,
  catalog_id: catalog,
  notes: null,
  created_by: AVA,
});

export const rewardSchemes: RewardScheme[] = [
  scheme("rs-flybuys", "Flybuys", "loyalty", "#1F4FA8", "au-flybuys"),
  scheme("rs-everyday", "Everyday Rewards", "loyalty", "#E0602A", "au-everyday-rewards"),
  scheme("rs-ikea", "IKEA Family", "loyalty", "#18284A", "au-ikea-family"),
  scheme("rs-costco", "Costco", "membership", "#C8202F", "au-costco"),
];

const partner = (schemeId: string, name: string, category: string): RewardPartner => ({
  ...base,
  id: `rp-${schemeId.slice(3)}-${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
  scheme_id: schemeId,
  name,
  brand_key: name.toLowerCase().replace(/&/g, "and").replace(/^the\s+/, "").replace(/[^a-z0-9]/g, ""),
  category,
  online_only: false,
  created_by: AVA,
});

export const rewardPartners: RewardPartner[] = [
  ...[["Coles", "Groceries"], ["Kmart", "Shopping"], ["Target", "Shopping"], ["Officeworks", "Shopping"], ["Liquorland", "Liquor"], ["First Choice Liquor Market", "Liquor"]].map(([n, c]) => partner("rs-flybuys", n, c)),
  ...[["Woolworths", "Groceries"], ["BIG W", "Shopping"], ["BWS", "Liquor"], ["Ampol", "Fuel"]].map(([n, c]) => partner("rs-everyday", n, c)),
  partner("rs-ikea", "IKEA", "Home"),
  partner("rs-costco", "Costco", "Groceries"),
];

const perk = (id: string, schemeId: string, title: string, kind: RewardPerk["kind"], value: number | null, extra: Partial<RewardPerk> = {}): RewardPerk => ({
  ...base,
  id,
  scheme_id: schemeId,
  partner_id: null,
  title,
  kind,
  value,
  conditions: null,
  valid_until: null,
  created_by: AVA,
  ...extra,
});

export const rewardPerks: RewardPerk[] = [
  perk("pk-ow-print", "rs-flybuys", "10% off print and copy", "percent", 10, { partner_id: "rp-flybuys-officeworks", valid_until: day(5) }),
  perk("pk-fb-points", "rs-flybuys", "1 point per $1 spent", "other", null),
  perk("pk-kmart", "rs-flybuys", "4x points on homewares", "points", 4, { partner_id: "rp-flybuys-kmart", valid_until: day(12), conditions: "Activate the offer in the app first" }),
  perk("pk-bws", "rs-everyday", "$10 off a $50 spend", "amount", 10, { partner_id: "rp-everyday-bws", valid_until: day(9) }),
  perk("pk-ampol", "rs-everyday", "4c off a litre", "other", null, { partner_id: "rp-everyday-ampol" }),
  perk("pk-ew-points", "rs-everyday", "1 point per $1 spent", "other", null),
  perk("pk-ikea-coffee", "rs-ikea", "Free tea or coffee", "freebie", null, { conditions: "In the IKEA restaurant" }),
  perk("pk-ikea-sofa", "rs-ikea", "15% off sofas", "percent", 15, { valid_until: day(20) }),
  perk("pk-costco", "rs-costco", "Member prices on fuel", "other", null),
];

// ── Recipes ──────────────────────────────────────────────────────────────────
export const recipes: Recipe[] = [
  {
    ...base,
    id: "r-lasagne",
    title: "Lasagne",
    cuisines: ["Italian"],
    method: "baking",
    instructions: [
      "Brown the mince with the onion, then add the passata and simmer for 20 minutes.",
      "Mix the ricotta with half the parmesan and a pinch of nutmeg.",
      "Layer sauce, sheets and ricotta in a dish, three times over.",
      "Top with the rest of the parmesan and bake at 180° for 40 minutes.",
      "Rest for 10 minutes before cutting.",
    ].join("\n"),
    servings: 6,
    prep_minutes: 20,
    cook_minutes: 60,
    source: "Nonna's book, p. 42",
    source_type: "photo",
    draft: false,
    created_by: AVA,
  },
  { ...base, id: "r-curry", title: "Green curry", cuisines: ["Thai"], method: "cooking", instructions: null, servings: 4, prep_minutes: 15, cook_minutes: 25, source: null, source_type: "manual", draft: false, created_by: NOA },
  { ...base, id: "r-banana", title: "Banana bread", cuisines: [], method: "baking", instructions: null, servings: 8, prep_minutes: 15, cook_minutes: 55, source: "photo", source_type: "photo", draft: false, created_by: MIA },
  { ...base, id: "r-steak", title: "Steak and potatoes", cuisines: [], method: "cooking", instructions: null, servings: 2, prep_minutes: 10, cook_minutes: 30, source: null, source_type: "manual", draft: false, created_by: AVA },
];

const ing = (recipe_id: string, i: number, name: string, item_name: string, quantity: number | null, unit: string | null): RecipeIngredient => ({
  ...base,
  id: `ri-${recipe_id}-${i}`,
  recipe_id,
  name,
  item_name,
  quantity,
  unit,
  position: i,
});

export const recipeIngredients: RecipeIngredient[] = [
  ing("r-lasagne", 0, "500 g beef mince", "Beef mince", 500, "g"),
  ing("r-lasagne", 1, "1 onion, diced", "Onions", 1, null),
  ing("r-lasagne", 2, "700 g passata", "Passata", 700, "g"),
  ing("r-lasagne", 3, "250 g ricotta", "Ricotta", 250, "g"),
  ing("r-lasagne", 4, "12 lasagne sheets", "Lasagne sheets", 12, null),
  ing("r-lasagne", 5, "100 g parmesan, grated", "Parmesan", 100, "g"),
  ing("r-lasagne", 6, "2 eggs", "Eggs", 2, null),
  ing("r-steak", 0, "2 scotch fillet steaks", "Scotch fillet", 2, null),
  ing("r-steak", 1, "600 g potatoes", "Potatoes", 600, "g"),
  ing("r-curry", 0, "400 g chicken thigh", "Chicken thigh", 400, "g"),
  ing("r-curry", 1, "1 tin coconut milk", "Coconut milk", 1, null),
  ing("r-banana", 0, "3 ripe bananas", "Bananas", 3, null),
  ing("r-banana", 1, "2 eggs", "Eggs", 2, null),
];

// ── Calendar ─────────────────────────────────────────────────────────────────
const event = (id: string, title: string, starts: string, ends: string, extra: Partial<GroupEvent> = {}): GroupEvent => ({
  ...base,
  id,
  created_by: AVA,
  title,
  category: "general",
  starts_at: starts,
  ends_at: ends,
  is_all_day: false,
  location: null,
  notes: null,
  private: false,
  reminder_days: [],
  cost_item_id: null,
  travel_mode: null,
  travel_minutes: null,
  leave_notified_for: null,
  ...extra,
});

export const events: GroupEvent[] = [
  event("e-swim", "Mia's swimming lesson", at(SATURDAY + 2, "16:30"), at(SATURDAY + 2, "17:15"), { created_by: NOA, location: "Aquatic Centre" }),
  event("e-dinner", "Dinner at Sam and Priya's", at(SATURDAY + 1, "18:30"), at(SATURDAY + 1, "21:30"), { category: "social", created_by: NOA }),
  {
    ...base,
    id: "e-jazz",
    created_by: NOA,
    title: "Jazz at the Lighthouse",
    category: "social",
    starts_at: at(SATURDAY, "19:00"),
    ends_at: at(SATURDAY, "22:00"),
    is_all_day: false,
    location: "Lighthouse Bar, 12 Harbour Rd",
    notes: "Tickets from the link Noa shared.",
    private: false,
    reminder_days: [1],
    cost_item_id: "c-jazz",
    travel_mode: "drive",
    travel_minutes: 28,
    leave_notified_for: null,
  },
  {
    ...base,
    id: "e-plumber",
    created_by: AVA,
    title: "Plumber visit",
    category: "household",
    starts_at: at(3, "09:00"),
    ends_at: at(3, "10:00"),
    is_all_day: false,
    location: null,
    notes: "Kitchen tap",
    private: false,
    reminder_days: [1],
    cost_item_id: null,
    travel_mode: null,
    travel_minutes: null,
    leave_notified_for: null,
  },
];

/** Google Calendar rows the app pulls in, as GET /api/calendar/events returns them. */
export const googleEvents = [
  {
    id: "gc-mia",
    user_id: AVA,
    gcal_event_id: "gcal-1",
    gcal_calendar_id: "primary",
    title: "Mia's birthday",
    description: null,
    location: null,
    starts_at: at(SATURDAY + 1, "00:00"),
    ends_at: at(SATURDAY + 2, "00:00"),
    is_all_day: true,
    html_link: null,
    visibility: "group",
    matched_apartment_id: null,
    state: "synced",
    imported_appointment_id: null,
    imported_task_id: null,
    created_at: STAMP,
    updated_at: STAMP,
  },
  {
    id: "gc-dentist",
    user_id: AVA,
    gcal_event_id: "gcal-2",
    gcal_calendar_id: "primary",
    title: "Dentist",
    description: null,
    location: "Smile Dental, Carlton",
    starts_at: at(2, "14:30"),
    ends_at: at(2, "15:15"),
    is_all_day: false,
    html_link: null,
    visibility: "private",
    matched_apartment_id: null,
    state: "synced",
    imported_appointment_id: null,
    imported_task_id: null,
    created_at: STAMP,
    updated_at: STAMP,
  },
];

// ── Documents ────────────────────────────────────────────────────────────────
const doc = (id: string, title: string, doc_type: Document["doc_type"], extra: Partial<Document> = {}): Document => ({
  ...base,
  id,
  storage_path: `${GROUP}/${id}.pdf`,
  filename: `${title}.pdf`,
  mime_type: "application/pdf",
  size_bytes: 240_000,
  doc_type,
  title,
  parsed: null,
  source: "capture",
  expiry_date: null,
  tags: [],
  metadata: {},
  uploaded_by: AVA,
  folder_id: null,
  ...extra,
});

export const documents: Document[] = [
  doc("d-warranty", "Dishwasher warranty", "warranty", { expiry_date: day(21), tags: ["kitchen"], metadata: { manufacturer: "Bosch", model: "SMS4HVI33E", purchase_date: day(-709) }, source: "warranty" }),
  doc("d-gym", "Gym membership contract", "contract", { expiry_date: day(21), tags: ["fitness"], uploaded_by: NOA }),
  doc("d-lease", "Lease agreement", "lease_contract", { expiry_date: day(63), tags: ["house"], metadata: { counterparty: "Ray White Brunswick", property: "14 Wattle St", start_date: day(-302) } }),
  doc("d-insurance", "Home insurance policy", "insurance", { expiry_date: day(14), metadata: { provider: "NRMA", policy_no: "HP-4471-220" } }),
  doc("d-receipt", "FreshCo receipt", "receipt", { source: "grocery", mime_type: "image/jpeg", filename: "receipt.jpg", created_at: at(-3, "11:20"), updated_at: at(-3, "11:20") }),
  doc("d-manual", "Dishwasher manual", "appliance_manual", { tags: ["kitchen"] }),
];

export const documentLinks: DocumentLink[] = [
  { id: "dl-1", document_id: "d-gym", group_id: GROUP, entity_type: "cost_item", entity_id: "c-gym", link_role: "contract", created_at: STAMP },
  { id: "dl-2", document_id: "d-insurance", group_id: GROUP, entity_type: "cost_item", entity_id: "c-insurance", link_role: "policy", created_at: STAMP },
  { id: "dl-3", document_id: "d-receipt", group_id: GROUP, entity_type: "cost_item", entity_id: "c-trip-0", link_role: "receipt", created_at: STAMP },
];

// ── Shopper ──────────────────────────────────────────────────────────────────
const want = (id: string, title: string, extra: Partial<ShopperWant> = {}): ShopperWant => ({
  ...base,
  id,
  title,
  query: title,
  target_cents: null,
  budget_cents: null,
  status: "watching",
  need_by: null,
  notes: null,
  best_cents: null,
  best_store: null,
  last_checked_at: at(0, "13:10"),
  bought_at: null,
  created_by: AVA,
  ...extra,
});

export const shopperWants: ShopperWant[] = [
  want("w-vacuum", "Roborock Q7 robot vacuum", { need_by: day(SATURDAY), target_cents: 50000, best_cents: 44900, best_store: "JB Hi-Fi" }),
  want("w-airfryer", "Ninja dual air fryer", { best_cents: 25900, best_store: "Big W", created_by: NOA }),
  want("w-bike", "Kids' bike, 20 inch", { target_cents: 28000, best_cents: 32900, best_store: "Rebel", created_by: NOA }),
  want("w-desk", "Standing desk", { best_cents: 64900, best_store: "Officeworks" }),
  want("w-pizza", "Pizza oven", { status: "idea", last_checked_at: null }),
  want("w-rug", "Hallway runner", { status: "idea", last_checked_at: null, created_by: MIA }),
  want("w-tv", "Samsung 65\" QN85D Neo QLED", { best_cents: 189900, best_store: "The Good Guys", notes: "From Scout: best picture" }),
  want("w-kettle", "Kettle", { status: "bought", best_cents: 8900, best_store: "Kmart", bought_at: at(-12, "10:00") }),
];

/** One daily low per want over 90 days: a wobble around the usual price, then today's. */
function history(wantId: string, usual: number, today: number, swing: number, recent: [days: number, cents: number][] = []): ShopperPriceSnapshot[] {
  return Array.from({ length: 90 }, (_, i) => {
    const ago = 89 - i;
    const near = recent.find(([d]) => ago <= d);
    const wobble = Math.round((Math.sin(i * 0.7) + Math.sin(i * 0.23)) * swing) * 100;
    const cents = ago === 0 ? today : near ? near[1] : usual + wobble;
    return {
      ...base,
      id: `s-${wantId}-${ago}`,
      want_id: wantId,
      source_id: "serpapi-google-shopping",
      store: "Google Shopping",
      price_cents: cents,
      currency: "AUD",
      captured_on: day(-ago),
    };
  });
}

export const shopperSnapshots: ShopperPriceSnapshot[] = [
  ...history("w-vacuum", 64900, 44900, 12, [[1, 47900]]),
  ...history("w-airfryer", 27900, 25900, 4),
  ...history("w-bike", 32900, 32900, 6),
  ...history("w-desk", 59900, 64900, 8, [[6, 64900]]),
];

const offer = (id: string, wantId: string, store: string, cents: number, extra: Partial<ShopperOffer> = {}): ShopperOffer => ({
  ...base,
  id,
  want_id: wantId,
  source_id: "serpapi-google-shopping",
  store,
  title: store,
  url: null,
  price_cents: cents,
  currency: "AUD",
  in_stock: true,
  distance_m: null,
  checked_at: at(0, "13:10"),
  ...extra,
});

export const shopperOffers: ShopperOffer[] = [
  offer("o-vac-jb", "w-vacuum", "JB Hi-Fi", 44900, { distance_m: 2400 }),
  offer("o-vac-gg", "w-vacuum", "The Good Guys", 47900, { distance_m: 5100 }),
  offer("o-vac-amz", "w-vacuum", "Amazon AU", 49900, { in_stock: null }),
  offer("o-vac-hn", "w-vacuum", "Harvey Norman", 54900, { distance_m: 3800, in_stock: false }),
  offer("o-vac-manual", "w-vacuum", "Bing Lee", 52900, { source_id: "manual", in_stock: null }),
];

/** The sources a self-hosted AU server ships with, as /api/shopper/sources lists them. */
export const shopperSources = [
  { id: "serpapi-google-shopping", name: "Google Shopping", capabilities: ["offers"], attribution: "Google Shopping via SerpApi", homepage: "https://serpapi.com", enabled: true },
  { id: "osm-stores", name: "OpenStreetMap", capabilities: ["stores"], attribution: "Store locations © OpenStreetMap contributors", homepage: "https://www.openstreetmap.org", enabled: true },
  { id: "ozbargain", name: "OzBargain", capabilities: ["deals"], attribution: "Deals from OzBargain", homepage: "https://www.ozbargain.com.au", enabled: true },
];

export const shopperDeals = [
  { title: "Roborock Q7 Max robot vacuum $449 at JB Hi-Fi", url: "https://www.ozbargain.com.au/", posted_at: at(-1, "08:40"), source: "OzBargain" },
];

/** One finished Scout run: a brief for a lounge TV, three picks, one already on the watchlist. */
export const scoutSearch: ShopperSearch = {
  id: "scout-tv",
  group_id: GROUP,
  brief: {
    text: "A TV for the lounge, about 65 inches, for films and the kids' games. The room gets afternoon sun.",
    budget_min_cents: null,
    budget_max_cents: 200000,
    need_by: null,
    where: ["nearby", "online"],
  },
  status: "done",
  error: null,
  stores_checked: 14,
  key_source: "household",
  created_by: AVA,
  created_at: at(-1, "20:10"),
  updated_at: at(-1, "20:11"),
  finished_at: at(-1, "20:11"),
  deleted: false,
};

const pick = (rank: number, label: string, title: string, why: string, cents: number, store: string, extra: Partial<ShopperPick> = {}): ShopperPick => ({
  id: `pick-tv-${rank}`,
  group_id: GROUP,
  search_id: scoutSearch.id,
  rank,
  label,
  title,
  why,
  price_cents: cents,
  currency: "AUD",
  store,
  url: "https://example.com/",
  in_stock: true,
  stretch: false,
  sources: [{ title: `${store} product page`, url: "https://example.com/" }],
  want_id: null,
  created_at: scoutSearch.created_at,
  updated_at: scoutSearch.created_at,
  deleted: false,
  ...extra,
});

export const scoutPicks: ShopperPick[] = [
  pick(1, "Best value", "Hisense 65\" U7 Mini-LED", "Bright enough for a sunny room, and 144 Hz for the games console. In stock 2.4 km away.", 149500, "JB Hi-Fi", {
    sources: [
      { title: "JB Hi-Fi product page", url: "https://example.com/" },
      { title: "RTINGS review", url: "https://example.com/" },
    ],
  }),
  pick(2, "Best picture", "Samsung 65\" QN85D Neo QLED", "An anti-glare screen for the afternoon sun, and good motion for sport.", 189900, "The Good Guys", { want_id: "w-tv" }),
  pick(3, "Top picture", "LG 65\" C4 OLED", "The best picture of the three. It is $200 over the budget and dimmer in a sunny room.", 219900, "Amazon AU", { stretch: true, in_stock: null }),
];

// ── Assistant ────────────────────────────────────────────────────────────────
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const minutesFromNow = (m: number) => new Date(now.getTime() + m * 60_000).toISOString();

const conv = (id: string, kind: AssistantConversation["kind"], title: string | null, activeMinutesAgo: number, extra: Partial<AssistantConversation> = {}): AssistantConversation => ({
  id,
  kind,
  title,
  pinned: false,
  last_active_at: minutesAgo(activeMinutesAgo),
  closes_at: null,
  pending: 0,
  ...extra,
});

export const assistantConversations: AssistantConversation[] = [
  conv("conv-household", "household", null, 6, { pending: 1 }),
  conv("conv-house", "chat", "The house tonight", 35),
  conv("conv-hosting", "chat", "Hosting Saturday", 120, { pinned: true }),
  conv("conv-holiday", "chat", "Holiday in March", 3 * 24 * 60),
  conv("conv-spend", "chat", "Grocery spend this month", 2 * 24 * 60),
  // Quick asks still open, so each one shows its answer and takes a follow-up.
  conv("conv-dinner", "quick", "Dinner tonight", 8, { closes_at: minutesFromNow(22) }),
  conv("conv-dentist", "quick", "When is the dentist?", 12, { closes_at: minutesFromNow(18) }),
];

// The summaries are core's describeProposal lines, written out: core's
// runtime is not loaded yet when the stores read these fixtures.
const proposal = (state: "pending" | "confirmed", items: [tool: string, module: AssistantScope, args: Record<string, unknown>, summary: string][]) => ({
  state,
  items: items.map(([tool, module, args, summary]) => ({ tool, module, args, summary })),
});

const msg = (id: string, role: AssistantMessage["role"], minutes: number, content: string, extra: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id,
  role,
  content,
  author: null,
  channel: "app",
  created_at: minutesAgo(minutes),
  proposal: null,
  cost_micros: null,
  ...extra,
});

/** The household thread: Noa on Telegram, Ava in the app, one answer each. */
export const householdThread: AssistantMessage[] = [
  msg("m-1", "user", 52, "We are out of milk and eggs. Are the bins tonight?", { author: "Noa", channel: "telegram" }),
  msg("m-2", "assistant", 51, "Yes. **Bins out** is due at 7 PM tonight and it is assigned to you. Shall I add milk and eggs to the list?", {
    channel: "telegram",
    proposal: proposal("confirmed", [
      ["create_grocery_item", "groceries", { name: "Milk" }, 'Add "Milk" to Groceries'],
      ["create_grocery_item", "groceries", { name: "Eggs" }, 'Add "Eggs" to Groceries'],
    ]),
  }),
  msg("m-3", "user", 7, "Book the plumber for Thursday at 9 and put the call-out fee in the budget.", { author: "Ava" }),
  msg("m-4", "assistant", 6, "The call-out fee from the quote is **$120**. These two changes wait for your OK:", {
    proposal: proposal("pending", [
      ["create_event", "calendar", { title: "Plumber" }, 'Add "Plumber" to Calendar'],
      ["create_cost_item", "costs", { name: "Plumber call-out" }, 'Add "Plumber call-out" to Budget'],
    ]),
  }),
];

/** A named chat with Home Assistant connected: one look-up, then lights and heating, done under Act. */
const houseChat: AssistantMessage[] = [
  msg("h-1", "user", 42, "Is everything locked? We are out until 10.", { author: "Ava" }),
  msg("h-2", "assistant", 41, "The front door and the back door are **locked**. The garage door is **open**, and the hallway motion sensor battery is at 9%. Shall I close the garage and add AA batteries to the list?", {
    proposal: proposal("confirmed", [
      ["ha_HassTurnOff", "home-assistant", { name: "Garage door" }, 'Turn off "Garage door" in Home Assistant'],
      ["create_grocery_item", "groceries", { name: "AA batteries" }, 'Add "AA batteries" to Groceries'],
    ]),
  }),
  msg("h-3", "user", 38, "Thanks. Turn on the porch light, and warm the lounge to 21 for when we get back.", { author: "Ava" }),
  msg("h-4", "assistant", 37, "Done. The porch light is on, and the lounge thermostat is set to **21°C**. It reads 18.5°C now.", {
    proposal: proposal("confirmed", [
      ["ha_HassTurnOn", "home-assistant", { name: "Porch light" }, 'Turn on "Porch light" in Home Assistant'],
      ["ha_HassClimateSetTemperature", "home-assistant", { name: "Lounge", temperature: 21 }, 'Climate set temperature "Lounge" in Home Assistant'],
    ]),
  }),
];

/** A named chat that planned Saturday: the lasagne's missing ingredients on the list, wine on the checklist. */
const hostingChat: AssistantMessage[] = [
  msg("s-1", "user", 130, "Six people on Saturday at 7. We are making the lasagne. What do we still need?", { author: "Ava" }),
  msg("s-2", "assistant", 129, "The lasagne needs **ricotta** and **lasagne sheets**. The rest is in the house. The Hosting Saturday checklist has no wine yet. Shall I add both?", {
    proposal: proposal("confirmed", [
      ["add_recipe_to_groceries", "recipes", { recipe: "Lasagne" }, "Add a recipe's ingredients to Groceries"],
      ["add_checklist_item", "checklists", { label: "Wine" }, 'Add "Wine" to a checklist'],
    ]),
  }),
  msg("s-3", "user", 121, "Yes. And remind Noa to pick up the chairs on Friday.", { author: "Ava" }),
  msg("s-4", "assistant", 120, "Done. Ricotta and lasagne sheets are on the list, and **Pick up the chairs** is in Tasks for Noa, due Friday.", {
    proposal: proposal("confirmed", [["create_task", "household", { title: "Pick up the chairs" }, 'Add "Pick up the chairs" to Tasks']]),
  }),
];

/** A quick ask, read only. */
const dinnerChat: AssistantMessage[] = [
  msg("d-1", "user", 9, "What can we cook tonight with what we have?", { author: "Ava" }),
  msg("d-2", "assistant", 8, "You can make **Steak and potatoes** now. Every ingredient is in the house. **Green curry** needs only coconut milk."),
];

/** A named chat from earlier in the week: flights in the budget, the dates on the calendar. */
const holidayChat: AssistantMessage[] = [
  msg("v-1", "user", 3 * 24 * 60 + 6, "We booked Bali for 14 to 21 March. Flights were $1,840. Put them in the budget and block the dates.", { author: "Ava" }),
  msg("v-2", "assistant", 3 * 24 * 60 + 5, "Done. **Bali flights** is a one-off cost of $1,840 in Travel, and **Bali** is on the calendar from 14 to 21 March. Nothing else is booked that week.", {
    proposal: proposal("confirmed", [
      ["create_cost_item", "costs", { name: "Bali flights" }, 'Add "Bali flights" to Budget'],
      ["create_event", "calendar", { title: "Bali" }, 'Add "Bali" to Calendar'],
    ]),
  }),
  msg("v-3", "user", 3 * 24 * 60 + 2, "Who feeds the plants while we are away?", { author: "Ava" }),
  msg("v-4", "assistant", 3 * 24 * 60 + 1, "**Water the plants** repeats every 3 days and is assigned to Noa. Noa is on the trip too. Shall I ask in the Household chat?"),
];

/** A named chat that reads the budget. */
const spendChat: AssistantMessage[] = [
  msg("b-1", "user", 2 * 24 * 60 + 3, "How much have we spent on groceries this month?", { author: "Ava" }),
  msg("b-2", "assistant", 2 * 24 * 60 + 2, "**$255** in 3 trips: FreshCo $119 and $72, Woolworths $64. The grocery estimate is $640 a month, so **$385 is left**."),
];

/** A quick ask that reads the calendar. */
const dentistChat: AssistantMessage[] = [
  msg("q-1", "user", 13, "When is the dentist?", { author: "Ava" }),
  msg("q-2", "assistant", 12, "**Dentist** is tomorrow at 2:30 PM. Travel is about 28 minutes, so leave by 2 PM."),
];

/** Each conversation's messages, by conversation id. */
export const assistantMessages: Record<string, AssistantMessage[]> = {
  "conv-household": householdThread,
  "conv-house": houseChat,
  "conv-hosting": hostingChat,
  "conv-holiday": holidayChat,
  "conv-spend": spendChat,
  "conv-dinner": dinnerChat,
  "conv-dentist": dentistChat,
};

/** Home Assistant, connected through its MCP Server integration, under Act. */
export const homeAssistantStatus: HomeAssistantStatus = {
  connection: { url: "https://ha.wattle.home", last4: "x7Qa", trust: "act", allowedTools: null, updatedAt: at(-6, "21:00") },
  isOwner: true,
  canStore: true,
};

export const homeAssistantTools: HomeAssistantToolInfo[] = [
  { name: "GetLiveContext", description: "The state of every exposed entity", kind: "read" },
  { name: "HassTurnOn", description: "Turns on a device or entity", kind: "write" },
  { name: "HassTurnOff", description: "Turns off a device or entity", kind: "write" },
  { name: "HassLightSet", description: "Sets the brightness or colour of a light", kind: "write" },
  { name: "HassClimateSetTemperature", description: "Sets the target temperature", kind: "write" },
];

export const assistantStatus: AssistantStatus = { access: "unlimited", ready: true, pending: 1, spentCents: 184, isOwner: true };

/** Self-hosted: Gemini Flash for chats, a local Llama for quick asks, no budget. */
export const assistantSettings: AssistantSettings = {
  trust: { groceries: "act", household: "ask", calendar: "ask", costs: "read" },
  chatModel: "gemini-3.1-flash-lite",
  quickModel: "ollama/llama3.1:8b",
  contextMessages: 12,
  quickAskIdleMinutes: 30,
  monthlyBudgetCents: 500,
  atLimit: "cheap",
  warnAtPercent: 80,
  showCostPerReply: true,
};

const slice = (key: string, label: string, costMicros: number, turns: number) => ({ key, label, costMicros, turns, tokens: turns * 2400 });

export const assistantUsage: AssistantUsage = {
  month: `${day(0).slice(0, 7)}-01`,
  summary: {
    costMicros: 1_840_000,
    turns: 212,
    tokens: 508_800,
    byPerson: [slice(AVA, "Ava", 1_020_000, 104), slice(NOA, "Noa", 640_000, 81), slice(MIA, "Mia", 180_000, 27)],
    byFeature: [slice("chat", "Chats", 1_120_000, 96), slice("household", "Household thread", 560_000, 58), slice("quick", "Quick asks", 160_000, 58)],
    byModel: [slice("gemini-3.1-flash-lite", "gemini-3.1-flash-lite", 1_840_000, 154), slice("ollama/llama3.1:8b", "ollama/llama3.1:8b", 0, 58)],
  },
  budgetCents: 500,
  warnAtPercent: 80,
  allowanceCents: null,
  serverMicros: 0,
  members: [
    { userId: AVA, name: "Ava", budgetCents: null, readOnly: false, spentMicros: 1_020_000 },
    { userId: NOA, name: "Noa", budgetCents: 200, readOnly: false, spentMicros: 640_000 },
    { userId: MIA, name: "Mia", budgetCents: 50, readOnly: true, spentMicros: 180_000 },
  ],
  isOwner: true,
};

export const assistantTelegram = { configured: true, botUsername: "wattle_st_bot", linked: { username: "ava_k", since: at(-9, "20:00") } };

// ── Home Setup and Home Search ───────────────────────────────────────────────
const setupItem = (id: string, room: string, name: string, extra: Partial<SetupItem> = {}): SetupItem => ({
  id,
  group_id: GROUP,
  name,
  room,
  priority: "medium",
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
  created_by: AVA,
  created_at: STAMP,
  updated_at: STAMP,
  deleted: false,
  ...extra,
});

/** The new place, half set up: the big things in, the small things still to get. */
export const setupItems: SetupItem[] = [
  setupItem("su-fridge", "Kitchen", "Fridge/Freezer", { priority: "high", status: "installed", est_price: 1200, actual_price: 1090 }),
  setupItem("su-kettle", "Kitchen", "Kettle and toaster", { est_price: 120, where_to_buy: "Kmart", assigned_to: NOA }),
  setupItem("su-knives", "Kitchen", "Good knife set", { priority: "low", est_price: 180 }),
  setupItem("su-sofa", "Living Room", "Sofa", { priority: "high", status: "installed", est_price: 1500, actual_price: 1340 }),
  setupItem("su-rug", "Living Room", "Rug", { est_price: 260, where_to_buy: "IKEA" }),
  setupItem("su-lamp", "Living Room", "Floor lamp", { priority: "low", est_price: 90, where_to_buy: "IKEA" }),
  setupItem("su-mattress", "Bedroom", "Mattress", { priority: "high", status: "installed", est_price: 600, actual_price: 640 }),
  setupItem("su-blinds", "Bedroom", "Blackout blinds", { priority: "high", est_price: 220, assigned_to: AVA }),
  setupItem("su-towels", "Bathroom", "Towels and bath mat", { est_price: 110 }),
  setupItem("su-shelf", "Bathroom", "Over-toilet shelf", { priority: "low", est_price: 70 }),
].map((item, i) => ({ ...item, sort_order: i }));

const apartment = (id: string, address: string, suburb: string, rent: number, extra: Partial<Apartment> = {}): Apartment => ({
  id,
  user_id: AVA,
  group_id: GROUP,
  address,
  suburb,
  rent_per_week: rent,
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
  created_at: STAMP,
  updated_at: STAMP,
  deleted: false,
  ...extra,
});

/** A few places on the go for the next move. */
export const apartments: Apartment[] = [
  apartment("ap-ocean", "4/18 Ocean St", "Bondi", 820, { bedrooms: 2, bathrooms: 2, parking: true, lat: -33.8915, lng: 151.2767, preliminary_score: 8, nearest_supermarket_m: 350, nearest_transport_m: 200, notes: "Sunny, balcony faces north." }),
  apartment("ap-wattle", "12 Wattle Lane", "Marrickville", 690, { bedrooms: 3, lat: -33.9106, lng: 151.1553, preliminary_score: 7, nearest_supermarket_m: 600, nearest_transport_m: 450, disposition: "to_book" }),
  apartment("ap-crown", "7/220 Crown St", "Surry Hills", 760, { lat: -33.8861, lng: 151.2111, preliminary_score: 6, nearest_supermarket_m: 150, nearest_transport_m: 500, notes: "Street noise at night." }),
];

const appointment = (id: string, apartmentId: string, scheduledAt: string, extra: Partial<Appointment> = {}): Appointment => ({
  id,
  user_id: AVA,
  group_id: GROUP,
  apartment_id: apartmentId,
  scheduled_at: scheduledAt,
  notes: null,
  status: "scheduled",
  created_at: STAMP,
  updated_at: STAMP,
  deleted: false,
  ...extra,
});

/** What the household scores each place on. */
export const searchChecklist: ChecklistItem[] = (
  [
    ["Natural light", "Living", 8, false, false],
    ["Two bedrooms or more", "Space", 10, true, false],
    ["Under 15 minutes to the train", "Location", 7, false, false],
    ["Laundry inside", "Amenities", 5, false, false],
    ["Balcony or courtyard", "Amenities", 3, false, true],
    ["Quiet at night", "Living", 6, false, false],
  ] as const
).map(([label, category, weight, is_dealbreaker, is_bonus], order) => ({
  id: `sc-${order}`,
  user_id: AVA,
  group_id: GROUP,
  label,
  category,
  weight,
  is_dealbreaker,
  is_bonus,
  order,
  created_at: STAMP,
  updated_at: STAMP,
  deleted: false,
}));

export const appointments: Appointment[] = [
  appointment("vw-ocean", "ap-ocean", at(SATURDAY + 1, "10:30"), { notes: "Open home, bring the checklist." }),
  appointment("vw-crown", "ap-crown", at(SATURDAY + 1, "11:15")),
];

// ── Assembled ────────────────────────────────────────────────────────────────
const byId = <T extends { id: string }>(rows: T[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

export interface Household {
  group: Group;
  groupMembers: GroupMember[];
  memberProfiles: typeof memberProfiles;
  userSettings: UserSettings;
  currentUserId: string;
  /** Group stores, by collection: rows keyed by id. */
  stores: Record<string, Record<string, unknown>>;
  /** Plain Supabase tables the pages still query directly, by table. */
  tables: Record<string, unknown[]>;
}

export const HOUSEHOLD: Household = {
  group,
  groupMembers,
  memberProfiles,
  userSettings,
  currentUserId: AVA,
  stores: {
    household_tasks: byId(tasks),
    checklists: byId(checklists),
    checklist_task_items: byId(checklistItems),
    grocery_items: byId(groceries),
    loyalty_cards: byId(loyaltyCards),
    reward_schemes: byId(rewardSchemes),
    reward_partners: byId(rewardPartners),
    reward_perks: byId(rewardPerks),
    cost_items: byId(costItems),
    documents: byId(documents),
    events: byId(events),
    recipes: byId(recipes),
    recipe_ingredients: byId(recipeIngredients),
    shopper_wants: byId(shopperWants),
    shopper_offers: byId(shopperOffers),
    shopper_price_snapshots: byId(shopperSnapshots),
    shopper_searches: byId([scoutSearch]),
    setup_items: byId(setupItems),
    apartments: byId(apartments),
    appointments: byId(appointments),
    checklist_items: byId(searchChecklist),
  },
  tables: {
    document_links: documentLinks,
    document_folders: [],
    household_tasks: tasks,
    grocery_sessions: [],
    group_modules: [],
  },
};

/** Rows the scene swaps in before the stores are opened. */
export function seed(overrides: Partial<Record<string, unknown[]>>) {
  for (const [collection, rows] of Object.entries(overrides)) {
    if (rows) HOUSEHOLD.stores[collection] = byId(rows as { id: string }[]);
  }
}

/** Rows the scene puts in a plain table before the page queries it. */
export function seedTable(table: string, rows: unknown[]) {
  HOUSEHOLD.tables[table] = rows;
}
