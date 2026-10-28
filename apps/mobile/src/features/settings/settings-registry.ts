// HOUP-84: native counterpart of apps/web's settings/settings-registry.ts —
// same two-structure shape (global menus + section-keyed panel lists), but
// its own component refs (Decision 4: this stays app-level, NOT
// @homeup/core, since core is guarded lucide/component-free by
// packages/core/scripts/check-import-boundary.mjs and this map holds live
// component refs).
import type { ComponentType } from 'react';
import { CONNECTORS, moduleSettingsPanels, type ConnectorPanelId, type ModuleId, type SettingsPanelId } from '@homeup/core';
import { AppearanceSettings, HapticsSettings, MotionSettings } from './panels/appearance-settings';
import { SectionPreferences } from './panels/section-preferences';
import { HomeProfileSettings } from './panels/home-profile-settings';
import { NavigationSettings } from './panels/navigation-settings';
import { ModulesSettings } from './panels/modules-settings';
import { AssistantSettings } from './panels/assistant-settings';
import { AssistantSpending } from './panels/assistant-spending';
import { AssistantTelegram } from './panels/assistant-telegram';
import { AssistantHomeAssistant } from './panels/assistant-home-assistant';
import { NotificationKinds, NotificationsSettings } from './panels/notifications-settings';
import { AiProvidersSettings } from './panels/ai-providers-settings';
import { ApiKeysSettings } from './panels/api-keys-settings';
import { FeedbackInbox } from './panels/feedback-inbox';
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
import { CostsSettings, CostsRecentSettings, CostsSubscriptionsSettings, CostsSummariesSettings } from './panels/costs-settings';
import { UpBankSettings } from './panels/up-bank-settings';
import { BankImportSettings } from './panels/bank-import-settings';
import { GroceriesSettings } from './panels/groceries-settings';
import { ChecklistsSettings } from './panels/checklists-settings';
import { CalendarSetup } from './panels/calendar-setup';
import { AppUpdates } from './panels/app-updates';
import { ShopperSettings } from './panels/shopper-settings';

// Every connector's Settings > Connectors panel by its core id (connectors.ts,
// .docs/connectors.md). The Connectors menu lists them in registry order, and
// each shows only while the module it fills is on (PANEL_MODULE below).
const CONNECTOR_PANELS: Record<ConnectorPanelId, ComponentType> = {
  'up-bank': UpBankSettings,
  'bank-import': BankImportSettings,
};

export interface GlobalMenu {
  key: string;
  label: string;
  panels: ComponentType[];
}

export const globalMenus: GlobalMenu[] = [
  { key: 'global', label: 'Global settings', panels: [SectionPreferences, HomeProfileSettings, NavigationSettings] },
  { key: 'modules', label: 'Modules', panels: [ModulesSettings] },
  { key: 'users', label: 'Users', panels: [GroupManager, UsersManager] },
  { key: 'appearance', label: 'Appearance', panels: [AppearanceSettings, MotionSettings, HapticsSettings] },
  { key: 'notifications', label: 'Notifications', panels: [NotificationsSettings, NotificationKinds] },
  { key: 'connectors', label: 'Connectors', panels: CONNECTORS.map((c) => CONNECTOR_PANELS[c.panel]) },
  { key: 'integrations', label: 'Integrations & keys', panels: [HouseholdAiKeys, AiProvidersSettings, ApiKeysSettings, FeedbackInbox, PatSettings, McpSettings] },
  { key: 'about', label: 'About & updates', panels: [AppUpdates] },
];

// Every module settings panel by its core id (module-settings.ts). The
// Settings page and the module screen's settings sheet both render
// moduleSettingsPanels() through this map, so a module's settings are listed
// once, in core.
export const SETTINGS_PANELS: Record<SettingsPanelId, ComponentType> = {
  'search-budget': BudgetSettings,
  'search-appointments': AppointmentSettings,
  'search-saved': SavedSearchesSettings,
  'search-agents': AgentsManager,
  'setup-stores': SetupStoresSettings,
  'task-defaults': HouseholdSettings,
  'costs-goal': CostsSettings,
  'costs-recent': CostsRecentSettings,
  'costs-subscriptions': CostsSubscriptionsSettings,
  'costs-summaries': CostsSummariesSettings,
  groceries: GroceriesSettings,
  checklists: ChecklistsSettings,
  'google-calendar': CalendarSetup,
  assistant: AssistantSettings,
  'assistant-spending': AssistantSpending,
  'assistant-telegram': AssistantTelegram,
  'assistant-home-assistant': AssistantHomeAssistant,
  'shopper-sources': ShopperSettings,
};

/** A module's settings panels for this household, ready to render. */
export function moduleSettingsComponents(id: string, enabled: ReadonlySet<string>): ComponentType[] {
  return moduleSettingsPanels(id, enabled).map((panel) => SETTINGS_PANELS[panel]);
}

// Modules (.docs/modules.md): a panel for an integration module shows only
// while that module is on. Every other panel follows its section or menu.
const PANEL_MODULE = new Map<ComponentType, ModuleId>([
  [McpSettings, 'mcp'],
  ...CONNECTORS.map((c): [ComponentType, ModuleId] => [CONNECTOR_PANELS[c.panel], c.module]),
]);

/** The panels to show for this household's modules. */
export function visiblePanels(panels: ComponentType[], enabled: ReadonlySet<string>): ComponentType[] {
  return panels.filter((panel) => {
    const moduleId = PANEL_MODULE.get(panel);
    return !moduleId || enabled.has(moduleId);
  });
}
