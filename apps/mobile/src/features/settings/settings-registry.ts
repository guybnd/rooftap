// HOUP-84: native counterpart of apps/web's settings/settings-registry.ts —
// same two-structure shape (global menus + section-keyed panel lists), but
// its own component refs (Decision 4: this stays app-level, NOT
// @homeup/core, since core is guarded lucide/component-free by
// packages/core/scripts/check-import-boundary.mjs and this map holds live
// component refs).
import type { ComponentType } from 'react';
import type { ModuleId } from '@homeup/core';
import { AppearanceSettings, HapticsSettings } from './panels/appearance-settings';
import { SectionPreferences } from './panels/section-preferences';
import { HomeProfileSettings } from './panels/home-profile-settings';
import { NavigationSettings } from './panels/navigation-settings';
import { ModulesSettings } from './panels/modules-settings';
import { AssistantSettings } from './panels/assistant-settings';
import { AssistantSpending } from './panels/assistant-spending';
import { NotificationsSettings } from './panels/notifications-settings';
import { ApiKeysSettings } from './panels/api-keys-settings';
import { HouseholdAiKeys } from './panels/household-ai-keys';
import { PatSettings } from './panels/pat-settings';
import { McpSettings } from './panels/mcp-settings';
import { GroupManager } from './panels/group-manager';
import { UsersManager } from './panels/users-manager';
import { BudgetSettings } from './panels/budget-settings';
import { AppointmentSettings } from './panels/appointment-settings';
import { SavedSearchesSettings } from './panels/saved-searches-settings';
import { AgentsManager } from './panels/agents-manager';
import { SetupStoresSettings } from './panels/setup-stores-settings';
import { HouseholdSettings } from './panels/household-settings';
import { CostsSettings } from './panels/costs-settings';
import { GroceriesSettings } from './panels/groceries-settings';
import { ChecklistsSettings } from './panels/checklists-settings';
import { CalendarSetup } from './panels/calendar-setup';
import { AppUpdates } from './panels/app-updates';
import { ShopperSettings } from './panels/shopper-settings';

export interface GlobalMenu {
  key: string;
  label: string;
  panels: ComponentType[];
}

export const globalMenus: GlobalMenu[] = [
  { key: 'global', label: 'Global settings', panels: [SectionPreferences, HomeProfileSettings, NavigationSettings] },
  { key: 'modules', label: 'Modules', panels: [ModulesSettings] },
  { key: 'users', label: 'Users', panels: [GroupManager, UsersManager] },
  { key: 'appearance', label: 'Appearance', panels: [AppearanceSettings, HapticsSettings] },
  { key: 'notifications', label: 'Notifications', panels: [NotificationsSettings] },
  { key: 'integrations', label: 'Integrations & keys', panels: [HouseholdAiKeys, ApiKeysSettings, PatSettings, McpSettings] },
  { key: 'about', label: 'About & updates', panels: [AppUpdates] },
];

export const sectionPanels: Record<string, ComponentType[]> = {
  search: [BudgetSettings, AppointmentSettings, SavedSearchesSettings, AgentsManager],
  setup: [SetupStoresSettings],
  household: [HouseholdSettings],
  costs: [CostsSettings],
  groceries: [GroceriesSettings],
  checklists: [ChecklistsSettings],
  calendar: [CalendarSetup],
  assistant: [AssistantSettings, AssistantSpending],
  shopper: [ShopperSettings],
};

// Modules (.docs/modules.md): a panel for an integration module shows only
// while that module is on. Every other panel follows its section or menu.
const PANEL_MODULE = new Map<ComponentType, ModuleId>([
  [CalendarSetup, 'google-calendar'],
  [McpSettings, 'mcp'],
]);

/** The panels to show for this household's modules. */
export function visiblePanels(panels: ComponentType[], enabled: ReadonlySet<string>): ComponentType[] {
  return panels.filter((panel) => {
    const moduleId = PANEL_MODULE.get(panel);
    return !moduleId || enabled.has(moduleId);
  });
}
