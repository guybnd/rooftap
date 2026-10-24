import type { ComponentType } from "react";
import { moduleSettingsPanels, type ModuleId, type SettingsPanelId } from "@homeup/core";
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
import { GroceriesSettings } from "@/components/groceries-settings";
import { ChecklistsSettings } from "@/components/checklists-settings";
import { HouseholdSettings } from "@/components/household-settings";
import { SetupStoresSettings } from "@/components/setup-stores-settings";
import { ModulesSettings } from "@/components/modules-settings";
import { AssistantSettings } from "@/components/assistant-settings";
import { AssistantSpending } from "@/components/assistant-spending";
import { AssistantTelegram } from "@/components/assistant-telegram";
import { AssistantHomeAssistant } from "@/components/assistant-home-assistant";
import { ShopperSettings } from "@/components/shopper-settings";
import { WhatsNewHistory } from "@/components/whats-new";
import { VersionSettings } from "@/components/version-settings";

export interface GlobalMenu {
  key: string;
  label: string;
  panels: ComponentType[];
}

// HOUP-42: the flat 10-panel global stack, regrouped into 5 named menus reached
// through the settings drawer. "global" is first — it's the default landing.
export const globalMenus: GlobalMenu[] = [
  { key: "global", label: "Global settings", panels: [SectionPreferences, HomeProfileSettings, NavigationSettings] },
  { key: "modules", label: "Modules", panels: [ModulesSettings] },
  { key: "users", label: "Users", panels: [GroupManager, UsersManager] },
  { key: "appearance", label: "Appearance", panels: [AppearanceSettings] },
  { key: "notifications", label: "Notifications", panels: [NotificationsSettings, NotificationKinds] },
  { key: "connectors", label: "Connectors", panels: [UpBankSettings] },
  { key: "integrations", label: "Integrations & keys", panels: [HouseholdAiKeys, AiProvidersSettings, ApiKeysSettings, FeedbackInbox, PatSettings, McpSettings] },
  { key: "whats-new", label: "About & updates", panels: [VersionSettings, WhatsNewHistory] },
];

// Every module settings panel by its core id (module-settings.ts). The
// Settings page and the module screen's settings sheet both render
// moduleSettingsPanels() through this map, so a module's settings are listed
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
  "assistant-spending": AssistantSpending,
  "assistant-telegram": AssistantTelegram,
  "assistant-home-assistant": AssistantHomeAssistant,
  "shopper-sources": ShopperSettings,
};

/** A module's settings panels for this household, ready to render. */
export function moduleSettingsComponents(id: string, enabled: ReadonlySet<string>): ComponentType[] {
  return moduleSettingsPanels(id, enabled).map((panel) => SETTINGS_PANELS[panel]);
}

// Modules (.docs/modules.md): a panel for an integration module shows only
// while that module is on. Every other panel follows its section or menu.
const PANEL_MODULE = new Map<ComponentType, ModuleId>([
  [McpSettings, "mcp"],
]);

/** The panels to show for this household's modules. */
export function visiblePanels(panels: ComponentType[], enabled: ReadonlySet<string>): ComponentType[] {
  return panels.filter((panel) => {
    const moduleId = PANEL_MODULE.get(panel);
    return !moduleId || enabled.has(moduleId);
  });
}
