"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { Input } from "@/components/ui/input";
import { FormSection, FieldRow } from "@/components/ui/item-form-sheet";
import { SavingHint, SettingsPanel } from "@/components/settings-panel";
import { Clock } from "lucide-react";

export function AppointmentSettings() {
  const { userSettings, refresh } = useDataCache();
  const [duration, setDuration] = useState("20");
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDuration((userSettings?.appointment_duration_minutes ?? 20).toString());
  }, [userSettings]);

  const save = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 180) return;

      setSaving(true);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSaving(false); return; }

      await supabase
        .from("user_settings")
        .upsert({
          user_id: user.id,
          appointment_duration_minutes: parsed,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      await refresh();
      setSaving(false);
    }, 800);
  };

  const handleChange = (val: string) => {
    setDuration(val);
    save(val);
  };

  return (
    <SettingsPanel icon={Clock} title="Appointments">
      <FormSection>
        <FieldRow
          label="Viewing length"
          htmlFor="viewing-duration"
          hint="Used to time travel between viewings and check an itinerary fits the day"
        >
          <div className="flex items-center gap-2">
            <Input
              id="viewing-duration"
              type="number"
              inputMode="numeric"
              placeholder="20"
              value={duration}
              onChange={(e) => handleChange(e.target.value)}
              min={1}
              max={180}
              className="h-9 w-24 tabular-nums"
            />
            <span className="text-sm text-muted-foreground">min</span>
          </div>
        </FieldRow>
      </FormSection>
      <SavingHint show={saving} />
    </SettingsPanel>
  );
}
