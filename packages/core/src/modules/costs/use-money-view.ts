'use client';

// The Up Bank state behind Costs, shared by both apps' screens: the Money
// view's transaction list, the transaction sheet, a shop's payments sheet and
// the cost editor's "Paid from your bank" section. Each app passes its own
// createUpBankApi client and keeps its own rendering, toasts and haptics;
// `notify` is the app's plain toast.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CostCategory, CostItem } from '../../types';
import { CATEGORY_META } from './costs';
import { costItemsToOptions } from './cost-items';
import { paymentCategory, paymentGoes, type PaymentDirection } from './month-spending';
import { useUpOverview } from './up-overview';
import {
  bankLineAmount,
  bankMatchParts,
  filterBankTransactions,
  moneyIn,
  squashVendor,
  type BankTransactionPatch,
  type BankTransactionView,
  type CostBankDetail,
  type MakeCostPreview,
  type SpendingTransaction,
  type UpBankApi,
} from './up-bank';

const messageOf = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** The Assistant ask behind Costs' "Summarise this month". */
export function costsSummaryAsk(month: string): string {
  return `Summarise our costs for ${month}: what we spent against the goal, the biggest categories, how it compares with the month before, and anything worth a look.`;
}

/**
 * Move one payment, or with `wholeShop` every payment at its shop, to a
 * category. Resolves to the line the app's toast shows.
 */
export async function moveBankPayment(
  api: Pick<UpBankApi, 'changeShop' | 'updateTransaction'>,
  t: Pick<SpendingTransaction, 'id' | 'description'>,
  to: CostCategory,
  wholeShop: boolean
): Promise<string> {
  if (wholeShop) await api.changeShop({ vendor: t.description, category: to });
  else await api.updateTransaction(t.id, { costCategory: to });
  return `Moved ${wholeShop ? t.description : 'the payment'} to ${CATEGORY_META[to].label}`;
}

/** The Money view: a month of transactions, its filters, and the changes made from the list. */
export function useMoneyTransactions(api: UpBankApi, items: CostItem[], notify: (message: string) => void) {
  const { status, data, reload, month, scope } = useUpOverview();
  const [showHidden, setShowHidden] = useState(false);
  const [rows, setRows] = useState<BankTransactionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [direction, setDirection] = useState<PaymentDirection>('all');
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const load = useCallback(async () => {
    try {
      const page = await api.transactions({ month, scope: scope ?? undefined, hidden: showHidden });
      setRows(page.transactions);
      setError(null);
    } catch (err) {
      setError(messageOf(err, "Couldn't read your transactions."));
    }
  }, [api, month, scope, showHidden]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load, status?.connection?.lastSyncedAt]);
  useEffect(() => setCategory(null), [month, scope]);

  const apply = async (id: string, patch: BankTransactionPatch) => {
    try {
      const saved = await api.updateTransaction(id, patch);
      setRows((cur) => (cur ?? []).map((r) => (r.id === id ? saved : r)).filter((r) => r.hidden === showHidden));
      reload();
    } catch (err) {
      setError(messageOf(err, "Couldn't save."));
    }
  };

  // Swipe right or "Move to": this payment alone, or its whole shop with the switch.
  const moveTo = async (t: BankTransactionView, c: CostCategory, wholeShop: boolean) => {
    if (!wholeShop) return apply(t.id, { costCategory: c });
    try {
      await api.changeShop({ vendor: t.description, category: c });
      reload();
      await load();
      notify(`Moved ${t.description} to ${CATEGORY_META[c].label}`);
    } catch (err) {
      setError(messageOf(err, "Couldn't move the shop."));
    }
  };

  /** A payment made into a cost line: show it linked. */
  const madeCost = (saved: BankTransactionView) => {
    setRows((cur) => (cur ?? []).map((r) => (r.id === saved.id ? saved : r)));
    reload();
  };

  const accounts = data?.accounts ?? [];
  const open = rows?.find((r) => r.id === openId) ?? null;
  const shown = rows ? filterBankTransactions(rows, { query, category }).filter((r) => paymentGoes(r, direction)) : null;
  // Household only: what came into the joint accounts this month.
  const income =
    scope === 'household' && rows && !showHidden
      ? moneyIn(rows, accounts.filter((a) => a.joint).map((a) => a.name))
      : null;

  return {
    rows,
    error,
    showHidden,
    setShowHidden,
    openId,
    setOpenId,
    query,
    setQuery,
    category,
    setCategory,
    direction,
    setDirection,
    itemById,
    load,
    apply,
    moveTo,
    madeCost,
    accounts,
    /** Everyday plus savers across the accounts the viewer may see. */
    total: (data?.everydayCents ?? 0) + (data?.saversCents ?? 0),
    open,
    shown,
    income,
  };
}

