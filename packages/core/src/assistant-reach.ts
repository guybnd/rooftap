import type { ModuleId } from './modules';

// What the Assistant (and any MCP client) can reach, written down for every
// module and every database table. A feature that adds a module or a table
// says here how the Assistant reaches it: the household tools that read or
// change it (MCP_TOOLS names), or one line on why it has none.
// apps/web/src/lib/assistant-reach.test.ts fails while a module or a table in
// supabase/migrations is missing, a tool name is unknown, or a module listed
// as having no tools has gained some (.docs/modules.md, section 14).

export type Reach = { tools: readonly string[] } | { none: string };

/** Modules with no household tool of their own, and why. Every other module needs at least one. */
export const MODULES_WITHOUT_TOOLS: Partial<Record<ModuleId, string>> = {
  assistant: 'The Assistant itself. Its settings stay in Settings, where an owner decides what it may do.',
  'google-calendar': 'Sync only. The events it brings in reach the Assistant through Calendar.',
  mcp: 'The door outside AI assistants use to reach the household tools. It holds no household data of its own.',
};

const COMMENTS = 'Comments are members talking to each other about an item, not household state to act on.';
const SERVER = 'Server bookkeeping, not something a person reads or changes.';
const ACCOUNT = 'Accounts, sign-in and access, kept out of the Assistant on purpose.';

