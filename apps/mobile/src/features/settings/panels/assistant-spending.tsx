// HOUP-444: Settings > Assistant, the money side. "Spending" is the
// household's own controls (monthly budget, what happens at the limit, when
// to warn, how much each reply remembers, how long a quick ask stays open);
// "Usage" is what was spent in a month, by person (with each person's
// allowance and a lookups-only switch), by feature and by model. The meter is
// local to the budget it measures (H3). Owners change things; everyone sees.
// Web twin: apps/web/src/components/assistant-spending.tsx.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ChevronLeft, ChevronRight, PiggyBank, ReceiptText } from 'lucide-react-native';
import { Input, ProgressBar, SegmentedControl, Switch, Text, cn, toast } from '@homeup/ui';
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
} from '@homeup/core';
import { assistantApi } from '@/features/assistant/assistant-api';
import { SettingsInset, SettingsLabel, SettingsPanel } from './settings-panel';

const AT_LIMIT: { value: AtLimit; label: string }[] = [
  { value: 'warn', label: 'Warn' },
  { value: 'cheap', label: 'Cheaper' },
  { value: 'stop', label: 'Stop' },
];

const METER_TONE = { ok: 'bg-success', warn: 'bg-warning', over: 'bg-destructive' } as const;
const TABULAR = { fontVariant: ['tabular-nums' as const] };

function centsText(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

function BudgetMeter({ spentMicros, budgetCents, warnAtPercent }: { spentMicros: number; budgetCents: number | null; warnAtPercent: number }) {
  if (budgetCents === null) return null;
  const tone = checkBudget(microsToCents(spentMicros), budgetCents, 'warn', warnAtPercent).status;
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
    <View className="min-h-[52px] flex-row items-center gap-3 px-3.5 py-2.5">
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-medium text-foreground">{title}</Text>
        <Text className="mt-0.5 text-xs text-muted-foreground">{caption}</Text>
      </View>
      <Input
        keyboardType="number-pad"
        accessibilityLabel={title}
        value={text}
        editable={!disabled}
        onChangeText={(t) => setText(t.replace(/[^0-9]/g, ''))}
        onEndEditing={() => {
          const n = Math.min(max, Math.max(min, Number(text) || min));
          setText(String(n));
          if (n !== value) onSave(n);
        }}
        className="h-11 w-20 text-right"
        style={TABULAR}
      />
    </View>
  );
}

function MoneyInput({
  value,
  placeholder,
  label,
  disabled,
  onSave,
}: {
  value: number | null;
  placeholder: string;
  label: string;
  disabled: boolean;
  onSave: (cents: number | null) => void;
}) {
  const [text, setText] = useState(centsText(value));
  useEffect(() => setText(centsText(value)), [value]);
  return (
    <View className="w-28 flex-row items-center rounded-lg border border-input pl-2.5">
      <Text className="text-sm text-muted-foreground">$</Text>
      <Input
        keyboardType="decimal-pad"
        accessibilityLabel={label}
        placeholder={placeholder}
        value={text}
        editable={!disabled}
        onChangeText={setText}
        onEndEditing={() => {
          const cents = text.trim() ? parsePriceInput(text) : null;
          if (cents !== value) onSave(cents);
          else setText(centsText(cents));
        }}
        className="h-11 flex-1 border-0 text-right"
        style={TABULAR}
      />
    </View>
  );
}

function Slices({ label, slices }: { label: string; slices: UsageSlice[] }) {
  if (slices.length === 0) return null;
  return (
    <View className="gap-2">
      <SettingsLabel>{label}</SettingsLabel>
      <SettingsInset>
        {slices.map((s) => (
          <View key={s.key} className="min-h-[44px] flex-row items-center gap-3 px-3.5 py-2">
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-sm text-foreground">
                {s.label}
              </Text>
              <Text className="text-xs text-muted-foreground" style={TABULAR}>
                {s.turns} {s.turns === 1 ? 'reply' : 'replies'} · {formatTokens(s.tokens)} tokens
              </Text>
            </View>
            <Text className="text-sm font-medium text-foreground" style={TABULAR}>
              {formatMicros(s.costMicros)}
            </Text>
          </View>
        ))}
      </SettingsInset>
    </View>
  );
}