/** One transaction's sheet: its note, its category, "always link" for its payee, and "Make it a cost". */
export function useTransactionSheet(
  api: UpBankApi,
  opts: {
    t: BankTransactionView | null;
    items: CostItem[];
    quickMove: boolean;
    onPatch: (patch: BankTransactionPatch) => void;
    onMadeCost: (saved: BankTransactionView) => void;
    /** A whole shop moved: read the payments again. */
    onShopMoved?: () => void;
    notify: (message: string) => void;
  }
) {
  const { t, items } = opts;
  const { data, reload } = useUpOverview();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState<MakeCostPreview | null>(null);
  const [costName, setCostName] = useState('');
  const [linkPayee, setLinkPayee] = useState(true);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [wholeShop, setWholeShop] = useState(false);
  useEffect(() => {
    setNote(null);
    setMaking(null);
    setSheetError(null);
    setMoving(false);
    setWholeShop(false);
  }, [t?.id]);
  const canMove = !!t && t.mine && t.amountCents < 0 && !t.isTransfer && opts.quickMove;

  // One payment moves on its own; with the switch on, its whole shop does.
  const moveTo = async (c: CostCategory) => {
    if (!t) return;
    setMoving(false);
    if (!wholeShop) {
      opts.onPatch({ costCategory: c });
      return;
    }
    try {
      await api.changeShop({ vendor: t.description, category: c });
      reload();
      opts.onShopMoved?.();
      opts.notify(`Moved ${t.description} to ${CATEGORY_META[c].label}`);
    } catch (err) {
      setSheetError(messageOf(err, "Couldn't move the shop."));
    }
  };

  const startMaking = async () => {
    if (!t) return;
    setBusy(true);
    setSheetError(null);
    try {
      const plan = await api.costPreview(t.id);
      setMaking(plan);
      setCostName(plan.name);
      setLinkPayee(plan.seen > 1);
    } catch (err) {
      setSheetError(messageOf(err, "Couldn't read that payment."));
    } finally {
      setBusy(false);
    }
  };
  const saveCost = async () => {
    if (!t || !making) return;
    setBusy(true);
    setSheetError(null);
    try {
      const made = await api.makeCost(t.id, { name: costName.trim() || making.name, linkPayee });
      setMaking(null);
      opts.onMadeCost(made.transaction);
    } catch (err) {
      setSheetError(messageOf(err, "Couldn't make the cost."));
    } finally {
      setBusy(false);
    }
  };

  const line = t?.costItemId ? items.find((i) => i.id === t.costItemId) ?? null : null;
  const category = t ? paymentCategory(t, new Map(line ? [[line.id, line]] : [])) : null;
  const rule = line ? data?.links?.find((l) => l.costItemId === line.id) ?? null : null;
  const always = !!rule && !!t && bankMatchParts(rule.match).some((m) => m.toUpperCase() === t.description.toUpperCase());
  const options = useMemo(() => costItemsToOptions(items.filter((i) => !i.deleted)), [items]);

  const setAlways = async (on: boolean) => {
    if (!t || !line) return;
    setBusy(true);
    try {
      if (on) await api.setCostLink(line.id, { match: t.description, keepAmount: rule?.keepAmount ?? false });
      else await api.removeCostLink(line.id);
      reload();
    } finally {
      setBusy(false);
    }
  };

  return {
    note,
    setNote,
    busy,
    making,
    setMaking,
    costName,
    setCostName,
    linkPayee,
    setLinkPayee,
    sheetError,
    moving,
    setMoving,
    wholeShop,
    setWholeShop,
    canMove,
    moveTo,
    startMaking,
    saveCost,
    line,
    category,
    rule,
    always,
    options,
    /** What the payment cost, as a positive amount. */
    paid: t ? -t.amountCents : 0,
    setAlways,
  };
}