/** Every table in supabase/migrations. */
export const TABLE_REACH: Record<string, Reach> = {
  // Platform
  groups: { none: 'The household itself. Tools read its region and currency as they need them.' },
  group_members: { none: 'Members are named in the prompt; changing membership stays in Settings.' },
  group_invitations: { none: ACCOUNT },
  group_modules: { none: 'Which modules are on. The prompt names them; switching them stays with owners in Settings.' },
  group_entitlements: { none: ACCOUNT },
  user_settings: { none: 'Personal settings. Tools read the time zone and Costs goal from it.' },
  admin_config: { none: 'Operator settings for the server.' },
  ai_usage: { none: SERVER },
  household_ai_keys: { none: ACCOUNT },
  device_push_tokens: { none: SERVER },
  push_subscriptions: { none: SERVER },
  personal_access_tokens: { none: ACCOUNT },
  pat_rate_limits: { none: SERVER },
  oauth_clients: { none: ACCOUNT },
  oauth_authorization_codes: { none: ACCOUNT },
  oauth_tokens: { none: ACCOUNT },
  oauth_rate_limits: { none: SERVER },
  app_feedback: { tools: ['send_feedback'] },

  // Tasks & Reminders
  household_tasks: { tools: ['get_tasks', 'create_task', 'update_task', 'complete_task', 'delete_task', 'get_agenda'] },
  household_task_comments: { none: COMMENTS },

  // Calendar
  events: { tools: ['get_upcoming_calendar_events', 'create_event', 'update_event', 'delete_event', 'get_agenda'] },
  event_leave_notices: { none: SERVER },
  google_calendar_connections: { none: ACCOUNT },
  google_calendar_events: { none: 'Google events the Calendar shows; reached through Calendar in the app.' },
  google_calendar_pushed_events: { none: SERVER },

  // Checklists
  checklists: { tools: ['get_checklists', 'create_checklist'] },
  checklist_task_items: { tools: ['get_checklists', 'add_checklist_item', 'check_checklist_item', 'create_checklist'] },
  checklist_templates: { tools: ['get_checklist_templates', 'create_checklist'] },
  checklist_template_items: { tools: ['get_checklist_templates', 'create_checklist'] },

  // Documents
  documents: { tools: ['find_documents'] },
  document_folders: { tools: ['find_documents'] },
  document_links: { none: 'Links between a document and a cost, purchase or event; the linked item is reached through its own module.' },
  cost_documents: { none: 'Receipt files from before Documents; new receipts are documents.' },

  // Groceries
  grocery_items: { tools: ['get_grocery_items', 'create_grocery_item', 'update_grocery_item', 'delete_grocery_item'] },
  grocery_aisles: { none: 'The household\'s own aisle names; each grocery item already carries its aisle.' },
  grocery_item_library: { none: 'Fills prices and shelf life in the app; the result shows on each grocery item.' },
  grocery_sessions: { none: 'A shopping trip\'s receipt and total; the total reaches Costs as a cost line.' },
  loyalty_cards: { tools: ['get_rewards'] },

  // Recipes and Meal plan
  recipes: { tools: ['get_recipes', 'save_recipe', 'add_recipe_to_groceries', 'get_meal_plan'] },
  recipe_ingredients: { tools: ['get_recipes', 'save_recipe', 'add_recipe_to_groceries'] },
  recipe_staples: { tools: ['add_recipe_to_groceries'] },
  ingredient_aliases: { tools: ['add_recipe_to_groceries'] },
  cook_sessions: { tools: ['get_running_cooks', 'start_timer'] },
  meal_plan_entries: { tools: ['get_meal_plan', 'set_meal', 'get_agenda'] },

  // Costs & Budget, Up Bank
  cost_items: { tools: ['get_budget_summary', 'create_cost_item', 'update_cost_item', 'delete_cost_item', 'get_agenda', 'get_money_insights'] },
  cost_item_comments: { none: COMMENTS },
  up_bank_connections: { none: ACCOUNT },
  bank_accounts: { tools: ['get_bank_spending'] },
  bank_transactions: { tools: ['get_bank_spending', 'update_bank_payment', 'make_cost_from_payment'] },
  bank_links: { tools: ['set_bank_link_rule', 'merge_cost_lines', 'update_bank_payment'] },

  // Home Setup and Home care
  setup_items: { tools: ['get_setup_items', 'create_setup_item', 'update_setup_item'] },
  setup_item_comments: { none: COMMENTS },
  setup_stores: { none: 'Saved store names for the Setup form; each item carries where to buy it.' },
  care_jobs: { tools: ['get_care_jobs', 'add_care_job', 'update_care_job', 'get_agenda'] },

  // Home Search
  apartments: { tools: ['get_home_search'] },
  appointments: { tools: ['get_home_search'] },
  agents: { none: 'Agents\' contact details; the listing is what people ask about.' },
  apartment_agents: { none: 'Links listings to agents.' },
  apartment_comments: { none: COMMENTS },
  apartment_preliminary_scores: { none: 'Each member\'s own first score; the listing carries the score.' },
  photos: { none: 'Listing photos; the Assistant works with text.' },
  checklist_items: { none: 'The old per-person viewing checklist for listings.' },
  checklist_responses: { none: 'Answers to the old viewing checklist.' },
  saved_searches: { none: 'Saved listing searches on the map.' },
  warranty_asset_comments: { none: 'Left over from the retired warranties section; warranties are documents now.' },

  // Shopper
  shopper_wants: { tools: ['get_watchlist', 'watch_item', 'update_watch_item'] },
  shopper_offers: { none: 'Store offers behind each watch; the watchlist carries the best one.' },
  shopper_price_snapshots: { none: 'Price history behind the deal rating; the watchlist carries the best price.' },
  shopper_searches: { tools: ['start_scout', 'get_scout_run'] },
  shopper_picks: { tools: ['get_scout_run'] },
  shopper_scout_messages: { tools: ['get_scout_run'] },

  // Rewards
  reward_schemes: { tools: ['get_rewards', 'add_reward_perk'] },
  reward_partners: { tools: ['get_rewards'] },
  reward_perks: { tools: ['get_rewards', 'add_reward_perk'] },

  // Occasions
  occasions: { tools: ['get_occasions', 'add_occasion', 'get_agenda'] },
  gift_ideas: { tools: ['get_occasions', 'add_gift_ideas'] },
  wishlist_items: { tools: ['get_occasions', 'add_wishlist_items'] },

  // Bin night
  bin_streams: { tools: ['get_bin_night', 'change_bin_collection', 'get_agenda'] },
  bin_changes: { tools: ['get_bin_night', 'change_bin_collection'] },
  bin_plans: { tools: ['get_bin_night', 'mark_bins_out'] },
  bin_night_pushes: { none: SERVER },

  // Assistant
  assistant_settings: { none: 'The Assistant\'s own settings, kept with owners in Settings.' },
  assistant_member_limits: { none: 'Owner limits on what each member may ask; they shape the tools offered.' },
  assistant_conversations: { none: 'The chats themselves.' },
  assistant_messages: { none: 'The chats themselves.' },
  assistant_memories: { none: 'Remembered facts go in the prompt, written with the remember marker.' },
  assistant_reads: { none: SERVER },
  assistant_notify_prefs: { none: 'Each person\'s notification choice, in Settings.' },
  assistant_usage: { none: SERVER },
  assistant_home_assistant: { none: ACCOUNT },
  assistant_telegram_codes: { none: ACCOUNT },
  assistant_telegram_links: { none: ACCOUNT },
  assistant_telegram_updates: { none: SERVER },
  assistant_web_lookups: { none: SERVER },

  // new-module:table-reach (scripts/new-module.mjs adds above this line)
};
