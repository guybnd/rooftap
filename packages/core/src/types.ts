// ── Supabase DB row types ────────────────────────────────────────────────────

export interface Group {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  region: string;                       // e.g. "AU" — drives region provider (currency, templates)
  /** ISO 4217 money is shown in; null = the region's currency (currency.ts). */
  currency?: string | null;
  home_address: string | null;
  home_lat: number | null;
  home_lng: number | null;
  home_move_in_date: string | null;     // YYYY-MM-DD
  /** Rented homes: when the lease ends (YYYY-MM-DD). Null = not rented, or not tracked. */
  lease_end_date?: string | null;
  /** Days of notice the lease needs before lease_end_date to renew or leave. */
  lease_notice_days?: number | null;
  chosen_apartment_id: string | null;
  /** Shopper sources this household switched off (HOUP-437); null or absent on servers before it. */
  shopper_disabled_sources?: string[] | null;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
}

export interface GroupInvitation {
  id: string;
  group_id: string;
  invited_by: string;
  invited_user_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  resolved_at: string | null;
  group_name?: string;
}

export interface Agent {
  id: string;
  user_id: string;
  group_id: string;
  name: string;
  phone: string | null;
  color: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface ApartmentAgent {
  id: string;
  group_id: string;
  apartment_id: string;
  agent_id: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface Apartment {
  id: string;
  user_id: string;
  group_id: string;
  address: string;
  suburb: string | null;
  rent_per_week: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: boolean | null;
  listing_url: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  agent_id: string | null;
  preliminary_score: number | null;
  nearest_supermarket_m: number | null;
  nearest_transport_m: number | null;
  disposition: "to_book" | "skipped" | "rebook" | null;
  move_in_date: string | null;
  main_location: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface ApartmentPreliminaryScore {
  id: string;
  apartment_id: string;
  user_id: string;
  score: number;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  user_id: string;
  group_id: string;
  label: string;
  category: string;
  weight: number;          // 1–10
  is_dealbreaker: boolean;
  is_bonus: boolean;
  order: number;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface ChecklistResponse {
  id: string;
  group_id: string;
  apartment_id: string;
  checklist_item_id: string;
  value: boolean | null;   // true = yes, false = no, null = n/a
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface Photo {
  id: string;
  apartment_id: string;
  storage_path: string;
  caption: string | null;
  room: string | null;
  is_main: boolean;
  created_at: string;
}

export const ROOM_OPTIONS = [
  "Living Room",
  "Kitchen",
  "Bedroom",
  "Bathroom",
  "Balcony",
  "Laundry",
  "Garage",
  "Exterior",
  "Other",
] as const;

export type RoomTag = (typeof ROOM_OPTIONS)[number];

export interface ApartmentComment {
  id: string;
  group_id: string;
  apartment_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface SetupItemComment {
  id: string;
  setup_item_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export interface HouseholdTaskComment {
  id: string;
  household_task_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export interface Appointment {
  id: string;
  user_id: string;
  group_id: string;
  apartment_id: string;
  scheduled_at: string;
  notes: string | null;
  status: "scheduled" | "viewed" | "cancelled" | "optional" | "skipped" | "rebook";
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface UserSettings {
  id: string;
  user_id: string;
  rent_min: number | null;
  rent_max: number | null;
  appointment_duration_minutes: number;
  /** Section preferences (added in 20260612000001). */
  default_section: string | null;
  last_used_section: string | null;
  /** FLUX-65: section ids hidden from the sidebar switcher for this user. */
  hidden_sections: string[] | null;
  /** FLUX-165: per-user section display order (array of section ids) for the switcher — synced replacement for localStorage. */
  section_order: string[] | null;
  /** FLUX-65: Costs default time period ('weekly' | 'monthly' | 'yearly'). */
  costs_period: string | null;
  /** FLUX-65: Costs monthly budget target, stored in cents. */
  costs_budget_monthly: number | null;
  /** FLUX-1560: Costs "This month" filter default (default true). */
  costs_this_month_only: boolean;
  /** FLUX-1560: "From your other sections" suggestion block dismissed (default false). */
  costs_hide_section_suggestions: boolean;
  /** Money insights this person hid or kept (cost-insights.ts). Missing before 20261023030000_money_insight_marks. */
  money_insight_marks?: Record<string, string> | null;
  /** Money summaries this person asked the Assistant for (money-summary.ts). Missing before 20261023040000_money_summaries. */
  money_summaries?: { weekly?: boolean; monthly?: boolean } | null;
  /** FLUX-65: Groceries aisle display order (synced replacement for localStorage). */
  grocery_aisle_order: string[] | null;
  /** FLUX-65: Groceries per-aisle default unit (aisle id/custom name -> unit string). */
  grocery_aisle_units: Record<string, string> | null;
  /** HOUP-317: Groceries list view — 'aisle' (grouped) or 'flat' ("One list"). */
  grocery_sort_mode: string | null;
  /** What the X on a running-low suggestion does ('not_now' | 'archive'); null = ask on first tap. */
  grocery_suggest_dismiss: string | null;
  /** HOUP-327: account default — sink completed checklist items below a collapsible band. */
  checklists_completed_to_bottom: boolean;
  /** HOUP-327: account default — the completed band starts collapsed. */
  checklists_collapse_completed: boolean;
  /** HOUP-327: account default checklist sort mode ('manual' | 'alpha' | 'price' | 'recent'). */
  checklists_default_sort: string | null;
  /** FLUX-253: summary-hero module registry on/off state, keyed by module key. Missing key -> module's defaultOn. */
  home_hero_modules: Record<string, boolean> | null;
  /** FLUX-258: the summary-hero countdown module's single pinned event, or null when nothing is pinned. */
  home_hero_countdown: { label: string; date: string } | null;
  /** FLUX-65: Household default reminder lead time in days (default 14). */
  reminder_lead_days: number | null;
  /** How many days ahead the Tasks screen's Upcoming group reaches; further-out tasks sit under Later. Null = 90. */
  tasks_upcoming_days: number | null;
  /** Minutes before leaving that a "time to leave" push comes: 30 or 60. Null = an hour (event-travel.ts). */
  leave_alert_minutes?: number | null;
  /** FLUX-228: undated (due_date, no due_time) task push mode. */
  calendar_todo_mode: "all_day" | "timed_block";
  /** FLUX-228: 24h "HH:MM" start time for calendar_todo_mode='timed_block'. */
  calendar_todo_default_time: string;
  /** FLUX-228: one of 15/30/60. */
  calendar_todo_default_duration_minutes: number;
  /** FLUX-228: show pulled Google Calendar events in the /home to-do feed. */
  calendar_show_pulled_events_in_todo: boolean;
  /** FLUX-228: IANA timezone for wall-clock -> Google event conversion. */
  timezone: string;
  /** HOUP-26: MCP server on/off for this user's PAT-authenticated agent access. */
  mcp_enabled: boolean;
  /** HOUP-26: when true, only read-kind MCP tools may register (intersects mcp_allowed_tools). */
  mcp_read_only: boolean;
  /** HOUP-26: MCP tool name allowlist. null = every tool, [] = none. */
  mcp_allowed_tools: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface SavedSearch {
  id: string;
  group_id: string;
  created_by: string;
  name: string;
  url: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

// ── Nearby POI types ──────────────────────────────────────────────────────────

export type POICategory = "supermarket" | "bus_stop" | "tram_stop" | "train_station";

export interface NearbyPOI {
  id: string;
  category: POICategory;
  name: string | null;
  lat: number;
  lng: number;
  distance?: number;
}

export interface NearbyPOIsResponse {
  pois: NearbyPOI[];
}

// ── Derived / UI types ────────────────────────────────────────────────────────

export interface ApartmentScore {
  total: number;
  percentage: number;
  dealbreakers: string[];
}

export interface ApartmentWithScore extends Apartment {
  score: ApartmentScore | null;
  preliminaryScores?: ApartmentPreliminaryScore[];
  preliminaryAvg?: number | null;
}

export interface ApartmentDraft {
  address?: string;
  suburb?: string;
  rent_per_week?: number;
  bedrooms?: number;
  bathrooms?: number;
  parking?: boolean;
  listing_url?: string;
}

// ── Home Setup section (FLUX-51) ──────────────────────────────────────────────

export interface SetupStore {
  id: string;
  group_id: string;
  name: string;
  url: string | null;
  address: string | null;
  created_by: string;
  created_at: string;
}

export interface SetupItem {
  id: string;
  group_id: string;
  name: string;
  room: string;
  priority: "low" | "medium" | "high";
  status: "needed" | "installed";
  est_price: number | null;
  actual_price: number | null;
  where_to_buy: string | null;
  store_id: string | null;
  url: string | null;
  notes: string | null;
  assigned_to: string | null;
  private: boolean;
  template_key: string | null;
  ai_suggestion: Record<string, unknown> | null;
  sort_order: number;
  // NOT NULL in the DB, but optional/nullable here: local-first creates build
  // the row with created_by:null and useStoreHelpers.writeRow stamps the active
  // user before the row syncs (mirrors grocery_items).
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

// ── Costs / Budget section (FLUX-66) ──────────────────────────────────────────

export type CostCategory =
  | "rent"
  | "utilities"
  | "internet"
  | "insurance"
  | "subscription"
  | "grocery_estimate"
  | "moving"
  | "purchase"
  | "outing"
  | "transport"
  | "health"
  | "pets"
  | "family"
  | "other"
  /** Money in: pay, transfers from outside. Never counted as a cost. */
  | "income";

export type CostCadence =
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "one_off";

export interface CostItem {
  id: string;
  group_id: string;
  name: string;
  category: CostCategory;
  amount: number;            // minor units (cents)
  cadence: CostCadence;
  is_estimate: boolean;
  start_date: string | null;
  end_date: string | null;
  discount_end_date: string | null;
  provider: string | null;
  assigned_to: string | null;
  linked_section: string | null;
  notes: string | null;
  sort_order: number;
  // NOT NULL in the DB, but nullable here: local-first creates build the row
  // with created_by:null and useStoreHelpers.writeRow stamps the active user
  // before the row syncs (mirrors grocery_items).
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  /** 'up' when the server made the line for a vendor's bank payments and keeps its amount in step. */
  bank_source?: 'up' | null;
  /** Kept so the bank's payments still find it, but left out of every total. Missing before 20261022170000_cost_redesign. */
  archived?: boolean;
  /** Prices a recurring cost takes from a date on (YYYY-MM-DD), oldest first. Missing before 20261022170000_cost_redesign. */
  price_changes?: { from: string; amount: number }[] | null;
}

export interface CostDocument {
  id: string;
  cost_item_id: string;
  storage_path: string;
  filename: string;
  doc_type: "contract" | "bill" | "receipt" | "other";
  uploaded_by: string;
  created_at: string;
}

export interface CostItemComment {
  id: string;
  cost_item_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

// ── Documents store (FLUX-98 / FLUX-103) ─────────────────────────────────────
// Central store all capture/intake flows write into; a polymorphic join links
// one document to any number of services.

export type DocType =
  | "invoice"
  | "receipt"
  | "warranty"
  | "manual"
  | "contract"
  | "photo"
  | "other"
  // FLUX-113: expanded household categories surfaced in the capture flow.
  | "id_personal"
  | "insurance"
  | "lease_contract"
  | "tax_financial"
  | "medical"
  | "vehicle"
  | "appliance_manual";

export type DocumentSource = "capture" | "cost" | "warranty" | "grocery" | "other";

export type DocumentEntityType =
  | "cost_item"
  | "grocery_session"
  | "setup_item"
  | "recipe"
  | "event";

export interface Document {
  id: string;
  group_id: string;
  storage_path: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  doc_type: DocType;
  title: string | null;
  parsed: unknown | null;        // raw /api/parse-receipt output when parsed
  source: DocumentSource;
  expiry_date: string | null;    // FLUX-113: YYYY-MM-DD; drives expiry reminders/badges
  tags: string[];                // FLUX-113: free-text filing tags (lowercased on save)
  metadata: Record<string, unknown>;  // FLUX-133: per-category sub-fields
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  /** Filing folder; null = root. Legacy documents have no row here at all. */
  folder_id: string | null;
}

/** A node in the Documents section's filing tree. Null parent_id = top level. */
export interface DocumentFolder {
  id: string;
  group_id: string;
  name: string;
  parent_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentLink {
  id: string;
  document_id: string;
  group_id: string;
  entity_type: DocumentEntityType;
  entity_id: string;
  link_role: string | null;
  created_at: string;
}

// ── Groceries section (FLUX-71) ──────────────────────────────────────────────

export type GroceryAisle =
  | "produce"
  | "dairy_eggs"
  | "meat_seafood"
  | "bakery"
  | "pantry"
  | "frozen"
  | "drinks"
  | "household"
  | "other";

export interface GroceryCustomAisle {
  id: string;
  group_id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface GroceryItem {
  id: string;
  group_id: string;
  name: string;
  aisle: string;  // GroceryAisle | custom aisle name
  quantity: number | null;
  unit: string | null;
  status: "needed" | "bought" | "have";
  notes: string | null;
  assigned_to: string | null;
  private: boolean;
  template_key: string | null;
  sort_order: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean; // soft-delete tombstone for offline sync (FLUX-148)
  // Phase 2+
  recurrence_days: number | null;
  status_changed_at: string | null;  // when `status` last changed (FLUX-188); null on legacy rows
  last_purchased_at: string | null;
  last_price: number | null;
  lowest_price: number | null;
  expiry_date: string | null;
  // UI improvements
  shelf_life_days: number | null;   // how many days this item typically lasts
  price_cents: number | null;       // expected price for total estimates
  is_essential: boolean;            // staple pinned to the Home hub while 'needed' (FLUX-185)
  // FLUX-189: ephemeral note when a recipe pushed this item onto the list
  // (e.g. "250 g for Lasagna"). Distinct from `notes` (user-owned); auto-cleared
  // when the item's status leaves 'needed'. recipe_source_id is a soft link (no FK).
  recipe_note: string | null;
  recipe_source_id: string | null;
  // FLUX-207: hides a "suggest re-add" suggestion (still-have-it, past shelf
  // life) until this date. Null = not snoozed.
  re_add_snoozed_until: string | null;
  // Dismisses a "suggest re-add" suggestion for the current have-it stint:
  // hidden while this is newer than `status_changed_at`, so it returns once
  // the item is bought again. Null = never dismissed.
  re_add_dismissed_at: string | null;
}

export interface GrocerySession {
  id: string;
  group_id: string;
  session_date: string;            // YYYY-MM-DD (local day)
  summed_total_cents: number;      // sum of bought-item typical prices for the day
  override_total_cents: number | null;
  receipt_total_cents: number | null;
  retailer: string | null;
  receipt_path: string | null;
  receipt_name: string | null;
  tracking: "on" | "skipped";
  cost_item_id: string | null;
  // FLUX-1559: stamped when "Done shopping" finalizes the day's shop, so the
  // session-sync effect freezes summed_total_cents instead of recomputing it
  // (and deleting the Costs line) once today's items flip to "have".
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HouseholdTask {
  id: string;
  group_id: string;
  title: string;
  due_date: string | null;
  due_time: string | null; // wall-clock HH:MM[:SS]; null = all-day (FLUX-144)
  offset_days: number | null;
  recurrence_days: number | null;
  done: boolean;
  completed_at: string | null; // ISO timestamp set when done→true, cleared on un-check (FLUX-164)
  /** Who ticked it off; a database trigger fills it. Missing before 20261023060000_task_completed_by. */
  completed_by?: string | null;
  assigned_to: string | null;
  private: boolean;
  template_key: string | null;
  notes: string | null;
  sort_order: number;
  /** FLUX-182: Low/Med/High priority (mirrors SetupItem.priority). Additive +
   *  nullable, so existing task-construction sites that omit it are unaffected;
   *  the DB backfills 'medium'. */
  priority?: "low" | "medium" | "high" | null;
  /** FLUX-156: when this to-do was created for a dated checklist, opens it.
   *  Optional (additive column) so existing task-construction sites are unaffected. */
  linked_checklist_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean; // soft-delete tombstone for offline sync (FLUX-148)
}


// FLUX-249: dedicated group-scoped, group-visible calendar event (distinct from
// the user-scoped `Appointment` and the read-only `GoogleCalendarEvent` overlay —
// named `GroupEvent`, not `CalendarEvent`, to avoid colliding with the latter).
export type EventCategory =
  | "general"
  | "medical"
  | "social"
  | "household"
  | "finance"
  | "school"
  | "travel"
  | "work";

export interface GroupEvent {
  id: string;
  group_id: string;
  created_by: string | null;
  title: string;
  category: EventCategory;
  starts_at: string;
  ends_at: string | null;
  is_all_day: boolean;
  location: string | null;
  notes: string | null;
  private: boolean;
  /** Days before the event a push reminder goes out (0 = on the day). Null or absent = a week and a day before (event-reminders.ts); [] = none. */
  reminder_days?: number[] | null;
  /** The Budget line for this event's tickets (cost_items, category "outing"), when there is one. */
  cost_item_id?: string | null;
  /** How the household gets there, for a "time to leave" push; null = off. */
  travel_mode?: "drive" | "walk" | "cycle" | null;
  /** Travel time from home in minutes, worked out when the event was saved. */
  travel_minutes?: number | null;
  /** Unused since per-person alert times (event_leave_notices replaced it); kept for older rows. */
  leave_notified_for?: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean; // soft-delete tombstone for offline sync (mirrors HouseholdTask)
}

// ── Rewards cards (Groceries) ─────────────────────────────────────────────────
// A household's loyalty/rewards cards (Flybuys, Everyday Rewards...), shown as
// a scannable code at the checkout. Local-first, so a card still opens with no
// signal in the shop. Encoding lives in loyalty-cards.ts.

export type LoyaltyCardFormat = "code128" | "ean13" | "qr";

export interface LoyaltyCard {
  id: string;
  group_id: string;
  created_by: string | null;
  name: string;
  /** What the code encodes, already normalized (see normalizeLoyaltyNumber). */
  number: string;
  format: LoyaltyCardFormat;
  // Rewards module (migration 20261021130000_rewards). Optional: a server
  // without that migration sends none of them, and Groceries never sets them.
  /** The scheme this card belongs to (rewards.ts). */
  scheme_id?: string | null;
  /** "Just me": only `created_by` can see it (RLS). */
  private?: boolean;
  expires_on?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

// ── Checklists section (FLUX-156) ─────────────────────────────────────────────
// A general-purpose, group-shared checklist tool — distinct from the legacy
// apartment-scoring `ChecklistItem`/`checklist_items` (user-scoped) above.

/** ☑ plain · 🔁 repeating · 🛒 shopping. "Scheduled" is NOT a type — a due date
 *  is a cross-cutting `scheduled_date` attribute any type can carry. */
export type ChecklistType = "plain" | "repeating" | "shopping";

/** How a repeating checklist renews on its cadence date. */
export type ChecklistRenewalMode = "clone" | "reset";

export interface Checklist {
  id: string;
  group_id: string;
  title: string;
  type: ChecklistType;
  template_key: string | null;
  source_checklist_id: string | null;   // prior run this was cloned from
  completed_at: string | null;
  scheduled_date: string | null;        // YYYY-MM-DD → linked dashboard to-do
  linked_task_id: string | null;        // household_tasks row for the date
  log_costs: boolean;                    // Shopping: log a cost on check
  repeat_cadence_days: number | null;    // Repeating: renewal cadence
  repeat_renewal_mode: ChecklistRenewalMode | null;
  // NOT NULL in the DB, but nullable here: local-first creates build the row with
  // created_by:null and useStoreHelpers.writeRow stamps the active user before
  // the row syncs (mirrors grocery_items).
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface ChecklistTaskItem {
  id: string;
  checklist_id: string;
  group_id: string;
  label: string;
  is_done: boolean;
  checked_by: string | null;             // attribution: who checked it
  checked_at: string | null;             // attribution: when (cleared on uncheck)
  cost_cents: number | null;             // Shopping: unit cost in cents
  linked_cost_item_id: string | null;    // reverse pointer to logged cost_items row
  order: number;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface ChecklistTemplate {
  id: string;
  group_id: string;
  title: string;
  default_type: ChecklistType | null;
  default_cadence_days: number | null;
  template_key: string | null;           // well-known key for seeded starters
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface ChecklistTemplateItem {
  id: string;
  template_id: string;
  group_id: string;
  label: string;
  default_cost_cents: number | null;
  order: number;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

// ── Recipes section (FLUX-189) ────────────────────────────────────────────────
// A group-shared recipe book. Ingredients name-match against grocery_items to
// drive a live have/need fill bar and one-tap "add missing to the shopping list".

/** Fixed cooking method. Nullable/unset renders as "other". */
export type RecipeMethod = "cooking" | "baking" | "roasting" | "other";

// FLUX-202: how a recipe's data got here. This ticket only ever writes
// 'photo' (scans) and 'manual' (hand entry); 'pdf'/'url' are reserved so a
// future importer can reuse the same parse/draft/review pipeline with no
// further migration.
export type RecipeSourceType = "photo" | "pdf" | "url" | "manual";

export interface Recipe {
  id: string;
  group_id: string;
  title: string;
  cuisines: string[];              // free-text cuisine tags (multi-select)
  method: RecipeMethod | null;     // null → unset/other
  instructions: string | null;     // optional free-text prep steps, newline-delimited steps
  servings: number | null;         // FLUX-202
  prep_minutes: number | null;     // FLUX-202
  cook_minutes: number | null;     // FLUX-202
  source: string | null;           // FLUX-202: free-text locator (filename/URL) for provenance
  source_type: RecipeSourceType | null; // FLUX-202: null = predates the scan feature
  draft: boolean;                  // FLUX-202: true until the scan review is Saved
  // NOT NULL in the DB, but nullable here: local-first creates build the row with
  // created_by:null and useStoreHelpers.writeRow stamps the active user before
  // the row syncs (mirrors grocery_items / checklists).
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  group_id: string;
  name: string;                    // full transcribed/entered line (the descriptor)
  item_name: string | null;        // FLUX-205: canonical grocery item; have/need + grocery-add key on item_name ?? name
  quantity: number | null;
  unit: string | null;
  position: number;                // display order within the recipe
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

// ── Google Calendar integration (FLUX-157) ────────────────────────────────────
// Server-side only: all three tables are service-role only (RLS enabled, zero
// client policies). The client never queries these directly — only through
// /api/calendar/* routes. Kept here for API route / service-layer typing.

export type GoogleCalendarSuggestMode = "dedicated" | "keywords" | "both";

export interface GoogleCalendarConnection {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scopes: string;
  selected_calendar_ids: string[];
  suggest_mode: GoogleCalendarSuggestMode;
  dedicated_calendar_id: string | null;
  keywords: string[];
  /** FLUX-228: id of the dedicated "Rooftap" calendar pushes target; null until first push after rollout. */
  homeup_calendar_id: string | null;
  pull_window_past_days: number;
  pull_window_future_days: number;
  default_import_visibility: GoogleCalendarEventVisibility;
  /** FLUX-233: whether calendar-sync should pull this connection's calendars at all. */
  pull_enabled: boolean;
  /** FLUX-233: whether to-dos (household_tasks) should be pushed to this member's calendar. Appointments are unaffected. */
  push_todos_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type GoogleCalendarEventVisibility = "private" | "group";
export type GoogleCalendarEventState = "synced" | "suggested" | "imported" | "dismissed";

export interface GoogleCalendarEvent {
  id: string;
  user_id: string;
  gcal_event_id: string;
  gcal_calendar_id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  is_all_day: boolean;
  html_link: string | null;
  visibility: GoogleCalendarEventVisibility;
  matched_apartment_id: string | null;
  state: GoogleCalendarEventState;
  imported_appointment_id: string | null;
  imported_task_id: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /api/calendar/events row shape: a staging row plus read-side attribution. */
export interface GoogleCalendarEventWithAttribution extends GoogleCalendarEvent {
  /** Present when this row belongs to another group member (visibility='group'). */
  sharedByUserId?: string;
}

export type GoogleCalendarPushedEntityType = "appointment" | "task";
/** 'push' = Rooftap created the Google event; 'import' = adopted the member's own pre-existing event for echo control only — never update/delete it. */
export type GoogleCalendarPushedEventOrigin = "push" | "import";

export interface GoogleCalendarPushedEvent {
  user_id: string;
  entity_type: GoogleCalendarPushedEntityType;
  entity_id: string;
  gcal_event_id: string;
  synced_at: string;
  origin: GoogleCalendarPushedEventOrigin;
}

// ── Shared UI-adjacent types ─────────────────────────────────────────────────
// Not a DB row — the option shape fed to the SearchablePicker component
// (apps/web/src/components/ui/searchable-picker.tsx). Lives here because
// several core business-logic modules (cost-items.ts, events.ts) build
// PickerOption[] lists without needing the component itself.

export interface PickerOption {
  value: string;
  primary: string;
  secondary?: string | null;
  /** Category grouping for the no-query view. */
  group?: { key: string; label: string; color?: string } | null;
  /** Extra terms to match on (not displayed). */
  searchText?: string;
}
