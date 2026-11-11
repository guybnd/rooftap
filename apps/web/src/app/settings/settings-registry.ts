import type { ComponentType } from "react";
import { CONNECTORS, SETTINGS_TABS, moduleSettingsTabs, type ConnectorPanelId, type ModuleId, type SettingsPanelId, type SettingsTabId } from "@homeup/core";
import { AppearanceSettings } from "@/components/appearance-settings";
import { SectionPreferences } from "@/components/section-preferences";
import { GroupManager } from "@/components/group-manager";
import { HomeProfileSettings } from "@/components/home-profile-settings";
import { NavigationSettings } from "@/components/navigation-settings";
import { NotificationKinds, NotificationsSettings } from "@/components/notifications-settings";
import { CalendarSetup } from "@/components/calendar-setup";
import { BudgetSettings } from "@/components/budget-settings";
import { AppointmentSettings } from "@/components/appointment-settings";
import { SavedSearchesSettings } from "@/components/saved-searches-settings";
import { AgentsManager } from "@/components/agents-manager";
import { PatSettings } from "@/components/pat-settings";
import { AiProvidersSettings } from "@/components/ai-providers-settings";
import { ApiKeysSettings } from "@/components/api-keys-settings";
import { FeedbackInbox } from "@/components/feedback-inbox";
import { HouseholdAiKeys } from "@/components/household-ai-keys";
import { McpSettings } from "@/components/mcp-settings";
import { UsersManager } from "@/components/users-manager";
import { CostsSettings, CostsRecentSettings, CostsSubscriptionsSettings, CostsSummariesSettings } from "@/components/costs-settings";
import { UpBankSettings } from "@/components/up-bank-settings";
import { BankImportSettings } from "@/components/bank-import-settings";
import { GroceriesSettings } from "@/components/groceries-settings";
import { ChecklistsSettings } from "@/components/checklists-settings";
import { HouseholdSettings } from "@/components/household-settings";
import { SetupStoresSettings } from "@/components/setup-stores-settings";
import { ModulesSettings } from "@/components/modules-settings";
import { AssistantHelpers, AssistantMemories, AssistantSettings } from "@/components/assistant-settings";
import { AssistantSpending } from "@/components/assistant-spending";
import { AssistantTelegram } from "@/components/assistant-telegram";
import { AssistantHomeAssistant } from "@/components/assistant-home-assistant";
import { ShopperSettings } from "@/components/shopper-settings";
import { WhatsNewHistory } from "@/components/whats-new";
import { VersionSettings } from "@/components/version-settings";
import { CrashReportsSettings } from "@/components/crash-reports-settings";
import { DeleteAccountSettings } from "@/components/delete-account-settings";

// Every connector's Settings > Connectors panel by its core id (connectors.ts,
// .docs/connectors.md). The Connectors menu lists them in registry order, and
// each shows only while the module it fills is on (PANEL_MODULE below).
const CONNECTOR_PANELS: Record<ConnectorPanelId, ComponentType> = {
  "up-bank": UpBankSettings,
  "bank-import": BankImportSettings,
};

export interface SettingsTab {
  id: SettingsTabId;
  label: string;
  /** Fold each panel to its header row, one open at a time (HOUP-616). */
  fold: boolean;
  panels: ComponentType[];
}

// HOUP-616: Settings opens on these tabs (ids and labels in core
// settings-layout.ts). The phone lists the same panels per tab in
// apps/mobile/src/features/settings/settings-registry.ts.
const TAB_PANELS: Record<SettingsTabId, Pick<SettingsTab, "fold" | "panels">> = {
  you: {
    fold: true,
    panels: [AppearanceSettings, NotificationsSettings, NotificationKinds, NavigationSettings, SectionPreferences, PatSettings, McpSettings],
  },
  house: { fold: false, panels: [GroupManager, UsersManager, HomeProfileSettings] },
  tiles: { fold: false, panels: [ModulesSettings] },
  connected: {
    fold: true,
    panels: [...CONNECTORS.map((c) => CONNECTOR_PANELS[c.panel]), HouseholdAiKeys, AiProvidersSettings, ApiKeysSettings, FeedbackInbox],
  },
  about: { fold: false, panels: [VersionSettings, WhatsNewHistory, CrashReportsSettings, DeleteAccountSettings] },
};

export const settingsTabs: SettingsTab[] = SETTINGS_TABS.map((meta) => ({ ...meta, ...TAB_PANELS[meta.id] }));

// Every module settings panel by its core id (module-settings.ts). The
// Settings page and the module screen's settings sheet both render
// moduleSettingsTabs() through this map, so a module's settings are listed
// once, in core.
export const SETTINGS_PANELS: Record<SettingsPanelId, ComponentType> = {
  "search-budget": BudgetSettings,
  "search-appointments": AppointmentSettings,
  "search-saved": SavedSearchesSettings,
  "search-agents": AgentsManager,
  "setup-stores": SetupStoresSettings,
  "task-defaults": HouseholdSettings,
  "costs-goal": CostsSettings,
  "costs-recent": CostsRecentSettings,
  "costs-subscriptions": CostsSubscriptionsSettings,
  "costs-summaries": CostsSummariesSettings,
  groceries: GroceriesSettings,
  checklists: ChecklistsSettings,
  "google-calendar": CalendarSetup,
  assistant: AssistantSettings,
  "assistant-helpers": AssistantHelpers,
  "assistant-memories": AssistantMemories,
  "assistant-spending": AssistantSpending,
  "assistant-telegram": AssistantTelegram,
  "assistant-home-assistant": AssistantHomeAssistant,
  "shopper-sources": ShopperSettings,
};

/** One tab of a module's settings, ready to render. */
export interface SettingsTabPanels {
  label: string;
  panels: ComponentType[];
}

/** A module's settings as tabs (core moduleSettingsTabs). One unlabelled tab when the module has no tabs. */
export function moduleSettingsTabComponents(id: string, enabled: ReadonlySet<string>): SettingsTabPanels[] {
  return moduleSettingsTabs(id, enabled).map((tab) => ({ label: tab.label, panels: tab.panels.map((panel) => SETTINGS_PANELS[panel]) }));
}

// Modules (.docs/modules.md): a panel for an integration module shows only
// while that module is on. Every other panel follows its section or menu.
const PANEL_MODULE = new Map<ComponentType, ModuleId>([
  [McpSettings, "mcp"],
  ...CONNECTORS.map((c): [ComponentType, ModuleId] => [CONNECTOR_PANELS[c.panel], c.module]),
]);

/** The panels to show for this household's modules. */
export function visiblePanels(panels: ComponentType[], enabled: ReadonlySet<string>): ComponentType[] {
  return panels.filter((panel) => {
    const moduleId = PANEL_MODULE.get(panel);
    return !moduleId || enabled.has(moduleId);
  });
}
