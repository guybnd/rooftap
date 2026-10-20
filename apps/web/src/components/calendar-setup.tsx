"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CalendarClock, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SearchablePicker } from "@/components/ui/searchable-picker";
import { FormSection, FieldRow } from "@/components/ui/item-form-sheet";
import {
  SettingsCheckbox,
  SettingsInset,
  SettingsLabel,
  SettingsPanel,
  SettingsSwitchRow,
} from "@/components/settings-panel";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { TimeScrollField } from "@/components/time-scroll-field";
import type { GoogleCalendarSuggestMode, GoogleCalendarEventVisibility } from '@homeup/core';

/**
 * FLUX-157: opt-in Google Calendar connection. Separate OAuth flow from the
 * main login — extra calendar scopes + offline access, redirects to
 * /calendar-callback (not /callback) so the main sign-in flow is untouched.
 */

interface CalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
}

interface CalendarSettings {
  selected_calendar_ids: string[];
  suggest_mode: GoogleCalendarSuggestMode;
  dedicated_calendar_id: string | null;
  keywords: string[];
  pull_window_past_days: number;
  pull_window_future_days: number;
  default_import_visibility: GoogleCalendarEventVisibility;
  /** FLUX-233: whether calendar-sync pulls this connection's calendars at all. Defaults on. */
  pull_enabled: boolean;
  /** FLUX-233: whether to-dos are pushed to this member's Google Calendar. Defaults off (appointments unaffected). */
  push_todos_enabled: boolean;
}

type Status =
  | { state: "checking" }
  | { state: "disconnected" }
  | { state: "connected"; settings: CalendarSettings };

const TODO_SCHEDULE_OPTIONS = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hour" },
  { value: "all_day", label: "All day" },
] as const;

const VISIBILITY_OPTIONS: { value: GoogleCalendarEventVisibility; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "group", label: "Shared" },
];

const SUGGEST_OPTIONS: { value: GoogleCalendarSuggestMode; label: string }[] = [
  { value: "dedicated", label: "A calendar" },
  { value: "keywords", label: "Keywords" },
  { value: "both", label: "Both" },
];

const NO_CALENDAR = "__none";

const COMMON_TIMEZONES = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Adelaide",
  "Pacific/Auckland",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Singapore",
  "Asia/Tokyo",
  "UTC",
];

