import type { ModuleId } from './modules';
import { REACH_REASONS, type Reach } from './module-manifest';
import { ALL_MANIFESTS } from './module-manifests';

// What the Assistant (and any MCP client) can reach, written down for every
// module and every database table. A feature that adds a module or a table
// says here how the Assistant reaches it: the household tools that read or
// change it (MCP_TOOLS names), or one line on why it has none.
// apps/web/src/lib/assistant-reach.test.ts fails while a module or a table in
// supabase/migrations is missing, a tool name is unknown, or a module listed
// as having no tools has gained some (.docs/modules.md, section 14).

export type { Reach } from './module-manifest';

/** Modules with no household tool of their own, and why (each manifest's `noTools`). Every other module needs at least one. */
export const MODULES_WITHOUT_TOOLS: Partial<Record<ModuleId, string>> = Object.fromEntries(
  ALL_MANIFESTS.flatMap((m) => (m.noTools ? [[m.id, m.noTools]] : [])),
);

const { server: SERVER, account: ACCOUNT } = REACH_REASONS;

/** Tables that belong to no module: the household, accounts and server bookkeeping. */
const PLATFORM_TABLES: Record<string, Reach> = {
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
};

/** Every table in supabase/migrations: the platform's, then each manifest's `tables`. */
export const TABLE_REACH: Record<string, Reach> = {
  ...PLATFORM_TABLES,
  ...Object.fromEntries(ALL_MANIFESTS.flatMap((m) => Object.entries(m.tables ?? {}).map(([table, t]) => [table, t.reach]))),
};
