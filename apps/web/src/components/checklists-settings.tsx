"use client";

// HOUP-327: account-wide checklist defaults — sink completed items to a
// collapsible band (default on), start that band collapsed (default off),
// and a default sort mode. Persist-then-refresh upsert exactly like
// apps/web/src/components/costs-settings.tsx; applies live, no Save (M4).
// Each list can still override these on this device from its own header menu
// (use-checklist-view-prefs.ts) — these are just the starting point.
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsInset, SettingsLabel, SettingsPanel, SettingsSwitchRow } from "@/components/settings-panel";
import { CHECKLIST_SORT_MODES, CHECKLIST_SORT_LABELS, type ChecklistSortMode } from "@homeup/core";
import { ListChecks } from "lucide-react";

// F: four segments share a phone-width row, so the long "Recently checked"
// label is shortened here (the list's own sort menu keeps the full label).
const SORT_OPTIONS = CHECKLIST_SORT_MODES.map((mode) => ({
  value: mode,
  label: mode === "recent" ? "Recent" : CHECKLIST_SORT_LABELS[mode],
}));

async function persist(payload: Record<string, unknown>) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("user_settings")
    .upsert(
      { user_id: user.id, updated_at: new Date().toISOString(), ...payload },
      { onConflict: "user_id" },
    );
}

export function ChecklistsSettings() {
  const { userSettings, refresh } = useDataCache();

  const completedToBottom = userSettings?.checklists_completed_to_bottom ?? true;
  const collapseCompleted = userSettings?.checklists_collapse_completed ?? false;
  const defaultSort = (userSettings?.checklists_default_sort as ChecklistSortMode | null) ?? "manual";

  const toggleCompletedToBottom = async (on: boolean) => {
    await persist({ checklists_completed_to_bottom: on });
    await refresh();
  };

  const toggleCollapseCompleted = async (on: boolean) => {
    await persist({ checklists_collapse_completed: on });
    await refresh();
  };

  const changeDefaultSort = async (mode: ChecklistSortMode) => {
    await persist({ checklists_default_sort: mode });
    await refresh();
  };

  return (
    <SettingsPanel
      icon={ListChecks}
      title="Checklists"
      description="Your defaults on every device. Each list can override them from its own menu."
    >
      <SettingsInset>
        <SettingsSwitchRow
          title="Completed items sink to the bottom"
          checked={completedToBottom}
          onChange={toggleCompletedToBottom}
        />
        <SettingsSwitchRow
          title="Collapse completed by default"
          checked={collapseCompleted}
          onChange={toggleCollapseCompleted}
        />
      </SettingsInset>
      <div className="space-y-1.5">
        <SettingsLabel>Default sort</SettingsLabel>
        <SegmentedControl
          ariaLabel="Default sort"
          options={SORT_OPTIONS}
          value={defaultSort}
          onChange={changeDefaultSort}
        />
      </div>
    </SettingsPanel>
  );
}
