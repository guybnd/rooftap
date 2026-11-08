"use client";

// A module's settings split into tabs (core moduleSettingsTabs). The tab row
// scrolls sideways when the labels don't fit, and only the picked tab's
// panels render. Settings > <module> and the module's settings sheet both
// show it. Native twin: apps/mobile/src/features/settings/settings-tabs.tsx.

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { SettingsTabPanels } from "@/app/settings/settings-registry";

export function SettingsTabs({ tabs, ariaLabel }: { tabs: SettingsTabPanels[]; ariaLabel?: string }) {
  const [picked, setPicked] = useState(tabs[0]?.label ?? "");
  const current = tabs.find((t) => t.label === picked) ?? tabs[0];
  if (!current) return null;
  if (tabs.length < 2) {
    return (
      <>
        {current.panels.map((Panel, i) => (
          <Panel key={i} />
        ))}
      </>
    );
  }
  return (
    <>
      <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
        <SegmentedControl
          ariaLabel={ariaLabel ?? "Settings tabs"}
          value={current.label}
          options={tabs.map((t) => ({ value: t.label, label: t.label }))}
          onChange={setPicked}
          className="min-w-max"
        />
      </div>
      <div key={current.label} className="space-y-6">
        {current.panels.map((Panel, i) => (
          <Panel key={i} />
        ))}
      </div>
    </>
  );
}
