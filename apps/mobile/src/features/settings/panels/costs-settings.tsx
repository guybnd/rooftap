// HOUP-84: native port of apps/web's costs-settings.tsx (FLUX-65) — default
// time period + monthly budget target, synced via user_settings
// (costs_period, costs_budget_monthly in cents — same columns apps/mobile's
// native Costs screen, apps/mobile/src/app/(tabs)/costs/index.tsx, already reads on
// its own hydrate-once effect and edits inline from its budget-meter card).
// Editing here and there both write the same columns, so either surface's
// edit is picked up by the other on next mount/refresh — reuses @homeup/core's
// Period/PERIOD_LABEL verbatim (HOUP-73/HOUP-82) rather than re-declaring them.
import * as React from 'react';
import { View } from 'react-native';
import { Wallet } from 'lucide-react-native';
import { Text, FieldRow, FormSection, Input, SegmentedControl } from '@homeup/ui';
import { PERIOD_LABEL, householdCurrency, type Period } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { SavingHint, SettingsPanel } from './settings-panel';

const PERIODS: Period[] = ['weekly', 'monthly', 'yearly'];

export function CostsSettings() {
  const { userSettings, group, refresh } = useDataCache();
  const currencyCode = householdCurrency(group);
  const [budget, setBudget] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const period: Period = (userSettings?.costs_period as Period | undefined) ?? 'monthly';

  React.useEffect(() => {
    const cents = userSettings?.costs_budget_monthly;
    setBudget(cents != null ? (cents / 100).toString() : '');
  }, [userSettings]);

  const persist = async (payload: Record<string, unknown>) => {
    try {
      const supabase = getCurrentSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, updated_at: new Date().toISOString(), ...payload }, { onConflict: 'user_id' });
      await refresh();
    } catch {
      // Offline, or the client isn't bound yet — local state already
      // reflects the change; the next successful edit will persist it.
    }
  };

  const changePeriod = async (value: Period) => {
    setSaving(true);
    await persist({ costs_period: value });
    setSaving(false);
  };

  const changeBudget = (val: string) => {
    setBudget(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      const dollars = val ? Number(val) : null;
      const cents = dollars && dollars > 0 ? Math.round(dollars * 100) : null;
      await persist({ costs_budget_monthly: cents });
      setSaving(false);
    }, 800);
  };

  return (
    <SettingsPanel icon={Wallet} title="Costs and budget">
      <FormSection>
        <FieldRow label="Default period" hint="How the Costs screen totals up when you open it">
          <SegmentedControl
            accessibilityLabel="Default period"
            options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
            value={period}
            onChange={changePeriod}
          />
        </FieldRow>
        <FieldRow label="Monthly budget" hint="Your own target. The Costs screen tracks your totals against it.">
          <View className="flex-row items-center gap-2">
            <Input
              keyboardType="decimal-pad"
              placeholder="2000"
              value={budget}
              onChangeText={changeBudget}
              accessibilityLabel={`Monthly budget in ${currencyCode}`}
              className="h-9 w-32 tabular-nums"
            />
            <Text className="text-sm text-muted-foreground">{currencyCode}</Text>
          </View>
        </FieldRow>
      </FormSection>
      <SavingHint show={saving} />
    </SettingsPanel>
  );
}
