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
  UserSettings,
} from "@homeup/core";

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
const task = (id: string, title: string, extra: Partial<HouseholdTask> = {}): HouseholdTask => ({
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
  { ...base, id: "lc-flybuys", created_by: AVA, name: "Flybuys", number: "6014355001234568", format: "code128" },
  { ...base, id: "lc-rewards", created_by: NOA, name: "Everyday Rewards", number: "9355000012345", format: "ean13" },
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
    cost_items: byId(costItems),
    documents: byId(documents),
    events: byId(events),
    recipes: byId(recipes),
    recipe_ingredients: byId(recipeIngredients),
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
