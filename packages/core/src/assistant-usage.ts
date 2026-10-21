// Rooftap Assistant: what the household spends, shaped for the usage panel
// on both apps (HOUP-444). Rows come from `assistant_usage`, one per person,
// month, feature, model and key; this folds them into totals and the three
// breakdowns the panel shows.

export type UsageFeature = 'chat' | 'quick' | 'household' | 'routine' | 'voice' | 'telegram';

export const USAGE_FEATURE_LABELS: Record<UsageFeature, string> = {
  chat: 'Chats',
  quick: 'Quick asks',
  household: 'Household thread',
  routine: 'Routines',
  voice: 'Voice',
  telegram: 'Telegram',
};

/** An `assistant_usage` row as the usage route returns it. */
export interface UsageRecord {
  user_id: string | null;
  feature: string;
  model: string;
  key_source: 'household' | 'server';
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
}

export interface UsageSlice {
  key: string;
  label: string;
  costMicros: number;
  turns: number;
  tokens: number;
}

export interface UsageSummary {
  costMicros: number;
  turns: number;
  tokens: number;
  byPerson: UsageSlice[];
  byFeature: UsageSlice[];
  byModel: UsageSlice[];
}

function fold(rows: UsageRecord[], keyOf: (r: UsageRecord) => string, labelOf: (key: string) => string): UsageSlice[] {
  const slices = new Map<string, UsageSlice>();
  for (const r of rows) {
    const key = keyOf(r);
    const slice = slices.get(key) ?? { key, label: labelOf(key), costMicros: 0, turns: 0, tokens: 0 };
    slice.costMicros += Number(r.cost_micros) || 0;
    slice.turns += Number(r.turns) || 0;
    slice.tokens += (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0);
    slices.set(key, slice);
  }
  return [...slices.values()].sort((a, b) => b.costMicros - a.costMicros || b.turns - a.turns || a.label.localeCompare(b.label));
}

/** Totals and per-person, per-feature and per-model breakdowns, biggest spend first. */
export function summarizeUsage(rows: UsageRecord[], names: Record<string, string>): UsageSummary {
  return {
    costMicros: rows.reduce((t, r) => t + (Number(r.cost_micros) || 0), 0),
    turns: rows.reduce((t, r) => t + (Number(r.turns) || 0), 0),
    tokens: rows.reduce((t, r) => t + (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0), 0),
    byPerson: fold(rows, (r) => r.user_id ?? 'household', (k) => (k === 'household' ? 'Household' : names[k] ?? 'Someone')),
    byFeature: fold(rows, (r) => r.feature, (k) => USAGE_FEATURE_LABELS[k as UsageFeature] ?? k),
    byModel: fold(rows, (r) => r.model, (k) => k),
  };
}

/** Share of a budget used, 0-100, or null with no budget. */
export function budgetPercent(spentMicros: number, budgetCents: number | null): number | null {
  if (budgetCents === null) return null;
  if (budgetCents <= 0) return spentMicros > 0 ? 100 : 0;
  return Math.min(100, Math.round((spentMicros / 10_000 / budgetCents) * 100));
}

/** "1.2k", "34k", "1.5M" tokens. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** "October 2026" for an `assistant_usage.month` value ("2026-10-01"). */
export function usageMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The month before or after an `assistant_usage.month` value. */
export function shiftUsageMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
