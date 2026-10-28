// Module settings, one list per module (.docs/modules.md section 16). Each
// module's settings are defined here once and shown through two doors that
// render the same panels: Settings > <module> as a page, and the module
// screen's More menu, whose last row opens them as a sheet. A setting lives
// in this list and nowhere else, so a screen never grows its own copy.
//
// Panels are named by id. Each app maps every id to its component
// (apps/*/settings-registry.ts, typed against SettingsPanelId so a panel can't
// be missing on one platform).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModuleId } from './modules';
import { ALL_MANIFESTS } from './module-manifests';
import type { UserSettings } from './types';

export type SettingsPanelId =
  | 'search-budget'
  | 'search-appointments'
  | 'search-saved'
  | 'search-agents'
  | 'setup-stores'
  | 'task-defaults'
  | 'costs-goal'
  | 'costs-recent'
  | 'costs-subscriptions'
  | 'costs-summaries'
  | 'groceries'
  | 'checklists'
  | 'google-calendar'
  | 'assistant'
  | 'assistant-spending'
  | 'assistant-telegram'
  | 'assistant-home-assistant'
  | 'shopper-sources';

/** Each module's settings panels, in the order both doors show them, from each manifest's `settings`. Keyed by module (section) id. */
export const MODULE_SETTINGS: Partial<Record<ModuleId, readonly SettingsPanelId[]>> = Object.fromEntries(
  ALL_MANIFESTS.flatMap((m) => (m.settings ? [[m.id, m.settings]] : [])),
);

/** A panel that belongs to another module shows only while that module is on. */
const PANEL_MODULE: Partial<Record<SettingsPanelId, ModuleId>> = {
  'google-calendar': 'google-calendar',
};

/** The settings panels a module shows for this household's modules (empty when it has none). */
export function moduleSettingsPanels(id: string, enabled: ReadonlySet<string>): SettingsPanelId[] {
  return (MODULE_SETTINGS[id as ModuleId] ?? []).filter((panel) => {
    const owner = PANEL_MODULE[panel];
    return !owner || enabled.has(owner);
  });
}

/** True when the module has settings, so its screen's More menu ends with a settings row. */
export function hasModuleSettings(id: string, enabled: ReadonlySet<string>): boolean {
  return moduleSettingsPanels(id, enabled).length > 0;
}

/** The row and sheet title: "Costs settings". */
export function moduleSettingsTitle(label: string): string {
  return `${label} settings`;
}

/** Saves part of this person's user_settings row. Offline or signed out it does nothing; callers keep their local value. */
export async function saveUserSettings(supabase: SupabaseClient, patch: Partial<UserSettings>): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, updated_at: new Date().toISOString(), ...patch }, { onConflict: 'user_id' });
    return !error;
  } catch {
    return false;
  }
}
