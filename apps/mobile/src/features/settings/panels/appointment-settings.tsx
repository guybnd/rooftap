// HOUP-84: native port of apps/web's appointment-settings.tsx — default
// viewing duration (minutes), debounce-saved to
// user_settings.appointment_duration_minutes. This is the same column the
// native Appointments screen (HOUP-81, apps/mobile/src/app/appointments)
// already reads via useDataCache().userSettings — no new plumbing needed
// for that screen to pick up an edit made here.
import * as React from 'react';
import { View } from 'react-native';
import { Clock } from 'lucide-react-native';
import { Text, FieldRow, FormSection, Input } from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { SavingHint, SettingsPanel } from './settings-panel';

export function AppointmentSettings() {
  const { userSettings, refresh } = useDataCache();
  const [duration, setDuration] = React.useState('20');
  const [saving, setSaving] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    setDuration((userSettings?.appointment_duration_minutes ?? 20).toString());
  }, [userSettings]);

  const save = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const parsed = parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed < 1 || parsed > 180) return;

      setSaving(true);
      try {
        const supabase = getCurrentSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        await supabase.from('user_settings').upsert(
          {
            user_id: user.id,
            appointment_duration_minutes: parsed,
            updated_at: new Date().toISOString(),
          },
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

  const handleChange = (val: string) => {
    setDuration(val);
    save(val);
  };

  return (
    <SettingsPanel icon={Clock} title="Appointments">
      <FormSection>
        <FieldRow label="Viewing length" hint="Used to time travel between viewings and check an itinerary fits the day">
          <View className="flex-row items-center gap-2">
            <Input
              keyboardType="number-pad"
              placeholder="20"
              value={duration}
              onChangeText={handleChange}
              accessibilityLabel="Viewing length in minutes"
              className="h-9 w-24 tabular-nums"
            />
            <Text className="text-sm text-muted-foreground">min</Text>
          </View>
        </FieldRow>
      </FormSection>
      <SavingHint show={saving} />
    </SettingsPanel>
  );
}
