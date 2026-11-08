"use client";

import Link from "next/link";
import { useParams, notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getSection, getEnabledSections, settingsTabForKey, useModules } from "@homeup/core";
import { SettingsContent } from "../settings-content";
import { SettingsHome } from "../settings-home";
import { moduleSettingsTabComponents } from "../settings-registry";

// One dynamic segment for both kinds of settings page: a Settings tab (or an
// old menu key such as "integrations", core settingsTabForKey) opens
// Settings on that tab (HOUP-616); an enabled section's id opens that
// module's settings, reached from the Tiles tab.
export default function SettingsKeyPage() {
  const params = useParams<{ key: string }>();
  const key = params.key;
  const modules = useModules();

  const tab = settingsTabForKey(key);
  if (tab) return <SettingsHome tab={tab} />;

  const section = getSection(key);
  // Only enabled sections (module on for this household) get a settings
  // route; anything else 404s.
  if (!section || !getEnabledSections(modules.enabled).some((s) => s.id === key)) {
    notFound();
  }

  return (
    <SettingsContent
      lede={
        <div className="space-y-1 md:hidden">
          <Link href="/settings/tiles" className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ChevronLeft aria-hidden className="size-4" />
            Tiles
          </Link>
          <h1 className="px-1 font-heading text-2xl font-semibold">{section.label}</h1>
        </div>
      }
      tabs={moduleSettingsTabComponents(key, modules.enabled)}
      emptyLabel={section.label}
    />
  );
}
