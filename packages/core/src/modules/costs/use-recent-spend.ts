'use client';

// The recent spending strip on the Costs Latest card, shared by both apps
// (recent-spend.ts has the sums). It reads money out per day from the Up
// overview; opening a window lights its days on a bar chart and lists that
// stretch's payments (tap a bar for one day's), read from the server, bills
// (isBillSpend) left out when the person asked. Each app keeps its own rendering.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CostItem } from '../../types';
import { useUpOverview } from './up-overview';
import { isBillSpend, localDayOf, readRecentSpendPrefs, recentBarCount, recentBars, recentSpend, recentWindowStart, type RecentBar, type RecentSpendPrefs, type RecentSpendWindow } from './recent-spend';
import type { BankTransactionView, UpBankApi } from './up-bank';

export interface RecentSpendState {
  /** One per chosen window; empty when the server sends no daily spend or the strip is off. */
  windows: RecentSpendWindow[];
  /** The open window's days, or null. */
  open: number | null;
  toggle: (days: number) => void;
  /** The open window's bars, oldest first. */
  bars: RecentBar[] | null;
  /** The open window's payments (or the picked day's), newest first; null while they load. */
  payments: BankTransactionView[] | null;
  /** A day picked on the bars (YYYY-MM-DD): the list shows just that day. */
  day: string | null;
  pickDay: (day: string) => void;
  error: string | null;
}

export function useRecentSpend(api: UpBankApi, items: readonly CostItem[], prefs: RecentSpendPrefs): RecentSpendState {
  const { data, scope } = useUpOverview();
  const days = data?.days;
  const [open, setOpen] = useState<number | null>(null);
  const [rows, setRows] = useState<BankTransactionView[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const windows = useMemo(() => (days && prefs.show ? recentSpend(days, items, prefs) : []), [days, items, prefs]);
  // A window that's no longer chosen closes.
  const shown = open != null && windows.some((w) => w.days === open) ? open : null;
  const bars = useMemo(() => (days && shown != null ? recentBars(days, items, prefs.skipBills, shown) : null), [days, items, prefs.skipBills, shown]);

  useEffect(() => {
    if (shown == null) return;
    let live = true;
    setRows(null);
    setError(null);
    const itemById = new Map(items.map((i) => [i.id, i]));
    api
      .transactions({ scope: scope ?? undefined, range: { from: recentWindowStart(recentBarCount(shown)), to: new Date(Date.now() + 60_000) } })
      .then((page) => {
        if (!live) return;
        setRows(page.transactions.filter((t) => !t.isTransfer && !t.hidden && t.amountCents < 0 && !(prefs.skipBills && isBillSpend({ costItemId: t.costItemId, category: t.costCategory, sourceCategory: t.category }, itemById))));
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : "Couldn't read the payments."));
    return () => {
      live = false;
    };
    // data: a move or a sync reloads the overview, so the list reads again.
  }, [api, items, prefs.skipBills, scope, shown, data]);

  // The list: the picked day, else the window's days (the read covers every bar).
  const payments = useMemo(() => {
    if (!rows || shown == null) return null;
    if (day) return rows.filter((t) => localDayOf(t.occurredAt) === day);
    const from = recentWindowStart(shown).getTime();
    return rows.filter((t) => Date.parse(t.occurredAt) >= from);
  }, [rows, day, shown]);

  return {
    windows,
    open: shown,
    toggle: (d) => {
      setDay(null);
      setOpen((cur) => (cur === d ? null : d));
    },
    bars,
    payments,
    day,
    pickDay: (d) => setDay((cur) => (cur === d ? null : d)),
    error,
  };
}

/**
 * A person's recent spending choices, from user_settings.costs_recent_spend.
 * `save` stores a change; servers before 'costs.recent-spend' pass null and
 * the change lasts until the screen closes.
 */
export function useRecentSpendPrefs(
  stored: unknown,
  save: ((next: RecentSpendPrefs) => void) | null,
): { prefs: RecentSpendPrefs; onChange: (next: RecentSpendPrefs) => void } {
  const [prefs, setPrefs] = useState<RecentSpendPrefs>(() => readRecentSpendPrefs(stored));
  useEffect(() => {
    if (stored) setPrefs(readRecentSpendPrefs(stored));
  }, [stored]);
  const onChange = useCallback(
    (next: RecentSpendPrefs) => {
      setPrefs(next);
      save?.(next);
    },
    [save],
  );
  return { prefs, onChange };
}
