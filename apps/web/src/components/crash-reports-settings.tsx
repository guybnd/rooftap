"use client";

// Settings > About & updates > Crash reports: this browser's switch for the
// error screen's automatic reports (core crash-report-device.ts). On until
// switched off. Native twin:
// apps/mobile/src/features/settings/panels/crash-reports-settings.tsx.

import { Bug } from "lucide-react";
import { CRASH_REPORTS_SETTING, useCrashReportsEnabled } from "@homeup/core";
import { SettingsInset, SettingsPanel, SettingsSwitchRow } from "@/components/settings-panel";

export function CrashReportsSettings() {
  const [on, setOn] = useCrashReportsEnabled();
  return (
    <SettingsPanel icon={Bug} title={CRASH_REPORTS_SETTING.panel}>
      <SettingsInset>
        <SettingsSwitchRow
          title={CRASH_REPORTS_SETTING.title}
          description={CRASH_REPORTS_SETTING.description}
          checked={on}
          onChange={setOn}
        />
      </SettingsInset>
    </SettingsPanel>
  );
}
