"use client";

import { useState, useEffect } from "react";
import { useSectionSettings } from "@/lib/use-section";
import { getEnabledSections, useModules } from "@homeup/core";
import { sectionIcons } from "@/lib/section-icons";
import { useDataCache } from "@/lib/data-cache";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  SettingsChoiceRow,
  SettingsInset,
  SettingsLabel,
  SettingsPanel,
  SettingsSwitchRow,
} from "@/components/settings-panel";
import { History, Loader2, SlidersHorizontal } from "lucide-react";

export function SectionPreferences() {
  const { settings, loading, updateDefaultSection } = useSectionSettings();
  const { userSettings, refresh } = useDataCache();
  const modules = useModules();
  const [selectedDefault, setSelectedDefault] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingCalendarToggle, setSavingCalendarToggle] = useState(false);

  useEffect(() => {
    if (!loading) {
      setSelectedDefault(settings.defaultSection);
    }
  }, [settings.defaultSection, loading]);

  async function handleSave() {
    setSaving(true);
    try {
      await updateDefaultSection(selectedDefault);
    } finally {
      setSaving(false);
    }
  }

  const showCalendarEventsInTodo = userSettings?.calendar_show_pulled_events_in_todo ?? true;

  async function handleToggleCalendarEventsInTodo() {
    setSavingCalendarToggle(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from("user_settings")
        .upsert({
          user_id: user.id,
          calendar_show_pulled_events_in_todo: !showCalendarEventsInTodo,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
      await refresh();
    } finally {
      setSavingCalendarToggle(false);
    }
  }

  // HOUP-50 bug 4: no early-return on `loading` here — the static section list
  // (below) renders on first paint immediately; `selectedDefault` already
  // defaults to `settings.defaultSection`'s own pre-load value (null, i.e.
  // "Last used") and the effect above swaps in the real value in place once
  // `useSectionSettings` resolves, so there's nothing to gate on.
  const hasChanged = selectedDefault !== settings.defaultSection;

  return (
    <SettingsPanel icon={SlidersHorizontal} title="Section preferences">
      <div className="space-y-1.5">
        <SettingsLabel id="default-section-label">Open on launch</SettingsLabel>
        {/* The app's own pick-one list (E3: selection = accent check), the
            same rows native uses, instead of browser radio buttons. */}
        <SettingsInset role="radiogroup" aria-labelledby="default-section-label">
          <SettingsChoiceRow
            selected={selectedDefault === null}
            onSelect={() => setSelectedDefault(null)}
            leading={<History className="size-4" />}
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
                leading={Icon ? <Icon className="size-4" /> : undefined}
                title={section.label}
              />
            );
          })}
        </SettingsInset>
      </div>

      {hasChanged && (
        <Button onClick={handleSave} disabled={saving} size="lg" className="px-4">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "Saving…" : "Save"}
        </Button>
      )}

      {/* Modules: pulled events need Calendar and Google Calendar (module-features.ts). */}
      {modules.feature("hub.calendar-events") && (
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