/** A shop's payments in one month, for the sheet a shop row opens. */
export function useShopPayments(
  api: UpBankApi,
  line: { vendor?: string | null; name: string } | null,
  /** YYYY-MM. */
  month: string
) {
  const { scope, reload } = useUpOverview();
  const [rows, setRows] = useState<BankTransactionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!line) return;
    setRows(null);
    setError(null);
    let live = true;
    api
      .transactions({ month: `${month}-01`, scope: scope ?? undefined })
      .then((page) => {
        if (!live) return;
        const key = squashVendor(line.vendor ?? line.name);
        setRows(page.transactions.filter((t) => !t.isTransfer && !t.hidden && squashVendor(t.description.replace(/[\\\s]+$/, '')) === key));
      })
      .catch((err) => live && setError(messageOf(err, "Couldn't read the payments.")));
    return () => {
      live = false;
    };
  }, [api, line, month, scope, nonce]);

  const apply = async (id: string, patch: BankTransactionPatch) => {
    try {
      const saved = await api.updateTransaction(id, patch);
      setRows((cur) => (cur ?? []).map((r) => (r.id === id ? saved : r)));
      reload();
    } catch (err) {
      setError(messageOf(err, "Couldn't save."));
    }
  };

  return {
    rows,
    error,
    openId,
    setOpenId,
    apply,
    /** A payment made into a cost line: show it linked. */
    madeCost: (saved: BankTransactionView) => {
      setRows((cur) => (cur ?? []).map((r) => (r.id === saved.id ? saved : r)));
      reload();
    },
    /** Read the payments again (after the whole shop moved). */
    refresh: () => setNonce((n) => n + 1),
    open: rows?.find((r) => r.id === openId) ?? null,
  };
}

/** The cost editor's "Paid from your bank" section: the line's link rule and latest payments. */
export function usePaidFromUp(
  api: UpBankApi,
  opts: {
    show: boolean;
    costItemId: string;
    amountCents: number;
    /** Whether the line is an estimate: it keeps in step with the average of its latest three payments. */
    estimate: boolean;
    onAmount: (cents: number) => void;
    onMerged?: () => void;
  }
) {
  const { show, costItemId } = opts;
  const { reload } = useUpOverview();
  const [detail, setDetail] = useState<CostBankDetail | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!show) return;
    let live = true;
    api
      .costLink(costItemId)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((err: unknown) => {
        if (live) setError(messageOf(err, "Couldn't read your bank payments."));
      });
    return () => {
      live = false;
    };
  }, [api, show, costItemId]);

  // Turning Estimate on or off in the editor changes what a kept-in-step
  // line should carry (the latest payment, or the average of three).
  useEffect(() => {
    if (!detail?.rule?.keepAmount) return;
    const settled = detail.payments.filter((p) => !p.pending).map((p) => p.amountCents);
    const next = bankLineAmount(settled, opts.estimate);
    if (next != null && next !== opts.amountCents) opts.onAmount(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.estimate, detail]);

  const change = async (run: () => Promise<CostBankDetail>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await run();
      setDetail(next);
      if (next.rule?.keepAmount && next.amountCents != null && next.amountCents !== opts.amountCents) opts.onAmount(next.amountCents);
      setPicking(false);
      reload();
    } catch (err) {
      setError(messageOf(err, "Couldn't save the link."));
    } finally {
      setBusy(false);
    }
  };

  const merge = async (into: CostItem) => {
    setBusy(true);
    setError(null);
    try {
      await api.mergeCostLine(costItemId, into.id);
      reload();
      opts.onMerged?.();
    } catch (err) {
      setError(messageOf(err, "Couldn't merge the lines."));
      setBusy(false);
    }
  };

  return { detail, picking, setPicking, busy, error, change, merge, rule: detail?.rule ?? null };
}
