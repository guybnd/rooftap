import type { ModuleId } from './modules';

export type McpToolKind = 'read' | 'write';

export interface McpToolMeta {
  name: string;
  kind: McpToolKind;
  /** The module whose data the tool reads or writes; it registers only while that module is on. */
  module: ModuleId;
}

// Single source of truth for every tool the Rooftap MCP server can expose.
// `kind` gates registration in buildServer() (apps/web/src/app/api/mcp/route.ts)
// and renders the settings allowlist on web and native (mcp-settings.tsx in
// each app), so the registered set and the UI checklist are the same list by
// construction. A dev-time assertion in route.ts keeps this list and the
// actual registerTool call sites from drifting apart. `module` gates
// registration and the checklist the same way (.docs/modules.md): a
// switched-off module's tools don't exist.
export const MCP_TOOLS: McpToolMeta[] = [
  { name: 'get_budget_summary', kind: 'read', module: 'costs' },
  { name: 'create_cost_item', kind: 'write', module: 'costs' },
  { name: 'update_cost_item', kind: 'write', module: 'costs' },
  { name: 'delete_cost_item', kind: 'write', module: 'costs' },
  { name: 'get_tasks', kind: 'read', module: 'household' },
  { name: 'create_task', kind: 'write', module: 'household' },
  { name: 'update_task', kind: 'write', module: 'household' },
  { name: 'complete_task', kind: 'write', module: 'household' },
  { name: 'delete_task', kind: 'write', module: 'household' },
  { name: 'get_upcoming_calendar_events', kind: 'read', module: 'calendar' },
  { name: 'get_agenda', kind: 'read', module: 'household' },
  { name: 'create_event', kind: 'write', module: 'calendar' },
  { name: 'update_event', kind: 'write', module: 'calendar' },
  { name: 'delete_event', kind: 'write', module: 'calendar' },
  { name: 'get_grocery_items', kind: 'read', module: 'groceries' },
  { name: 'create_grocery_item', kind: 'write', module: 'groceries' },
  { name: 'update_grocery_item', kind: 'write', module: 'groceries' },
  { name: 'delete_grocery_item', kind: 'write', module: 'groceries' },
  { name: 'get_recipes', kind: 'read', module: 'recipes' },
  { name: 'add_recipe_to_groceries', kind: 'write', module: 'recipes' },
  { name: 'get_recipe_steps', kind: 'read', module: 'recipes' },
  { name: 'get_running_cooks', kind: 'read', module: 'recipes' },
  { name: 'start_timer', kind: 'write', module: 'recipes' },
  { name: 'get_meal_plan', kind: 'read', module: 'meals' },
  { name: 'set_meal', kind: 'write', module: 'meals' },
  { name: 'get_checklists', kind: 'read', module: 'checklists' },
  { name: 'add_checklist_item', kind: 'write', module: 'checklists' },
  { name: 'check_checklist_item', kind: 'write', module: 'checklists' },
  { name: 'get_setup_items', kind: 'read', module: 'setup' },
  { name: 'get_occasions', kind: 'read', module: 'occasions' },
  { name: 'add_occasion', kind: 'write', module: 'occasions' },
  { name: 'add_gift_ideas', kind: 'write', module: 'occasions' },
  { name: 'add_wishlist_items', kind: 'write', module: 'occasions' },
  { name: 'get_watchlist', kind: 'read', module: 'shopper' },
  { name: 'start_scout', kind: 'write', module: 'shopper' },
  { name: 'get_scout_run', kind: 'read', module: 'shopper' },
  { name: 'get_bank_spending', kind: 'read', module: 'costs' },
  { name: 'update_bank_payment', kind: 'write', module: 'costs' },
  { name: 'make_cost_from_payment', kind: 'write', module: 'costs' },
  { name: 'set_bank_link_rule', kind: 'write', module: 'costs' },
  { name: 'merge_cost_lines', kind: 'write', module: 'costs' },
  { name: 'get_rewards', kind: 'read', module: 'rewards' },
  { name: 'add_reward_perk', kind: 'write', module: 'rewards' },
  { name: 'get_bin_night', kind: 'read', module: 'bins' },
  { name: 'mark_bins_out', kind: 'write', module: 'bins' },
  { name: 'change_bin_collection', kind: 'write', module: 'bins' },
  { name: 'get_care_jobs', kind: 'read', module: 'home-care' },
  { name: 'update_care_job', kind: 'write', module: 'home-care' },
  { name: 'add_care_job', kind: 'write', module: 'home-care' },
  { name: 'watch_item', kind: 'write', module: 'shopper' },
  { name: 'update_watch_item', kind: 'write', module: 'shopper' },
  { name: 'get_checklist_templates', kind: 'read', module: 'checklists' },
  { name: 'create_checklist', kind: 'write', module: 'checklists' },
  { name: 'save_recipe', kind: 'write', module: 'recipes' },
  { name: 'create_setup_item', kind: 'write', module: 'setup' },
  { name: 'update_setup_item', kind: 'write', module: 'setup' },
  { name: 'find_documents', kind: 'read', module: 'documents' },
  { name: 'get_home_search', kind: 'read', module: 'search' },
  { name: 'get_money_insights', kind: 'read', module: 'money-insights' },
];

export const MCP_TOOL_BY_NAME: Record<string, McpToolMeta> = Object.fromEntries(
  MCP_TOOLS.map((t) => [t.name, t])
);

/** The tools a household's modules allow, in MCP_TOOLS order. */
export function mcpToolsForModules(enabled: ReadonlySet<string>): McpToolMeta[] {
  return MCP_TOOLS.filter((t) => enabled.has(t.module));
}
