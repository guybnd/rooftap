'use client';

// Up Bank connector: the cost editor's "Paid from Up" section (Guy's pick A2).
// A cost line links to bank payments by payee name or Up tag; the server then
// files every matching payment under the line, and with "Keep the amount in
// step" sets the line's amount to each new settled payment. Linked lines show
// their latest payments here, the ones that differ from the line tinted as a
// warning (status hue in a small dose). Shows only for a saved line once this
// person has Up connected on a server that links (core up-overview.ts).
// Native twin: apps/mobile/src/features/costs/cost-bank-link.tsx.

import { useEffect, useState } from 'react';
import { bankLineAmount, formatMoney, timeAgo, useUpConnected, useUpOverview, type BankPayee, type CostBankDetail, type CostCategory } from '@homeup/core';
import { upBankApi } from '@/lib/up-bank-client';
import { FieldRow, FormSection } from '@/components/ui/item-form-sheet';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';


function matchLabel(match: string): string {
  return match.startsWith('#') ? `Tagged ${match}` : `Payments to "${match}"`;
}

export function CostBankLink({
  costItemId,
  category,
  amountCents,
  estimate,
  onAmount,
}: {
  costItemId: string;
  category: CostCategory;
  amountCents: number;
  /** Whether the line is an estimate: it keeps in step with the average of its latest three payments. */
  estimate: boolean;
  /** The server set the line's amount from its payments (kept in step), so the open editor takes it before Save. */
  onAmount: (cents: number) => void;
}) {
  const connected = useUpConnected();
  const { linking, reload } = useUpOverview();
  const [detail, setDetail] = useState<CostBankDetail | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = connected && linking;
  useEffect(() => {
    if (!show) return;
    let live = true;
    upBankApi
      .costLink(costItemId)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Couldn't read Up payments.");
      });
    return () => {
      live = false;
    };
  }, [show, costItemId]);

  // Turning Estimate on or off in the editor changes what a kept-in-step
  // line should carry (the latest payment, or the average of three).
  useEffect(() => {
    if (!detail?.rule?.keepAmount) return;
    const settled = detail.payments.filter((p) => !p.pending).map((p) => p.amountCents);
    const next = bankLineAmount(settled, estimate);
    if (next != null && next !== amountCents) onAmount(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate, detail]);

  if (!show) return null;

  const change = async (run: () => Promise<CostBankDetail>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await run();
      setDetail(next);
      if (next.rule?.keepAmount && next.amountCents != null && next.amountCents !== amountCents) onAmount(next.amountCents);
      setPicking(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the link.");
    } finally {
      setBusy(false);
    }
  };

  const rule = detail?.rule ?? null;

  return (
    <FormSection title="Paid from Up">
      {!detail ? (
        <p className="px-1 text-sm text-muted-foreground">{error ?? 'Reading your Up payments…'}</p>
      ) : picking ? (
        <PayeePicker
          category={category}
          busy={busy}
          onPick={(match) => change(() => upBankApi.setCostLink(costItemId, { match, keepAmount: rule?.keepAmount ?? false }))}
          onCancel={() => setPicking(false)}
        />
      ) : !rule ? (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex min-h-12 w-full items-center rounded-2xl bg-muted/40 px-4 text-left text-sm font-medium text-primary hover:bg-muted/60"
        >
          Link to Up payments
        </button>
      ) : (
        <div className="rounded-2xl bg-muted/40">
          <div className="flex min-h-12 items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{matchLabel(rule.match)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {detail.payments.length === 0 ? 'None found yet' : `${detail.payments.length === 6 ? '6 or more' : detail.payments.length} found`}
              </p>
            </div>
            <button type="button" onClick={() => setPicking(true)} className="min-h-10 px-1 text-sm font-semibold text-primary hover:text-primary/80">
              Change
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => change(() => upBankApi.removeCostLink(costItemId))}
              className="min-h-10 px-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Unlink
            </button>
          </div>
          <div className="flex min-h-12 items-center gap-3 border-t border-border/60 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">Keep the amount in step</p>
              <p className="text-xs text-muted-foreground">
                {estimate ? 'Takes the average of the latest 3 payments' : 'When Up shows a new amount, this line takes it'}
              </p>
            </div>
            <Switch
              checked={rule.keepAmount}
              disabled={busy}
              label="Keep the amount in step"
              onChange={(next) => change(() => upBankApi.setCostLink(costItemId, { match: rule.match, keepAmount: next }))}
            />
          </div>
          {detail.payments.length > 0 && (
            <div className="divide-y divide-border/60 border-t border-border/60 px-4">
              {detail.payments.map((p) => (
                <div key={p.id} className="flex min-h-10 items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {p.pending ? 'Pending · ' : ''}
                    {timeAgo(p.occurredAt)}
                  </span>
                  <span className={cn('tabular-nums', -p.amountCents !== amountCents ? 'text-warning' : 'text-foreground')}>
                    {formatMoney(-p.amountCents)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {error && detail && <p className="px-1 text-xs text-destructive">{error}</p>}
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
    <div className="space-y-2">
      <FieldRow hint="Pick who you pay, or type part of their name. Start with # for an Up tag.">
        <div className="flex items-center gap-2">
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your Up payments" />
          <button type="button" onClick={onCancel} className="min-h-10 shrink-0 px-1 text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      </FieldRow>
      <div className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-2xl bg-muted/40">
        {typed.length >= 2 && !payees?.some((p) => p.match.toLowerCase() === typed.toLowerCase()) && (
          <PayeeRow title={typed.startsWith('#') ? `Tagged ${typed}` : `Payments containing "${typed}"`} meta="Use what you typed" busy={busy} onPick={() => onPick(typed)} />
        )}
        {payees === null ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Looking through your payments…</p>
        ) : payees.length === 0 && typed.length < 2 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No payments in the last six months.</p>
        ) : (
          payees.map((p) => (
            <PayeeRow
              key={p.match}
              title={p.label}
              meta={[p.suggested ? 'Suggested' : null, `${p.count} payment${p.count === 1 ? '' : 's'}`, `last ${formatMoney(p.lastAmountCents)}`]
                .filter(Boolean)
                .join(' · ')}
              busy={busy}
              onPick={() => onPick(p.match)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PayeeRow({ title, meta, busy, onPick }: { title: string; meta: string; busy: boolean; onPick: () => void }) {
  return (
    <button type="button" disabled={busy} onClick={onPick} className="flex min-h-12 w-full flex-col justify-center px-4 py-2 text-left hover:bg-muted/60 disabled:opacity-50">
      <span className="truncate text-sm font-medium text-foreground">{title}</span>
      <span className="truncate text-xs text-muted-foreground">{meta}</span>
    </button>
  );
}
