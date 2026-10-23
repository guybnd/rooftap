// Up Bank connector: the cost editor's "Paid from Up" section (Guy's pick A2).
// A cost line links to bank payments by payee name or Up tag; the server then
// files every matching payment under the line, and with "Keep the amount in
// step" sets the line's amount to each new settled payment. Linked lines show
// their latest payments here, the ones that differ from the line tinted as a
// warning (status hue in a small dose). Shows only for a saved line once this
// person has Up connected on a server that links (core up-overview.ts).
// Web twin: apps/web/src/app/costs/cost-bank-link.tsx.
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { FieldRow, FormSection, Input, Switch, Text, cn } from '@homeup/ui';
import { formatMoney, timeAgo, useCostMergeTargets, useUpConnected, useUpOverview, usePaidFromUp, bankMatchLabel, type BankPayee, type CostCategory, type CostItem } from '@homeup/core';
import { upBankApi } from './up-bank-api';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

export function CostBankLink({
  costItemId,
  category,
  amountCents,
  estimate,
  onAmount,
  line,
  onMerged,
}: {
  costItemId: string;
  category: CostCategory;
  amountCents: number;
  /** Whether the line is an estimate: it keeps in step with the average of its latest three payments. */
  estimate: boolean;
  /** The server set the line's amount from its payments (kept in step), so the open editor takes it before Save. */
  onAmount: (cents: number) => void;
  /** The saved line: one the bank made can merge into a line made by hand in its category. */
  line?: CostItem;
  /** The line merged away: the editor closes without saving it back. */
  onMerged?: () => void;
}) {
  const connected = useUpConnected();
  const mergeTargets = useCostMergeTargets(line, category);
  const { linking } = useUpOverview();
  const show = connected && linking;
  const { detail, picking, setPicking, busy, error, change, merge, rule } = usePaidFromUp(upBankApi, { show, costItemId, amountCents, estimate, onAmount, onMerged });

  if (!show) return null;

  return (
    <FormSection title="Paid from Up">
      {mergeTargets.length > 0 && (
        <View className="rounded-2xl bg-muted/40">
          <Text className="px-4 pt-3 text-xs text-muted-foreground">
            You already have {mergeTargets.length === 1 ? 'a line' : 'lines'} for this. Merge to keep one, with these payments filed under it.
          </Text>
          {mergeTargets.map((t, i) => (
            <View key={t.id} className={cn('mx-4 min-h-12 flex-row items-center gap-3', i > 0 && 'border-t border-border/60')}>
              <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground">
                {t.name}
              </Text>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => merge(t)} hitSlop={8} className="min-h-11 justify-center px-1">
                <Text className={cn('text-sm font-semibold text-primary', busy && 'opacity-50')}>Merge into it</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {!detail ? (
        <Text className="px-1 text-sm text-muted-foreground">{error ?? 'Reading your Up payments…'}</Text>
      ) : picking ? (
        <PayeePicker
          category={category}
          busy={busy}
          onPick={(match) => change(() => upBankApi.setCostLink(costItemId, { match, keepAmount: rule?.keepAmount ?? false }))}
          onCancel={() => setPicking(false)}
        />
      ) : !rule ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setPicking(true)}
          className="min-h-12 justify-center rounded-2xl bg-muted/40 px-4"
        >
          <Text className="text-sm font-medium text-primary">Link to Up payments</Text>
        </Pressable>
      ) : (
        <View className="rounded-2xl bg-muted/40">
          <View className="min-h-12 flex-row items-center gap-3 px-4 py-2">
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                {bankMatchLabel(rule.match)}
              </Text>
              <Text numberOfLines={1} className="text-xs text-muted-foreground">
                {detail.payments.length === 0 ? 'None found yet' : `${detail.payments.length === 6 ? '6 or more' : detail.payments.length} found`}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setPicking(true)} hitSlop={8} className="min-h-11 justify-center px-1">
              <Text className="text-sm font-semibold text-primary">Change</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => change(() => upBankApi.removeCostLink(costItemId))}
              hitSlop={8}
              className={cn('min-h-11 justify-center px-1', busy && 'opacity-50')}
            >
              <Text className="text-sm text-muted-foreground">Unlink</Text>
            </Pressable>
          </View>
          <View className="min-h-12 flex-row items-center gap-3 border-t border-border/60 px-4 py-2">
            <View className="min-w-0 flex-1">
              <Text className="text-sm text-foreground">Keep the amount in step</Text>
              <Text className="text-xs text-muted-foreground">
                {estimate ? 'Takes the average of the latest 3 payments' : 'When Up shows a new amount, this line takes it'}
              </Text>
            </View>
            <Switch
              checked={rule.keepAmount}
              disabled={busy}
              label="Keep the amount in step"
              onChange={(next) => change(() => upBankApi.setCostLink(costItemId, { match: rule.match, keepAmount: next }))}
            />
          </View>
          {detail.payments.length > 0 && (
            <View className="border-t border-border/60 px-4">
              {detail.payments.map((p, i) => (
                <View key={p.id} className={cn('min-h-10 flex-row items-center justify-between gap-3', i > 0 && 'border-t border-border/60')}>
                  <Text className="text-sm text-muted-foreground">
                    {p.pending ? 'Pending · ' : ''}
                    {timeAgo(p.occurredAt)}
                  </Text>
                  <Text className={cn('text-sm', -p.amountCents !== amountCents ? 'text-warning' : 'text-foreground')} style={TABULAR}>
                    {formatMoney(-p.amountCents)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
      {error && detail ? <Text className="px-1 text-xs text-destructive">{error}</Text> : null}
    </FormSection>
  );
}

function PayeePicker({
  category,
  busy,
  onPick,
  onCancel,
}: {
  category: CostCategory;
  busy: boolean;
  onPick: (match: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [payees, setPayees] = useState<BankPayee[] | null>(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      upBankApi
        .payees({ category, query: query.trim() })
        .then((p) => {
          if (live) setPayees(p);
        })
        .catch(() => {
          if (live) setPayees([]);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [category, query]);

  const typed = query.trim();
  return (
    <View className="gap-2">
      <FieldRow hint="Pick who you pay, or type part of their name. Start with # for an Up tag.">
        <View className="flex-row items-center gap-2">
          <Input className="flex-1" value={query} onChangeText={setQuery} placeholder="Search your Up payments" autoCorrect={false} />
          <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8} className="min-h-11 justify-center px-1">
            <Text className="text-sm text-muted-foreground">Cancel</Text>
          </Pressable>
        </View>
      </FieldRow>
      <View className="rounded-2xl bg-muted/40">
        {typed.length >= 2 && !payees?.some((p) => p.match.toLowerCase() === typed.toLowerCase()) && (
          <PayeeRow
            title={typed.startsWith('#') ? `Tagged ${typed}` : `Payments containing "${typed}"`}
            meta="Use what you typed"
            busy={busy}
            onPick={() => onPick(typed)}
          />
        )}
        {payees === null ? (
          <Text className="px-4 py-3 text-sm text-muted-foreground">Looking through your payments…</Text>
        ) : payees.length === 0 && typed.length < 2 ? (
          <Text className="px-4 py-3 text-sm text-muted-foreground">No payments in the last six months.</Text>
        ) : (
          payees.slice(0, 12).map((p, i) => (
            <PayeeRow
              key={p.match}
              divided={i > 0 || typed.length >= 2}
              title={p.label}
              meta={[p.suggested ? 'Suggested' : null, `${p.count} payment${p.count === 1 ? '' : 's'}`, `last ${formatMoney(p.lastAmountCents)}`]
                .filter(Boolean)
                .join(' · ')}
              busy={busy}
              onPick={() => onPick(p.match)}
            />
          ))
        )}
      </View>
    </View>
  );
}

function PayeeRow({ title, meta, busy, divided, onPick }: { title: string; meta: string; busy: boolean; divided?: boolean; onPick: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPick}
      className={cn('min-h-12 justify-center px-4 py-2', divided && 'border-t border-border/60', busy && 'opacity-50')}
    >
      <Text numberOfLines={1} className="text-sm font-medium text-foreground">
        {title}
      </Text>
      <Text numberOfLines={1} className="text-xs text-muted-foreground">
        {meta}
      </Text>
    </Pressable>
  );
}
