// HOUP-84: native port of apps/web/src/components/section-preferences.tsx.
// Web's useSectionSettings() hook (apps/web/src/lib/use-section.ts) leans on
// localStorage mirrors + a same-tab CustomEvent broadcast + a realtime
// channel so every hook instance (notably the sidebar, mounted outside
// DataCacheProvider) stays in sync — none of that applies on native, where
// useDataCache() is already the single shared context every screen reads
// from. Reads/writes default_section + calendar_show_pulled_events_in_todo
// straight off `userSettings` via the same persist-then-refresh upsert
// pattern this ticket's household-settings.tsx/costs-settings.tsx panels use.
import * as React from 'react';
import { View } from 'react-native';
import { History, SlidersHorizontal } from 'lucide-react-native';
import { Button, Text } from '@homeup/ui';
import { SettingsChoiceRow, SettingsInset, SettingsLabel, SettingsPanel, SettingsSwitchRow } from './settings-panel';
import { getEnabledSections, useModules } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { sectionIcons } from '@/lib/section-icons';

async function persistUserSettings(payload: Record<string, unknown>) {
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

export function SectionPreferences() {
  const { userSettings, refresh } = useDataCache();
  const modules = useModules();
  const [selectedDefault, setSelectedDefault] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [savingCalendarToggle, setSavingCalendarToggle] = React.useState(false);
  // Hydrate the radio selection once from the loaded settings row, then this
  // becomes the source of truth for local edits (mirrors household/costs
  // settings' single-hydrate-effect pattern).
  const hydrated = React.useRef(false);

  React.useEffect(() => {
    if (hydrated.current || !userSettings) return;
    hydrated.current = true;
    setSelectedDefault(userSettings.default_section);
  }, [userSettings]);

  const hasChanged = selectedDefault !== (userSettings?.default_section ?? null);
  const showCalendarEventsInTodo = userSettings?.calendar_show_pulled_events_in_todo ?? true;

  const handleSave = async () => {
    setSaving(true);
    try {
      await persistUserSettings({ default_section: selectedDefault });
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCalendarEventsInTodo = async () => {
    setSavingCalendarToggle(true);
    try {
      await persistUserSettings({ calendar_show_pulled_events_in_todo: !showCalendarEventsInTodo });
      await refresh();
    } finally {
      setSavingCalendarToggle(false);
    }
  };

  return (
    <SettingsPanel icon={SlidersHorizontal} title="Section preferences">
      <View className="gap-1.5">
        <SettingsLabel>Open on launch</SettingsLabel>
        {/* H4: the panel owns the one border level; this list is an inset fill. */}
        <SettingsInset accessibilityRole="radiogroup">
          <SettingsChoiceRow
            selected={selectedDefault === null}
            onSelect={() => setSelectedDefault(null)}
            leading={<History size={16} className="text-muted-foreground" />}
            title="Last used"
            description="The section you visited most recently"
          />
          {getEnabledSections(modules.enabled).map((section) => {
            const Icon = sectionIcons[section.iconId];
            return (
              <SettingsChoiceRow
                key={section.id}
                selected={selectedDefault === section.id}
                onSelect={() => setSelectedDefault(section.id)}
                leading={Icon ? <Icon size={16} className="text-muted-foreground" /> : undefined}
                title={section.label}
              />
            );
          })}
        </SettingsInset>
      </View>

      {hasChanged && (
        <Button onPress={handleSave} disabled={saving} size="sm" className="self-start px-4">
          <Text className="text-sm font-medium text-primary-foreground">{saving ? 'Saving…' : 'Save'}</Text>
        </Button>
      )}

      {/* Modules: pulled events need Calendar and Google Calendar (module-features.ts). */}
      {modules.feature('hub.calendar-events') && (
        <SettingsInset>
          <SettingsSwitchRow
            title="Pulled calendar events in to-dos"
            description="Show events pulled from Google Calendar on Home's to-do feed. Events Rooftap pushed to Google are never pulled back."
            checked={showCalendarEventsInTodo}
            onChange={() => void handleToggleCalendarEventsInTodo()}
            disabled={savingCalendarToggle}
          />
        </SettingsInset>
      )}
    </SettingsPanel>
  );
}
