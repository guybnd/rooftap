"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { Input } from "@/components/ui/input";
import { FormSection, FieldRow } from "@/components/ui/item-form-sheet";
import { SavingHint, SettingsPanel } from "@/components/settings-panel";
import { Banknote } from "lucide-react";
import { householdCurrency } from "@homeup/core";

export function BudgetSettings() {
  const { userSettings, group, refresh } = useDataCache();
  const currencyCode = householdCurrency(group);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMin(userSettings?.rent_min?.toString() ?? "");
    setMax(userSettings?.rent_max?.toString() ?? "");
  }, [userSettings]);

  const save = (rentMin: string, rentMax: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSaving(false); return; }

      const payload = {
        user_id: user.id,
        rent_min: rentMin ? parseInt(rentMin, 10) : null,
        rent_max: rentMax ? parseInt(rentMax, 10) : null,
        updated_at: new Date().toISOString(),
      };

      await supabase
        .from("user_settings")
        .upsert(payload, { onConflict: "user_id" });

      await refresh();
      setSaving(false);
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
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              placeholder="Min"
              aria-label="Minimum weekly rent"
              value={min}
              onChange={(e) => handleMinChange(e.target.value)}
              min={0}
              className="h-9 min-w-0 flex-1 tabular-nums"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="number"
              inputMode="numeric"
              placeholder="Max"
              aria-label="Maximum weekly rent"
              value={max}
              onChange={(e) => handleMaxChange(e.target.value)}
              min={0}
              className="h-9 min-w-0 flex-1 tabular-nums"
            />
          </div>
        </FieldRow>
      </FormSection>
      <SavingHint show={saving} />
    </SettingsPanel>
  );
}