export function CalendarSetup() {
  const { userSettings, refresh } = useDataCache();
  const [status, setStatus] = useState<Status>({ state: "checking" });
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [keywordsInput, setKeywordsInput] = useState("");
  const [pastDaysInput, setPastDaysInput] = useState("7");
  const [futureDaysInput, setFutureDaysInput] = useState("30");
  const [timezoneInput, setTimezoneInput] = useState("Australia/Sydney");
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/status");
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();
      if (data.connected && data.settings) {
        setStatus({ state: "connected", settings: data.settings });
        setKeywordsInput((data.settings.keywords ?? []).join(", "));
        setPastDaysInput(String(data.settings.pull_window_past_days ?? 7));
        setFutureDaysInput(String(data.settings.pull_window_future_days ?? 30));
        const calRes = await fetch("/api/calendar/calendars");
        if (calRes.ok) {
          const calData = await calRes.json();
          setCalendars(calData.calendars ?? []);
        }
      } else {
        setStatus({ state: "disconnected" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load calendar settings.");
      setStatus({ state: "disconnected" });
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    setTimezoneInput(userSettings?.timezone ?? "Australia/Sydney");
    setTimezoneError(null);
  }, [userSettings]);

  const connect = useCallback(async () => {
    setError(null);
    const supabase = createClient();

    // FLUX-157: signInWithOAuth performs a full sign-in, not identity linking
    // — if Google's account chooser returns a different Google identity than
    // the one currently signed into Rooftap, exchangeCodeForSession would
    // silently swap the browser session to that other account. Record who we
    // expect to come back as before redirecting, so calendar-callback can
    // detect and abort a mismatch.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be signed in to connect Google Calendar.");
      return;
    }
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `calendar_connect_uid=${user.id}; path=/; max-age=600; SameSite=Lax${secure}`;

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/calendar-callback`,
        scopes:
          "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.calendars",
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/calendar/connection", { method: "DELETE" });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setStatus({ state: "disconnected" });
      setCalendars([]);
      setKeywordsInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect calendar.");
    } finally {
      setBusy(false);
    }
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<CalendarSettings>) => {
      if (status.state !== "connected") return;
      setError(null);
      const previousSettings = status.settings;
      const nextSettings = { ...previousSettings, ...patch };
      setStatus({ state: "connected", settings: nextSettings });
      setBusy(true);
      try {
        const res = await fetch("/api/calendar/calendars", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save calendar settings.");
        setStatus({ state: "connected", settings: previousSettings });
      } finally {
        setBusy(false);
      }
    },
    [status]
  );

  const toggleCalendar = (id: string) => {
    if (status.state !== "connected") return;
    const current = status.settings.selected_calendar_ids;
    const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
    updateSettings({ selected_calendar_ids: next });
  };

  const commitKeywords = () => {
    const keywords = keywordsInput
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    updateSettings({ keywords });
  };

  const commitPastDays = () => {
    const parsed = parseInt(pastDaysInput, 10);
    if (isNaN(parsed)) return;
    const clamped = Math.min(90, Math.max(1, parsed));
    setPastDaysInput(String(clamped));
    updateSettings({ pull_window_past_days: clamped });
  };

  const commitFutureDays = () => {
    const parsed = parseInt(futureDaysInput, 10);
    if (isNaN(parsed)) return;
    const clamped = Math.min(90, Math.max(1, parsed));
    setFutureDaysInput(String(clamped));
    updateSettings({ pull_window_future_days: clamped });
  };

  const patchUserSettings = useCallback(
    async (patch: Record<string, unknown>) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from("user_settings")
        .upsert(
          { user_id: user.id, ...patch, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
      await refresh();
    },
    [refresh]
  );

  const setTodoSchedule = (value: (typeof TODO_SCHEDULE_OPTIONS)[number]["value"]) => {
    if (value === "all_day") {
      patchUserSettings({ calendar_todo_mode: "all_day" });
    } else {
      patchUserSettings({
        calendar_todo_mode: "timed_block",
        calendar_todo_default_duration_minutes: Number(value),
      });
    }
  };

  // FLUX-233 #1: TimeScrollField/ScrollField call onChange synchronously per
  // drag tick with no local state of their own — they just render the `value`
  // prop they're given. Feeding patchUserSettings directly meant the digits
  // stayed frozen on the OLD value (haptic fired, display didn't) until the
  // upsert + full data-cache refresh round-tripped, several seconds later.
  // Fix: keep the displayed value in local state that updates in the same
  // frame as the drag, and debounce the actual persisted write so it never
  // blocks that display update.
  const [localTodoTime, setLocalTodoTime] = useState(
    userSettings?.calendar_todo_default_time ?? "09:00"
  );
  const todoTimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalTodoTime(userSettings?.calendar_todo_default_time ?? "09:00");
  }, [userSettings?.calendar_todo_default_time]);

  useEffect(() => {
    return () => {
      if (todoTimeDebounceRef.current) clearTimeout(todoTimeDebounceRef.current);
    };
  }, []);

  const handleTodoTimeChange = useCallback(
    (value: string) => {
      setLocalTodoTime(value);
      if (todoTimeDebounceRef.current) clearTimeout(todoTimeDebounceRef.current);
      todoTimeDebounceRef.current = setTimeout(() => {
        patchUserSettings({ calendar_todo_default_time: value });
      }, 500);
    },
    [patchUserSettings]
  );

  const commitTimezone = () => {
    const value = timezoneInput.trim();
    if (!value) return;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
    } catch {
      setTimezoneError(`"${value}" is not a valid timezone.`);
      return;
    }
    setTimezoneError(null);
    patchUserSettings({ timezone: value });
  };

  const todoScheduleValue =
    userSettings?.calendar_todo_mode === "timed_block"
      ? String(userSettings.calendar_todo_default_duration_minutes ?? 30)
      : "all_day";

  const commitOnEnter = (commit: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  };

  return (
    <SettingsPanel
      icon={CalendarClock}
      title="Google Calendar"
      description="Pull your Google events into Rooftap (private by default), and push appointments and to-dos out to Google."
    >
      {status.state === "checking" && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {status.state === "disconnected" && (
        <Button size="lg" className="px-3" onClick={connect}>
          <CalendarClock className="h-4 w-4" />
          Connect Google Calendar
        </Button>
      )}

      {status.state === "connected" && (
        <div className="space-y-4">
          <SettingsInset>
            <SettingsSwitchRow
              title="Pull events from Google"
              checked={status.settings.pull_enabled}
              onChange={(on) => updateSettings({ pull_enabled: on })}
              disabled={busy}
            />
            <SettingsSwitchRow
              title="Push to-dos to Google"
              checked={status.settings.push_todos_enabled}
              onChange={(on) => updateSettings({ push_todos_enabled: on })}
              disabled={busy}
            />
            <SettingsSwitchRow
              title="Pulled events in to-dos"
              description="Show pulled events on Home's to-do feed"
              checked={userSettings?.calendar_show_pulled_events_in_todo ?? true}
              onChange={(on) => patchUserSettings({ calendar_show_pulled_events_in_todo: on })}
            />
          </SettingsInset>

          <FormSection>
            <FieldRow label="Undated to-dos land in Google as">
              <SegmentedControl
                ariaLabel="Undated to-dos land in Google as"
                options={[...TODO_SCHEDULE_OPTIONS]}
                value={todoScheduleValue as (typeof TODO_SCHEDULE_OPTIONS)[number]["value"]}
                onChange={setTodoSchedule}
              />
              {userSettings?.calendar_todo_mode === "timed_block" && (
                <div className="pt-1">
                  <TimeScrollField value={localTodoTime} onChange={handleTodoTimeChange} />
                </div>
              )}
            </FieldRow>
            <FieldRow label="Timezone" htmlFor="calendar-timezone" error={timezoneError}>
              <Input
                id="calendar-timezone"
                type="text"
                list="calendar-timezone-options"
                value={timezoneInput}
                onChange={(e) => setTimezoneInput(e.target.value)}
                onBlur={commitTimezone}
                onKeyDown={commitOnEnter(commitTimezone)}
                className="h-9"
              />
              <datalist id="calendar-timezone-options">
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </FieldRow>
          </FormSection>

          <div className="space-y-1.5">
            <SettingsLabel>Calendars to pull</SettingsLabel>
            {calendars.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">No calendars found.</p>
            ) : (
              <SettingsInset className="max-h-64 overflow-y-auto">
                {calendars.map((cal) => (
                  <SettingsCheckbox
                    key={cal.id}
                    checked={status.settings.selected_calendar_ids.includes(cal.id)}
                    onChange={() => toggleCalendar(cal.id)}
                    disabled={busy}
                    className="min-h-11"
                  >
                    {cal.summary}
                    {cal.primary && <span className="ml-1.5 text-xs text-muted-foreground">Primary</span>}
                  </SettingsCheckbox>
                ))}
              </SettingsInset>
            )}
          </div>

          <FormSection>
            <FieldRow label="Pull window" hint="Between 1 and 90 days each way">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={90}
                    value={pastDaysInput}
                    onChange={(e) => setPastDaysInput(e.target.value)}
                    onBlur={commitPastDays}
                    onKeyDown={commitOnEnter(commitPastDays)}
                    disabled={busy}
                    aria-label="Days back"
                    className="h-9 w-20 tabular-nums"
                  />
                  days back
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={90}
                    value={futureDaysInput}
                    onChange={(e) => setFutureDaysInput(e.target.value)}
                    onBlur={commitFutureDays}
                    onKeyDown={commitOnEnter(commitFutureDays)}
                    disabled={busy}
                    aria-label="Days ahead"
                    className="h-9 w-20 tabular-nums"
                  />
                  days ahead
                </label>
              </div>
            </FieldRow>
            <FieldRow label="Imported events are">
              <SegmentedControl
                ariaLabel="Imported events are"
                options={VISIBILITY_OPTIONS}
                value={status.settings.default_import_visibility}
                onChange={(value) => updateSettings({ default_import_visibility: value })}
              />
            </FieldRow>
            <FieldRow label="Suggest viewings from">
              <SegmentedControl
                ariaLabel="Suggest viewings from"
                options={SUGGEST_OPTIONS}
                value={status.settings.suggest_mode}
                onChange={(value) => updateSettings({ suggest_mode: value })}
              />
            </FieldRow>
            {(status.settings.suggest_mode === "dedicated" ||
              status.settings.suggest_mode === "both") && (
              <FieldRow label="Viewings calendar">
                <SearchablePicker
                  options={[
                    { value: NO_CALENDAR, primary: "None" },
                    ...calendars.map((cal) => ({ value: cal.id, primary: cal.summary })),
                  ]}
                  value={status.settings.dedicated_calendar_id ?? NO_CALENDAR}
                  onChange={(value) =>
                    updateSettings({ dedicated_calendar_id: value === NO_CALENDAR ? null : value })
                  }
                  disabled={busy}
                  placeholder="Pick a calendar"
                  searchPlaceholder="Search calendars"
                  emptyText="No matching calendar"
                  ariaLabel="Viewings calendar"
                />
              </FieldRow>
            )}
            {(status.settings.suggest_mode === "keywords" ||
              status.settings.suggest_mode === "both") && (
              <FieldRow label="Keywords" htmlFor="calendar-keywords" hint="Separate with commas">
                <Input
                  id="calendar-keywords"
                  type="text"
                  placeholder="viewing, inspection, open home"
                  value={keywordsInput}
                  onChange={(e) => setKeywordsInput(e.target.value)}
                  onBlur={commitKeywords}
                  onKeyDown={commitOnEnter(commitKeywords)}
                  disabled={busy}
                  className="h-9"
                />
              </FieldRow>
            )}
          </FormSection>

          {/* E4: destructive sits alone, danger text, no fill or tinted border. */}
          <Button
            size="lg"
            variant="ghost"
            onClick={disconnect}
            disabled={busy}
            className="px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Unlink className="h-4 w-4" />
            Disconnect
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </SettingsPanel>
  );
}
