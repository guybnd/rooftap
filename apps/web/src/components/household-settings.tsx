"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { Input } from "@/components/ui/input";
import { FormSection, FieldRow } from "@/components/ui/item-form-sheet";
import { SavingHint, SettingsPanel } from "@/components/settings-panel";
import { BellRing } from "lucide-react";
import { DEFAULT_UPCOMING_WINDOW_DAYS } from "@homeup/core";

const DEFAULT_LEAD_DAYS = 14;

type DaysColumn = "reminder_lead_days" | "tasks_upcoming_days";

/** A whole-days user_settings field edited as text and debounce-saved. */
function useDaysSetting(column: DaysColumn, fallback: number, min: number) {
  const { userSettings, refresh } = useDataCache();
  const [days, setDays] = useState("");
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const v = userSettings?.[column];
    setDays(v != null ? v.toString() : fallback.toString());
  }, [userSettings, column, fallback]);

  const changeDays = (val: string) => {
    setDays(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      const parsed = val ? Math.max(min, Math.round(Number(val))) : fallback;
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("user_settings")
          .upsert(
            { user_id: user.id, [column]: parsed, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
        await refresh();
      }
      setSaving(false);
    }, 800);
  };

  return { days, saving, changeDays };
}

/**
 * FLUX-65: Household default reminder lead time — how many days before a
 * warranty/task due date a reminder should surface by default. Stored per-user
 * in user_settings.reminder_lead_days. Also the Tasks screen's Upcoming window
 * (user_settings.tasks_upcoming_days).
 */
export function HouseholdSettings() {
  const lead = useDaysSetting("reminder_lead_days", DEFAULT_LEAD_DAYS, 0);
  const upcoming = useDaysSetting("tasks_upcoming_days", DEFAULT_UPCOMING_WINDOW_DAYS, 1);

  return (
    <SettingsPanel icon={BellRing} title="Task defaults">
      <FormSection>
        <FieldRow
          label="Reminder lead time"
          htmlFor="reminder-lead-days"
          hint="How far ahead task and document-expiry reminders are set by default"
        >
          <DaysInput id="reminder-lead-days" value={lead.days} onChange={lead.changeDays} min={0} />
        </FieldRow>
        <FieldRow
          label="Upcoming window"
          htmlFor="upcoming-days"
          hint="How far ahead Home's Upcoming view looks. On Tasks, anything later sits under Later."
        >
          <DaysInput id="upcoming-days" value={upcoming.days} onChange={upcoming.changeDays} min={1} />
        </FieldRow>
      </FormSection>
      <SavingHint show={lead.saving || upcoming.saving} />
    </SettingsPanel>
  );
}

function DaysInput({
  id,
  value,
  onChange,
  min,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        className="h-9 w-24 tabular-nums"
      />
      <span className="text-sm text-muted-foreground">days</span>
    </div>
  );
}
