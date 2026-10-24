"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { upBankApi } from "@/lib/up-bank-client";
import { Input } from "@/components/ui/input";
import { FormSection, FieldRow } from "@/components/ui/item-form-sheet";
import { SavingHint, SettingsInset, SettingsLabel, SettingsPanel, SettingsSwitchRow } from "@/components/settings-panel";
import { CalendarClock, MessageSquare, Repeat, Target } from "lucide-react";
import {
  ASK_AGAIN_CHOICES,
  DEFAULT_RECENT_SPEND,
  askAgainLabel,
  askAgainMonths,
  withAskAgain,
  RECENT_WINDOW_CHOICES,
  householdCurrency,
  readRecentSpendPrefs,
  recentWindowLabel,
  toggleRecentWindow,
  upWeeklyDigestOn,
  useModules,
  useUserSetting,
  type MoneySummaryPrefs,
  type UpBankStatus,
} from "@homeup/core";
import { cn } from "@/lib/utils";

// Costs settings (module-settings.ts): Settings > Costs and the sheet from the
// Costs More menu render these same panels.

function useSaver() {
  const { refresh } = useDataCache();
  return { client: createClient, refresh };
}

/** The monthly goal, in cents in user_settings.costs_budget_monthly. */
export function CostsSettings() {
  const { userSettings, group } = useDataCache();
  const currencyCode = householdCurrency(group);
  const [goal, setGoal] = useUserSetting("costs_budget_monthly", userSettings?.costs_budget_monthly, useSaver());
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(goal != null ? (goal / 100).toString() : "");
  }, [goal]);

  const change = (val: string) => {
    setDraft(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const dollars = val ? Number(val) : null;
      setSaving(true);
      setGoal(dollars && dollars > 0 ? Math.round(dollars * 100) : null);
      setTimeout(() => setSaving(false), 600);
    }, 700);
  };

  return (
    <SettingsPanel icon={Target} title="Monthly goal">
      <FormSection>
        <FieldRow
          label="Goal"
          htmlFor="costs-monthly-goal"
          hint="What the household aims to spend in a month. Leave it empty to have no goal."
        >
          <div className="flex items-center gap-2">
            <Input
              id="costs-monthly-goal"
              type="number"
              inputMode="decimal"
              placeholder="4000"
              value={draft}
              onChange={(e) => change(e.target.value)}
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

/** Recent spending on the Latest card: which windows, and whether bills count. */
export function CostsRecentSettings() {
  const { userSettings } = useDataCache();
  const modules = useModules();
  const [stored, setStored] = useUserSetting(
    "costs_recent_spend",
    userSettings?.costs_recent_spend,
    useSaver(),
    modules.server("costs.recent-spend"),
  );
  if (!modules.server("connectors.up-bank")) return null;
  const prefs = stored ? readRecentSpendPrefs(stored) : DEFAULT_RECENT_SPEND;
  const change = (next: typeof prefs) => setStored(next);

  return (
    <SettingsPanel icon={CalendarClock} title="Recent spending" description="The stretch of days on the Latest card, up to three.">
      <div className="flex flex-wrap gap-2 px-1" role="group" aria-label="Windows to show, up to three">
        {RECENT_WINDOW_CHOICES.map((w) => {
          const on = prefs.windows.includes(w);
          return (
            <button
              key={w}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => change(toggleRecentWindow(prefs, w))}
              className={cn("rounded-full border px-3 py-1.5 text-sm", on ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {recentWindowLabel(w)}
            </button>
          );
        })}
      </div>
      <SettingsInset>
        <SettingsSwitchRow
          title="Leave out bills"
          description="Rent and other regular bills don't count, so a rent day doesn't swamp the week."
          checked={prefs.skipBills}
          onChange={(on) => change({ ...prefs, skipBills: on })}
        />
        <SettingsSwitchRow
          title="Show recent spending"
          description="Off keeps just the last few payments."
          checked={prefs.show}
          onChange={(on) => change({ ...prefs, show: on })}
        />
      </SettingsInset>
    </SettingsPanel>
  );
}

/** How long a subscription kept or cancelled in Worth a look waits before it comes back to decide. */
export function CostsSubscriptionsSettings() {
  const { userSettings } = useDataCache();
  const modules = useModules();
  const on = modules.isEnabled("money-insights") && modules.server("costs.insight-marks");
  const [marks, setMarks] = useUserSetting("money_insight_marks", userSettings?.money_insight_marks, useSaver());
  if (!on) return null;
  const current = askAgainMonths(marks);

  return (
    <SettingsPanel icon={Repeat} title="Subscriptions" description="A subscription you keep or cancel in Worth a look comes back to decide after this long.">
      <SettingsLabel>Ask again after</SettingsLabel>
      <div className="flex flex-wrap gap-2 px-1" role="radiogroup" aria-label="Ask about a kept or cancelled subscription again after">
        {ASK_AGAIN_CHOICES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={current === m}
            onClick={() => setMarks(withAskAgain(marks, m))}
            className={cn("rounded-full border px-3 py-1.5 text-sm", current === m ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {askAgainLabel(m)}
          </button>
        ))}
      </div>
    </SettingsPanel>
  );
}

/** The Assistant's weekly and monthly money notes in the Household chat. */
export function CostsSummariesSettings() {
  const { userSettings } = useDataCache();
  const modules = useModules();
  const on = modules.isEnabled("money-insights") && modules.isEnabled("assistant") && modules.server("costs.money-summaries");
  const upBank = modules.server("connectors.up-bank");
  const [stored, setStored] = useUserSetting("money_summaries", userSettings?.money_summaries, useSaver());
  const [status, setStatus] = useState<UpBankStatus | null>(null);
  useEffect(() => {
    if (on && upBank) upBankApi.status().then(setStatus, () => {});
  }, [on, upBank]);
  if (!on) return null;
  const prefs: MoneySummaryPrefs = stored ?? {};

  return (
    <SettingsPanel icon={MessageSquare} title="Summaries in the Household chat">
      <SettingsInset>
        <SettingsSwitchRow
          title="Weekly"
          description="Sunday morning: the week, what is worth a look and the bills ahead."
          checked={prefs.weekly ?? upWeeklyDigestOn(status)}
          onChange={(weekly) => setStored({ ...prefs, weekly })}
        />
        <SettingsSwitchRow
          title="Monthly"
          description="On the 1st: last month against the goal and the month before."
          checked={!!prefs.monthly}
          onChange={(monthly) => setStored({ ...prefs, monthly })}
        />
      </SettingsInset>
    </SettingsPanel>
  );
}
