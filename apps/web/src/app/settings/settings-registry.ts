import type { ComponentType } from "react";
import type { ModuleId } from "@homeup/core";
import { AppearanceSettings } from "@/components/appearance-settings";
import { SectionPreferences } from "@/components/section-preferences";
import { GroupManager } from "@/components/group-manager";
import { HomeProfileSettings } from "@/components/home-profile-settings";
import { NavigationSettings } from "@/components/navigation-settings";
import { NotificationsSettings } from "@/components/notifications-settings";
import { CalendarSetup } from "@/components/calendar-setup";
import { BudgetSettings } from "@/components/budget-settings";
import { AppointmentSettings } from "@/components/appointment-settings";
import { SavedSearchesSettings } from "@/components/saved-searches-settings";
import { AgentsManager } from "@/components/agents-manager";
import { PatSettings } from "@/components/pat-settings";
import { ApiKeysSettings } from "@/components/api-keys-settings";
import { McpSettings } from "@/components/mcp-settings";
import { UsersManager } from "@/components/users-manager";
import { CostsSettings } from "@/components/costs-settings";
import { GroceriesSettings } from "@/components/groceries-settings";
import { ChecklistsSettings } from "@/components/checklists-settings";
import { HouseholdSettings } from "@/components/household-settings";
import { SetupStoresSettings } from "@/components/setup-stores-settings";
import { ModulesSettings } from "@/components/modules-settings";

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
  { key: "notifications", label: "Notifications", panels: [NotificationsSettings] },
  { key: "integrations", label: "Integrations & keys", panels: [ApiKeysSettings, PatSettings, McpSettings] },
];

// Per-section tabs. Adding a future panel/section is a single edit here (AC#7).
export const sectionPanels: Record<string, ComponentType[]> = {
  search: [BudgetSettings, AppointmentSettings, SavedSearchesSettings, AgentsManager],
  setup: [SetupStoresSettings],
  household: [HouseholdSettings],
  costs: [CostsSettings],
  groceries: [GroceriesSettings],
  checklists: [ChecklistsSettings],
  calendar: [CalendarSetup],
};

// Modules (.docs/modules.md): a panel for an integration module shows only
// while that module is on. Every other panel follows its section or menu.
const PANEL_MODULE = new Map<ComponentType, ModuleId>([
  [CalendarSetup, "google-calendar"],
  [McpSettings, "mcp"],
]);

/** The panels to show for this household's modules. */
export function visiblePanels(panels: ComponentType[], enabled: ReadonlySet<string>): ComponentType[] {
  return panels.filter((panel) => {
    const moduleId = PANEL_MODULE.get(panel);
    return !moduleId || enabled.has(moduleId);
  });
}
