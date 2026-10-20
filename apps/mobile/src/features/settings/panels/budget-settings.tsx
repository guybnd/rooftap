// HOUP-84: native port of apps/web's budget-settings.tsx — weekly rent
// budget range (min/max), debounce-saved to user_settings.rent_min/rent_max.
// No native consumer of these columns exists yet (Home Search is still a
// Phase 2 placeholder, see apps/mobile/src/app/(tabs)/homesearch/index.tsx), but
// persisting them here already unblocks that screen's apartment-card
// color-coding once it ships — settings and its downstream consumer commonly
// land as separate tickets on native, unlike web where one page owns both.
import * as React from 'react';
import { View } from 'react-native';
import { Banknote } from 'lucide-react-native';
import { Text, FieldRow, FormSection, Input } from '@homeup/ui';
import { householdCurrency } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { SavingHint, SettingsPanel } from './settings-panel';

export function BudgetSettings() {
  const { userSettings, group, refresh } = useDataCache();
  const currencyCode = householdCurrency(group);
  const [min, setMin] = React.useState('');
  const [max, setMax] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    setMin(userSettings?.rent_min?.toString() ?? '');
    setMax(userSettings?.rent_max?.toString() ?? '');
  }, [userSettings]);

  const save = (rentMin: string, rentMax: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
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
            rent_min: rentMin ? parseInt(rentMin, 10) : null,
            rent_max: rentMax ? parseInt(rentMax, 10) : null,
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

  const handleMinChange = (val: string) => {
    setMin(val);
    save(val, max);
  };

  const handleMaxChange = (val: string) => {
    setMax(val);
    save(min, val);
  };

  return (
    <SettingsPanel
      icon={Banknote}
      title="Rent budget"
      description="Listings are tinted by where their weekly rent sits in this range."
    >
      <FormSection>
        <FieldRow label="Weekly rent" hint={`In ${currencyCode} per week`}>
          <View className="flex-row items-center gap-2">
            <Input
              keyboardType="number-pad"
              placeholder="Min"
              accessibilityLabel="Minimum weekly rent"
              value={min}
              onChangeText={handleMinChange}
              className="h-9 min-w-0 flex-1 tabular-nums"
            />
            <Text className="text-sm text-muted-foreground">to</Text>
            <Input
              keyboardType="number-pad"
              placeholder="Max"
              accessibilityLabel="Maximum weekly rent"
              value={max}
              onChangeText={handleMaxChange}
              className="h-9 min-w-0 flex-1 tabular-nums"
            />
          </View>
        </FieldRow>
      </FormSection>
      <SavingHint show={saving} />
    </SettingsPanel>
  );
}