export function AssistantSpending() {
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [month, setMonth] = useState(usageMonth());
  const [usage, setUsage] = useState<AssistantUsage | null>(null);

  useEffect(() => {
    assistantApi
      .settings()
      .then((res) => {
        setSettings(res.settings);
        setIsOwner(res.isOwner);
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
      setSettings((await assistantApi.saveSettings(patch)).settings);
      if ('monthlyBudgetCents' in patch || 'warnAtPercent' in patch) loadUsage();
    } catch (err) {
      setSettings(before);
      toast.error(err instanceof Error ? err.message : 'Could not save that.');
    }
  };

  const saveLimit = async (userId: string, patch: { monthlyBudgetCents?: number | null; readOnly?: boolean }) => {
    if (!usage) return;
    const before = usage;
    setUsage({
      ...usage,
      members: usage.members.map((m) =>
        m.userId === userId
          ? {
              ...m,
              ...(patch.monthlyBudgetCents !== undefined ? { budgetCents: patch.monthlyBudgetCents } : {}),
              ...(patch.readOnly !== undefined ? { readOnly: patch.readOnly } : {}),
            }
          : m
      ),
    });
    try {
      await assistantApi.saveMemberLimit(userId, patch);
    } catch (err) {
      setUsage(before);
      toast.error(err instanceof Error ? err.message : 'Could not save that.');
    }
  };

  const current = month === usageMonth();
  const total = usage?.summary.costMicros ?? 0;

  return (
    <View className="gap-4">
      <SettingsPanel icon={PiggyBank} title="Spending" description="A monthly budget for the whole household. With no budget there's no limit.">
        {settings && (
          <SettingsInset>
            <View className="min-h-[52px] flex-row items-center gap-3 px-3.5 py-2.5">
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-medium text-foreground">Monthly budget</Text>
                <Text className="mt-0.5 text-xs text-muted-foreground">In US dollars, the currency model providers bill in.</Text>
              </View>
              <MoneyInput
                value={settings.monthlyBudgetCents}
                placeholder="None"
                label="Monthly budget"
                disabled={!isOwner}
                onSave={(monthlyBudgetCents) => void save({ monthlyBudgetCents })}
              />
            </View>
            <View className="gap-2 px-3.5 py-3">
              <Text className="text-sm font-medium text-foreground">At the limit</Text>
              <SegmentedControl<AtLimit>
                accessibilityLabel="At the limit"
                value={settings.atLimit}
                options={AT_LIMIT}
                onChange={(atLimit) => {
                  if (isOwner) void save({ atLimit });
                }}
              />
              <Text className="text-xs text-muted-foreground">
                {settings.atLimit === 'warn'
                  ? "Keeps going and tells you it's over."
                  : settings.atLimit === 'cheap'
                    ? 'Switches to the quick-ask model for the rest of the month.'
                    : 'Stops until next month or until an owner raises the budget.'}
              </Text>
            </View>
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
        )}
      </SettingsPanel>

      <SettingsPanel
        icon={ReceiptText}
        title="Usage"
        action={
          <View className="flex-row items-center">
            <Pressable
              onPress={() => setMonth((m) => shiftUsageMonth(m, -1))}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              className="size-11 items-center justify-center"
            >
              <ChevronLeft size={16} className="text-muted-foreground" />
            </Pressable>
            <Text className="text-xs text-muted-foreground">{usageMonthLabel(month)}</Text>
            <Pressable
              onPress={() => setMonth((m) => shiftUsageMonth(m, 1))}
              disabled={current}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              className={cn('size-11 items-center justify-center', current && 'opacity-30')}
            >
              <ChevronRight size={16} className="text-muted-foreground" />
            </Pressable>
          </View>
        }
      >
        {usage && (
          <View className="gap-4">
            <View className="gap-2">
              <View className="flex-row items-baseline justify-between gap-3">
                <Text className="text-title font-semibold text-foreground" style={TABULAR}>
                  {formatMicros(total)}
                </Text>
                <Text className="text-xs text-muted-foreground" style={TABULAR}>
                  {usage.budgetCents !== null ? `of ${formatCents(usage.budgetCents)} · ` : ''}
                  {usage.summary.turns} {usage.summary.turns === 1 ? 'reply' : 'replies'}
                </Text>
              </View>
              <BudgetMeter spentMicros={total} budgetCents={usage.budgetCents} warnAtPercent={usage.warnAtPercent} />
              {usage.allowanceCents !== null && (
                <Text className="text-xs text-muted-foreground" style={TABULAR}>
                  Plus includes {formatCents(usage.allowanceCents)} a month on Rooftap&apos;s key; {formatMicros(usage.serverMicros)} used.
                </Text>
              )}
            </View>

            <View className="gap-2">
              <SettingsLabel>People</SettingsLabel>
              <SettingsInset>
                {usage.members.map((m) => (
                  <View key={m.userId} className="gap-2 px-3.5 py-3">
                    <View className="flex-row items-center gap-3">
                      <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium text-foreground">
                        {m.name}
                      </Text>
                      <Text className="text-sm text-foreground" style={TABULAR}>
                        {formatMicros(m.spentMicros)}
                      </Text>
                    </View>
                    <BudgetMeter spentMicros={m.spentMicros} budgetCents={m.budgetCents} warnAtPercent={usage.warnAtPercent} />
                    <View className="flex-row items-center gap-3">
                      <MoneyInput
                        value={m.budgetCents}
                        placeholder="No limit"
                        label={`${m.name}'s monthly allowance`}
                        disabled={!isOwner}
                        onSave={(monthlyBudgetCents) => void saveLimit(m.userId, { monthlyBudgetCents })}
                      />
                      <Text className="min-w-0 flex-1 text-right text-xs text-muted-foreground">Lookups only</Text>
                      <Switch
                        checked={m.readOnly}
                        disabled={!isOwner}
                        label={`${m.name}: lookups only`}
                        onChange={(readOnly) => void saveLimit(m.userId, { readOnly })}
                      />
                    </View>
                  </View>
                ))}
              </SettingsInset>
              <Text className="px-1 text-xs text-muted-foreground">
                An allowance caps one person each month. Lookups only lets them ask but not change anything.
              </Text>
            </View>

            <Slices label="By feature" slices={usage.summary.byFeature} />
            <Slices label="By model" slices={usage.summary.byModel} />
          </View>
        )}
      </SettingsPanel>
    </View>
  );
}
