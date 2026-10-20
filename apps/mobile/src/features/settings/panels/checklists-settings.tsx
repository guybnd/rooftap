// HOUP-327: account-wide checklist defaults — sink completed items to a
// collapsible band (default on), start that band collapsed (default off),
// and a default sort mode. Persist-then-refresh upsert exactly like
// apps/mobile/src/features/settings/panels/costs-settings.tsx and
// section-preferences.tsx; applies live, no Save (M4). Each list can still
// override these on this device from its own header menu
// (use-checklist-view-prefs.ts) — these are just the starting point.
import * as React from 'react';
import { View } from 'react-native';
import { ListChecks } from 'lucide-react-native';
import { SegmentedControl } from '@homeup/ui';
import { CHECKLIST_SORT_MODES, CHECKLIST_SORT_LABELS, type ChecklistSortMode } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { SettingsInset, SettingsLabel, SettingsPanel, SettingsSwitchRow } from './settings-panel';

// Four short labels fit one row at phone width (F): "Recently checked" is
// the only long one, so it reads "Recent" here.
const SORT_OPTIONS = CHECKLIST_SORT_MODES.map((mode) => ({
  value: mode,
  label: mode === 'recent' ? 'Recent' : CHECKLIST_SORT_LABELS[mode],
}));

async function persist(payload: Record<string, unknown>) {
  try {
    const supabase = getCurrentSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, updated_at: new Date().toISOString(), ...payload }, { onConflict: 'user_id' });
  } catch {
    // Offline, or the client isn't bound yet — local state already reflects
    // the change; the next successful edit will persist it.
  }
}

export function ChecklistsSettings() {
  const { userSettings, refresh } = useDataCache();

  const completedToBottom = userSettings?.checklists_completed_to_bottom ?? true;
  const collapseCompleted = userSettings?.checklists_collapse_completed ?? false;
  const defaultSort = (userSettings?.checklists_default_sort as ChecklistSortMode | null) ?? 'manual';

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
      <View className="gap-1.5">
        <SettingsLabel>Default sort</SettingsLabel>
        <SegmentedControl
          accessibilityLabel="Default sort"
          options={SORT_OPTIONS}
          value={defaultSort}
          onChange={changeDefaultSort}
        />
      </View>
    </SettingsPanel>
  );
}
