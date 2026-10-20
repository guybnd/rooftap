"use client";

import { useParams, notFound } from "next/navigation";
import { getSection, getEnabledSections, useModules } from "@homeup/core";
import { SettingsContent } from "../settings-content";
import { sectionPanels, globalMenus, visiblePanels } from "../settings-registry";

// Resolves either a global-menu key (users, appearance, notifications,
// integrations) or an enabled app-section id (search, setup, ...) through one
// dynamic segment, so the drawer can link to both with a single href shape.
export default function SettingsKeyPage() {
  const params = useParams<{ key: string }>();
  const key = params.key;
  const modules = useModules();

  const menu = globalMenus.find((m) => m.key === key);
  if (menu) {
    return <SettingsContent panels={visiblePanels(menu.panels, modules.enabled)} emptyLabel={menu.label} />;
  }

  const section = getSection(key);
  // Only enabled sections (module on for this household) get a settings
  // route; anything else 404s.
  if (!section || !getEnabledSections(modules.enabled).some((s) => s.id === key)) {
    notFound();
  }

  return (
    <SettingsContent panels={visiblePanels(sectionPanels[key] ?? [], modules.enabled)} emptyLabel={section.label} />
  );
}
