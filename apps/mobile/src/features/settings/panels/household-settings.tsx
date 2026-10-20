// HOUP-84: native port of apps/web's household-settings.tsx (FLUX-65) —
// default reminder lead time (days), debounce-saved to
// user_settings.reminder_lead_days. No native household-tasks/document-expiry
// reminder consumer reads this column yet (apps/mobile/src/app/setup is still
// a Phase 2 placeholder), but persisting it here already unblocks that screen
// once it ships.
import * as React from 'react';
import { View } from 'react-native';
import { BellRing } from 'lucide-react-native';
import { Text, FieldRow, FormSection, Input } from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { DEFAULT_UPCOMING_WINDOW_DAYS } from '@homeup/core';
import { SavingHint, SettingsPanel } from './settings-panel';

const DEFAULT_LEAD_DAYS = 14;

type DaysColumn = 'reminder_lead_days' | 'tasks_upcoming_days';

/** A whole-days user_settings field edited as text and debounce-saved. */
function useDaysSetting(column: DaysColumn, fallback: number, min: number) {
  const { userSettings, refresh } = useDataCache();
  const [days, setDays] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const v = userSettings?.[column];
    setDays(v != null ? v.toString() : fallback.toString());
  }, [userSettings, column, fallback]);

  const changeDays = (val: string) => {
    setDays(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      const parsed = val ? Math.max(min, Math.round(Number(val))) : fallback;
      try {
        const supabase = getCurrentSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        await supabase.from('user_settings').upsert(
          { user_id: user.id, [column]: parsed, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
        await refresh();
      } catch {
        // Offline, or the client isn't bound yet — local state already
        // reflects the change; the next successful edit will persist it.
      } finally {
        setSaving(false);
      }
    }, 800);
  };

  return { days, saving, changeDays };
}

export function HouseholdSettings() {
  const lead = useDaysSetting('reminder_lead_days', DEFAULT_LEAD_DAYS, 0);
  const upcoming = useDaysSetting('tasks_upcoming_days', DEFAULT_UPCOMING_WINDOW_DAYS, 1);

  return (
    <SettingsPanel icon={BellRing} title="Task defaults">
      <FormSection>
        <FieldRow
          label="Reminder lead time"
          hint="How far ahead task and document-expiry reminders are set by default"
        >
          <DaysInput label="Reminder lead time" value={lead.days} onChange={lead.changeDays} />
        </FieldRow>
        <FieldRow
          label="Upcoming window"
          hint="How far ahead Home's Upcoming view looks. On Tasks, anything later sits under Later."
        >
          <DaysInput label="Upcoming window" value={upcoming.days} onChange={upcoming.changeDays} />
        </FieldRow>
      </FormSection>
      <SavingHint show={lead.saving || upcoming.saving} />
    </SettingsPanel>
  );
}

function DaysInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <View className="flex-row items-center gap-2">
      <Input
        keyboardType="number-pad"
        value={value}
        onChangeText={onChange}
        accessibilityLabel={`${label} in days`}
        className="h-9 w-24 tabular-nums"
      />
      <Text className="text-sm text-muted-foreground">days</Text>
    </View>
  );
}
