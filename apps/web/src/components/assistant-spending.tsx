"use client";

// HOUP-444: Settings > Assistant, the money side. "Spending" is the
// household's own controls (monthly budget, what happens at the limit, when
// to warn, how much each reply remembers, how long a quick ask stays open);
// "Usage" is what was spent in a month, by person (with each person's
// allowance and a lookups-only switch), by feature and by model. The meter is
// local to the budget it measures (H3). Owners change things; everyone sees.
// Native twin: apps/mobile/src/features/settings/panels/assistant-spending.tsx.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, PiggyBank, ReceiptText } from "lucide-react";
import {
  budgetPercent,
  checkBudget,
  formatCents,
  formatMicros,
  formatTokens,
  microsToCents,
  parsePriceInput,
  shiftUsageMonth,
  usageMonth,
  usageMonthLabel,
  type AssistantSettings,
  type AssistantUsage,
  type AtLimit,
  type UsageSlice,
} from "@homeup/core";
import { assistantApi } from "@/lib/assistant-client";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { SettingsInset, SettingsLabel, SettingsPanel } from "@/components/settings-panel";

const AT_LIMIT: { value: AtLimit; label: string }[] = [
  { value: "warn", label: "Warn" },
  { value: "cheap", label: "Cheaper model" },
  { value: "stop", label: "Stop" },
];

const METER_TONE = { ok: "bg-success", warn: "bg-warning", over: "bg-destructive" } as const;

function centsText(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

/** A meter for spend against one budget, or nothing when there is no budget. */
function BudgetMeter({ spentMicros, budgetCents, warnAtPercent }: { spentMicros: number; budgetCents: number | null; warnAtPercent: number }) {
  if (budgetCents === null) return null;
  const tone = checkBudget(microsToCents(spentMicros), budgetCents, "warn", warnAtPercent).status;
  return <ProgressBar value={budgetPercent(spentMicros, budgetCents) ?? 0} total={100} fillClassName={METER_TONE[tone]} />;
}

function NumberRow({
  title,
  caption,
  value,
  min,
  max,
  disabled,
  onSave,
}: {
  title: string;
  caption: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onSave: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
      </div>
      <Input
        inputMode="numeric"
        aria-label={title}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => {
          const n = Math.min(max, Math.max(min, Number(text) || min));
          setText(String(n));
          if (n !== value) onSave(n);
        }}
        className="w-20 text-right tabular-nums"
      />
    </div>
  );
}

function Slices({ label, slices }: { label: string; slices: UsageSlice[] }) {
  if (slices.length === 0) return null;
  return (
    <div className="space-y-2">
      <SettingsLabel>{label}</SettingsLabel>
      <SettingsInset>
        {slices.map((s) => (
          <div key={s.key} className="flex min-h-[44px] items-center gap-3 px-3.5 py-2">
            <p className="min-w-0 flex-1 truncate text-sm text-foreground">{s.label}</p>
            <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {s.turns} {s.turns === 1 ? "reply" : "replies"} · {formatTokens(s.tokens)} tokens
            </p>
            <p className="w-16 shrink-0 text-right text-sm font-medium text-foreground tabular-nums">{formatMicros(s.costMicros)}</p>
          </div>
        ))}
      </SettingsInset>
    </div>
  );
}

