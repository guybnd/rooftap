"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FormSection, FieldRow } from "@/components/ui/item-form-sheet";
import { SavingHint, SettingsPanel } from "@/components/settings-panel";
import { Wallet } from "lucide-react";
import { householdCurrency } from "@homeup/core";

const PERIODS = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

/**
 * FLUX-65: Costs default period + monthly budget target. These were per-device
 * localStorage prefs on the Costs page; here they sync via user_settings
 * (costs_budget_monthly stored in cents to match costs.ts money handling).
 */
export function CostsSettings() {
  const { userSettings, group, refresh } = useDataCache();
  const currencyCode = householdCurrency(group);
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const period = userSettings?.costs_period ?? "monthly";

  useEffect(() => {
    const cents = userSettings?.costs_budget_monthly;
    setBudget(cents != null ? (cents / 100).toString() : "");
  }, [userSettings]);

  const persist = async (payload: Record<string, unknown>) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("user_settings")
      .upsert(
        { user_id: user.id, updated_at: new Date().toISOString(), ...payload },
        { onConflict: "user_id" }
      );
    await refresh();
  };

  const changePeriod = async (value: string) => {
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
          {/* The app's segmented control (H5: neutral raised thumb), not a
              coral-filled segment. */}
          <SegmentedControl
            ariaLabel="Default period"
            options={PERIODS}
            value={period}
            onChange={changePeriod}
          />
        </FieldRow>
        <FieldRow
          label="Monthly budget"
          htmlFor="costs-monthly-budget"
          hint="Your own target. The Costs screen tracks your totals against it."
        >
          <div className="flex items-center gap-2">
            <Input
              id="costs-monthly-budget"
              type="number"
              inputMode="decimal"
              placeholder="2000"
              value={budget}
              onChange={(e) => changeBudget(e.target.value)}
              min={0}
              className="h-9 w-32 tabular-nums"
            />
            <span className="text-sm text-muted-foreground">{currencyCode}</span>
          </div>
        </FieldRow>
      </FormSection>
      <SavingHint show={saving} />
    </SettingsPanel>
  );
}