export function AssistantSpending() {
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [budgetText, setBudgetText] = useState("");
  const [month, setMonth] = useState(usageMonth());
  const [usage, setUsage] = useState<AssistantUsage | null>(null);

  useEffect(() => {
    assistantApi
      .settings()
      .then((res) => {
        setSettings(res.settings);
        setIsOwner(res.isOwner);
        setBudgetText(centsText(res.settings.monthlyBudgetCents));
      })
      .catch(() => {});
  }, []);

  const loadUsage = useCallback(() => {
    assistantApi.usage(month).then(setUsage).catch(() => setUsage(null));
  }, [month]);
  useEffect(loadUsage, [loadUsage]);

  const save = async (patch: Partial<AssistantSettings>) => {
    if (!settings) return;
    const before = settings;
    setSettings({ ...settings, ...patch });
    try {
      const next = (await assistantApi.saveSettings(patch)).settings;
      setSettings(next);
      setBudgetText(centsText(next.monthlyBudgetCents));
      if ("monthlyBudgetCents" in patch || "warnAtPercent" in patch) loadUsage();
    } catch (err) {
      setSettings(before);
      setBudgetText(centsText(before.monthlyBudgetCents));
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    }
  };

  const saveLimit = async (userId: string, patch: { monthlyBudgetCents?: number | null; readOnly?: boolean }) => {
    if (!usage) return;
    const before = usage;
    setUsage({
      ...usage,
      members: usage.members.map((m) =>
        m.userId === userId
          ? { ...m, ...(patch.monthlyBudgetCents !== undefined ? { budgetCents: patch.monthlyBudgetCents } : {}), ...(patch.readOnly !== undefined ? { readOnly: patch.readOnly } : {}) }
          : m
      ),
    });
    try {
      await assistantApi.saveMemberLimit(userId, patch);
    } catch (err) {
      setUsage(before);
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    }
  };

  const current = month === usageMonth();
  const total = usage?.summary.costMicros ?? 0;

  return (
    <div className="space-y-4">
      <SettingsPanel
        icon={PiggyBank}
        title="Spending"
        description="A monthly budget for the whole household. With no budget there's no limit."
      >
        {settings && (
          <div className="space-y-3">
            <SettingsInset>
              <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Monthly budget</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">In US dollars, the currency model providers bill in.</p>
                </div>
                <div className="relative w-28">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    inputMode="decimal"
                    aria-label="Monthly budget"
                    placeholder="No budget"
                    value={budgetText}
                    disabled={!isOwner}
                    onChange={(e) => setBudgetText(e.target.value)}
                    onBlur={() => {
                      const cents = budgetText.trim() ? parsePriceInput(budgetText) : null;
                      if (cents !== settings.monthlyBudgetCents) void save({ monthlyBudgetCents: cents });
                      else setBudgetText(centsText(cents));
                    }}
                    className="pl-6 text-right tabular-nums"
                  />
                </div>
              </div>
              <div className="space-y-2 px-3.5 py-3">
                <p className="text-sm font-medium text-foreground">At the limit</p>
                <SegmentedControl<AtLimit>
                  ariaLabel="At the limit"
                  size="sm"
                  value={settings.atLimit}
                  options={AT_LIMIT}
                  onChange={(atLimit) => isOwner && void save({ atLimit })}
                />
                <p className="text-xs text-muted-foreground">
                  {settings.atLimit === "warn"
                    ? "Keeps going and tells you it's over."
                    : settings.atLimit === "cheap"
                      ? "Switches to the quick-ask model for the rest of the month."
                      : "Stops until next month or until an owner raises the budget."}
                </p>
              </div>
              <NumberRow
                title="Warn at"
                caption="Percent of a budget or allowance."
                value={settings.warnAtPercent}
                min={1}
                max={100}
                disabled={!isOwner}
                onSave={(warnAtPercent) => void save({ warnAtPercent })}
              />
              <NumberRow
                title="Messages remembered"
                caption="Recent messages sent with each reply. Fewer costs less."
                value={settings.contextMessages}
                min={2}
                max={100}
                disabled={!isOwner}
                onSave={(contextMessages) => void save({ contextMessages })}
              />
              <NumberRow
                title="Quick asks stay open"
                caption="Minutes a quick ask takes follow-ups after the last message."
                value={settings.quickAskIdleMinutes}
                min={1}
                max={1440}
                disabled={!isOwner}
                onSave={(quickAskIdleMinutes) => void save({ quickAskIdleMinutes })}
              />
            </SettingsInset>
          </div>
        )}
      </SettingsPanel>

      <SettingsPanel
        icon={ReceiptText}
        title="Usage"
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonth((m) => shiftUsageMonth(m, -1))}
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-28 text-center text-xs text-muted-foreground">{usageMonthLabel(month)}</span>
            <button
              type="button"
              aria-label="Next month"
              disabled={current}
              onClick={() => setMonth((m) => shiftUsageMonth(m, 1))}
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        }
      >
        {usage && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-heading text-2xl font-bold tracking-tight text-foreground tabular-nums">{formatMicros(total)}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {usage.budgetCents !== null ? `of ${formatCents(usage.budgetCents)} · ` : ""}
                  {usage.summary.turns} {usage.summary.turns === 1 ? "reply" : "replies"}
                </p>
              </div>
              <BudgetMeter spentMicros={total} budgetCents={usage.budgetCents} warnAtPercent={usage.warnAtPercent} />
              {usage.allowanceCents !== null && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  Plus includes {formatCents(usage.allowanceCents)} a month on Rooftap&apos;s key; {formatMicros(usage.serverMicros)} used.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <SettingsLabel>People</SettingsLabel>
              <SettingsInset>
                {usage.members.map((m) => (
                  <MemberRow key={m.userId} member={m} isOwner={isOwner} warnAtPercent={usage.warnAtPercent} onSave={(patch) => void saveLimit(m.userId, patch)} />
                ))}
              </SettingsInset>
              <p className="px-1 text-xs text-muted-foreground">An allowance caps one person each month. Lookups only lets them ask but not change anything.</p>
            </div>

            <Slices label="By feature" slices={usage.summary.byFeature} />
            <Slices label="By model" slices={usage.summary.byModel} />
          </div>
        )}
      </SettingsPanel>
    </div>
  );
}

function MemberRow({
  member,
  isOwner,
  warnAtPercent,
  onSave,
}: {
  member: AssistantUsage["members"][number];
  isOwner: boolean;
  warnAtPercent: number;
  onSave: (patch: { monthlyBudgetCents?: number | null; readOnly?: boolean }) => void;
}) {
  const [text, setText] = useState(centsText(member.budgetCents));
  useEffect(() => setText(centsText(member.budgetCents)), [member.budgetCents]);
  return (
    <div className="space-y-2 px-3.5 py-3">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{member.name}</p>
        <p className="shrink-0 text-sm text-foreground tabular-nums">{formatMicros(member.spentMicros)}</p>
      </div>
      <BudgetMeter spentMicros={member.spentMicros} budgetCents={member.budgetCents} warnAtPercent={warnAtPercent} />
      <div className="flex items-center gap-3">
        <div className="relative w-32">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <Input
            inputMode="decimal"
            aria-label={`${member.name}'s monthly allowance`}
            placeholder="No limit"
            value={text}
            disabled={!isOwner}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              const cents = text.trim() ? parsePriceInput(text) : null;
              if (cents !== member.budgetCents) onSave({ monthlyBudgetCents: cents });
              else setText(centsText(cents));
            }}
            className="h-9 pl-6 text-right tabular-nums"
          />
        </div>
        <span className="min-w-0 flex-1 text-right text-xs text-muted-foreground">Lookups only</span>
        <Switch checked={member.readOnly} disabled={!isOwner} label={`${member.name}: lookups only`} onChange={(readOnly) => onSave({ readOnly })} />
      </div>
    </div>
  );
}
