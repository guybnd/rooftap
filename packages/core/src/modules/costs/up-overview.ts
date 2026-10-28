'use client';

// Up Bank connector: one read of Up per Costs visit, shared by the spending
// card, the cost rows ("Paid 3w ago") and the cost editor's "Paid from Up"
// section on both apps. It shows what's stored straight away, then reads Up
// (the server skips that when it read Up under a minute ago) and shows the
// result. Servers without 'connectors.up-bank-links' answer the older
// spending call. Each app passes its own client (createUpBankApi). The month
// and the Household | Mine scope live here too, so the card and the Money
// view step through the same month; the scope goes to servers with
// 'connectors.up-bank-sharing' only. The last read of each month and scope
// stays in memory for the app session, so coming back to Costs or Home shows
// it straight away (the read still runs and replaces it); sign-out clears it
// (clearUpOverviewCache). The opening read of this month also goes to readers
// outside a provider (useOpeningCostMonth: the phone's widget), so they show
// the figure Costs opens on. With initUpOverviewMemory, the last totals of
// this month and whether Up is connected outlive the app session (never a
// payment), so Home and the widget open on them instead of waiting.

export type UpViewScope = Exclude<BankScope, 'all'>;

import { createContext, createElement, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { costTargets, type BankActuals } from './costs';
import { bankActualsOf, monthTotals, type MonthTotals } from './money-insights';
import { costMonths, type CostMonth } from './cost-month';
import type { CostItem } from '../../types';
import { monthStartOf, type BankScope, type BankShareMode, type CostBankLink, type UpBankApi, type UpBankStatus, type UpOverview, type UpSpending } from './up-bank';

export interface UpOverviewState {
  status: UpBankStatus | null;
  /** The spending, plus balances and links on newer servers. */
  data: (UpSpending & Partial<UpOverview>) | null;
  error: string | null;
  /**
   * The first read has settled: bank data is in, or there is none to wait
   * for (off, not connected, or it failed). Totals drawn before this would
   * leave the bank's payments out and jump once they land.
   */
  ready: boolean;
  /** The server can link payments to cost lines. */
  linking: boolean;
  /** Read the stored data again (after a link changes). */
  reload: () => void;
  /** The month shown, YYYY-MM-01. */
  month: string;
  setMonth: (month: string) => void;
  /** Household (what's shared) or Mine; null on servers that can't split them. */
  scope: UpViewScope | null;
  setScope: (scope: UpViewScope) => void;
}

// Memory only: bank payments never go to device storage from here.
let lastStatus: UpBankStatus | null = null;
const lastReads = new Map<string, UpOverviewState['data']>();
const readKey = (month: string, scope: UpViewScope | null) => `${month}|${scope ?? ''}`;

/** Where the last totals are kept between launches (localStorage, the phone's key-value store). */
export interface UpOverviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const KEPT_KEY = 'homeup:costs-kept-month';
/** Totals only: whether Up is connected and this month as Costs last opened on it. */
interface Kept {
  connected: boolean;
  shareMode: BankShareMode | null;
  month: Pick<CostMonth, 'month' | 'paidCents' | 'toComeCents' | 'expectedCents' | 'incomeCents' | 'incomeExpectedCents'> | null;
}
let storage: UpOverviewStorage | null = null;
let kept: Kept | null = null;

/** Load the kept totals (once at start; safe to call again). */
export function initUpOverviewMemory(kv: UpOverviewStorage): void {
  storage = kv;
  try {
    const raw = kv.getItem(KEPT_KEY);
    kept = raw ? (JSON.parse(raw) as Kept) : null;
  } catch {
    kept = null;
  }
  openingChanged();
}

function keep(next: Kept) {
  kept = next;
  try {
    storage?.setItem(KEPT_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the totals still hold for this session.
  }
}

function keepMonth(month: CostMonth) {
  const k = kept ?? { connected: false, shareMode: null, month: null };
  const { paidCents, toComeCents, expectedCents, incomeCents, incomeExpectedCents } = month;
  const m = k.month;
  if (m && m.month === month.month && m.paidCents === paidCents && m.expectedCents === expectedCents && m.toComeCents === toComeCents) return;
  keep({ ...k, month: { month: month.month, paidCents, toComeCents, expectedCents, incomeCents, incomeExpectedCents } });
}

/** The kept totals of this month, as a CostMonth with no categories; null when there are none. */
let keptShown: { from: Kept['month']; month: CostMonth } | null = null;
function keptMonth(now: Date): CostMonth | null {
  const m = kept?.month;
  if (!m || m.month !== monthKeyOf(now)) return null;
  // The same object while the totals stay, so readers don't redraw for nothing.
  if (keptShown?.from !== m) keptShown = { from: m, month: { ...m, when: 'current', categories: [], income: null } };
  return keptShown.month;
}
// This month as Costs opens on it, for useOpeningCostMonth.
let openingRead: { month: string; data: UpOverviewState['data'] } | null = null;
let openingVersion = 0;
const openingListeners = new Set<() => void>();
function openingChanged() {
  openingVersion += 1;
  for (const listener of openingListeners) listener();
}

/** Forget the last bank reads (on sign-out, so the next person never sees them). */
export function clearUpOverviewCache(): void {
  lastStatus = null;
  lastReads.clear();
  openingRead = null;
  kept = null;
  try {
    storage?.setItem(KEPT_KEY, 'null');
  } catch {
    // Nothing kept, or storage blocked.
  }
  openingChanged();
}

/** The scope Costs opens on: Mine for someone who shares nothing, else Household. */
function openingScope(status: UpBankStatus | null, sharing: boolean): UpViewScope | null {
  if (!sharing || !status?.connection) return null;
  return status.connection.shareMode === 'none' ? 'mine' : 'household';
}

const UpOverviewContext = createContext<UpOverviewState>({
  status: null,
  data: null,
  error: null,
  ready: true,
  linking: false,
  reload: () => {},
  month: monthStartOf(new Date()),
  setMonth: () => {},
  scope: null,
  setScope: () => {},
});

export function UpOverviewProvider({
  api,
  enabled,
  linking,
  sharing = false,
  children,
}: {
  api: UpBankApi;
  enabled: boolean;
  linking: boolean;
  /** The server can show Household and Mine apart ('connectors.up-bank-sharing'). */
  sharing?: boolean;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<UpBankStatus | null>(() => (enabled ? lastStatus : null));
  const [data, setData] = useState<UpOverviewState['data']>(() =>
    enabled ? lastReads.get(readKey(monthStartOf(new Date()), openingScope(lastStatus, sharing))) ?? null : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [month, setMonth] = useState(() => monthStartOf(new Date()));
  const [picked, setScope] = useState<UpViewScope | null>(null);
  // Someone who shares nothing starts on Mine: Household would leave them out.
  const scope: UpViewScope | null = !sharing || !status?.connection ? null : picked ?? openingScope(status, sharing);
  const read = async (m: string, s: UpViewScope | null) => {
    const next = await (linking ? api.overview(m, s ?? undefined) : api.spending(m));
    lastReads.set(readKey(m, s), next);
    return next;
  };
  const keepStatus = (s: UpBankStatus) => {
    lastStatus = s;
    const connected = s.allowed && !!s.connection;
    const shareMode = s.connection?.shareMode ?? null;
    if (kept?.connected !== connected || kept.shareMode !== shareMode) keep({ month: kept?.month ?? null, connected, shareMode });
    setStatus(s);
    openingChanged();
  };
  const keepOpening = (m: string, next: UpOverviewState['data']) => {
    openingRead = { month: m, data: next };
    openingChanged();
  };
  const opened = status?.connection != null;

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const month = monthStartOf(new Date());
    void (async () => {
      try {
        // Seen connected before (this session, or kept from the last one):
        // read the stored payments while the status call is out, instead of
        // one after the other.
        const guess =
          lastStatus?.allowed && lastStatus.connection
            ? openingScope(lastStatus, sharing)
            : !lastStatus && kept?.connected
              ? (sharing ? (kept.shareMode === 'none' ? 'mine' : 'household') : null)
              : undefined;
        const early = guess === undefined ? null : read(month, guess);
        early?.catch(() => {});
        const s = await api.status();
        if (!live) return;
        keepStatus(s);
        if (!s.allowed || !s.connection) {
          setData(null);
          return;
        }
        const opening = openingScope(s, sharing);
        const first = early && opening === guess ? await early : await read(month, opening);
        keepOpening(month, first);
        if (live) setData(first);
        const synced = await api.sync().catch((err: unknown) => {
          if (live) setError(err instanceof Error ? err.message : "Couldn't reach Up.");
          return null;
        });
        if (synced && live) {
          keepStatus(synced.status);
          if (synced.saved > 0) {
            const next = await read(month, opening);
            keepOpening(month, next);
            if (live) setData(next);
          }
        }
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : "Couldn't load Up spending.");
      }
    })();
    return () => {
      live = false;
    };
    // The opening read shows this month; the next effect follows changes.
  }, [api, enabled, linking, sharing]);

  // A reload, another month or another scope reads only what's stored: Up
  // was just read on open.
  const [shown, setShown] = useState<string | null>(null);
  const key = `${month}|${scope ?? ''}|${round}`;
  useEffect(() => {
    if (!enabled || !opened) return;
    if (shown === null) {
      setShown(key);
      return;
    }
    if (shown === key) return;
    // Seen this month and scope before: show it while the read runs.
    const seen = lastReads.get(readKey(month, scope));
    if (seen) setData(seen);
    let live = true;
    read(month, scope)
      .then((next) => {
        // A reload of the opening month and scope (after a payment moved) is the new opening figure.
        if (month === monthStartOf(new Date()) && scope === openingScope(lastStatus, sharing)) keepOpening(month, next);
        if (live) {
          setData(next);
          setShown(key);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key, enabled, opened]);

  const value = useMemo<UpOverviewState>(
    () => ({
      status,
      data,
      error,
      ready: !enabled || !!error || !!data || (status !== null && (!status.allowed || !status.connection)),
      linking: enabled && linking,
      reload: () => setRound((r) => r + 1),
      month,
      setMonth,
      scope,
      setScope,
    }),
    [status, data, error, enabled, linking, month, scope],
  );
  return createElement(UpOverviewContext.Provider, { value }, children);
}

export function useUpOverview(): UpOverviewState {
  return useContext(UpOverviewContext);
}

/** Whether this person has Up connected on this server. */
export function useUpConnected(): boolean {
  const { status } = useUpOverview();
  return !!status?.allowed && !!status.connection;
}

/** A cost line's link to Up payments, if it has one the viewer can see. */
export function useCostBankLink(costItemId: string): CostBankLink | undefined {
  const { data } = useUpOverview();
  return useMemo(() => data?.links?.find((l) => l.costItemId === costItemId), [data, costItemId]);
}

/**
 * What cost lines were really paid, for monthlyProjection: undefined until
 * the server sends actuals ('connectors.up-bank-auto'), so older servers keep
 * the plan-only chart.
 */
export function useBankActuals(): BankActuals | undefined {
  const { data } = useUpOverview();
  return useMemo(() => {
    if (!data?.actuals) return undefined;
    return bankActualsOf(data.actuals, data.links ?? [], data.actualsSince ?? null);
  }, [data]);
}

/**
 * This month's totals from the bank (monthTotals), for the household view
 * with lines linked to payments; null otherwise, and the caller keeps its
 * plan figure. Targets are left out here, as on the Costs screen.
 */
export function useMonthTotals(items: readonly CostItem[]): MonthTotals | null {
  const { data, month, scope } = useUpOverview();
  const bank = useBankActuals();
  const [current] = useCostMonths(items, useMemo(() => [monthKeyOf(new Date())], []));
  return useMemo(() => {
    const now = new Date();
    if (scope === 'mine' || month !== monthStartOf(now)) return null;
    // Servers that send the ledger: the same month the Costs screen shows.
    if (data?.ledger) {
      const byCategory: Record<string, number> = {};
      for (const c of current.categories) byCategory[c.category ?? 'other'] = (byCategory[c.category ?? 'other'] ?? 0) + c.paidCents + c.toComeCents;
      return { totalCents: current.expectedCents, paidCents: current.paidCents, toComeCents: current.toComeCents, byCategory };
    }
    if (!data || !bank || bank.linked.size === 0) return null;
    const targets = costTargets(items);
    return monthTotals(items.filter((i) => !i.deleted && !targets.has(i.id)), bank, data.spentCents, now);
  }, [data, bank, scope, month, items, current]);
}

/**
 * This month from costMonth, as the Costs hero shows it (Home's Budget space
 * and shortcut, whose provider stays on the opening scope). Until the bank's
 * payments are in (ready) it is the totals kept from the last time, so Home
 * opens on them; null when there are none, so Home never shows a total
 * without the payments that then jumps.
 */
export function useCurrentCostMonth(items: readonly CostItem[]): CostMonth | null {
  const { ready } = useUpOverview();
  const [current] = useCostMonths(items, useMemo(() => [monthKeyOf(new Date())], []));
  useEffect(() => {
    if (ready) keepMonth(current);
  }, [ready, current]);
  return ready ? current : keptMonth(new Date());
}

/**
 * This month as Costs opens on it, for a reader outside a provider (the
 * phone's widget): from the latest opening read of Home or Costs. `bankOn`:
 * the server has the Up connector. Before that read it is the kept totals;
 * null when there are none, so the reader keeps what it showed before rather
 * than a total without the bank's payments.
 */
export function useOpeningCostMonth(items: readonly CostItem[], bankOn: boolean): CostMonth | null {
  const version = useSyncExternalStore(
    (listener) => {
      openingListeners.add(listener);
      return () => openingListeners.delete(listener);
    },
    () => openingVersion,
    () => openingVersion,
  );
  return useMemo(() => {
    const now = new Date();
    const key = monthKeyOf(now);
    const month = (data: UpOverviewState['data']) => monthsOf(items, data, now, [key])[0];
    if (!bankOn) return month(null);
    if (!lastStatus) return keptMonth(now);
    if (!lastStatus.allowed || !lastStatus.connection) return month(null);
    if (!openingRead?.data || openingRead.month !== monthStartOf(now)) return keptMonth(now);
    return month(openingRead.data);
    // version: a new read or status.
  }, [items, bankOn, version]);
}

function monthsOf(items: readonly CostItem[], data: UpOverviewState['data'], now: Date, keys: readonly string[]): CostMonth[] {
  const linked = new Set((data?.links ?? []).map((l) => l.costItemId));
  return costMonths({ items, ledger: data?.ledger ?? [], now, linked, since: data?.actualsSince ?? null }, keys);
}

/**
 * Months worked out by costMonth (YYYY-MM keys), from the cost lines and the
 * payments the overview sent. Without a payment source (or before the server
 * sends its ledger) only the lines added by hand count.
 */
export function useCostMonths(items: readonly CostItem[], keys: readonly string[]): CostMonth[] {
  const { data } = useUpOverview();
  return useMemo(() => monthsOf(items, data, new Date(), keys), [data, items, keys]);
}

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** What a cost line was really paid in a YYYY-MM month, or null when the bank has nothing for it. */
export function useCostActual(costItemId: string, month: string | undefined): number | null {
  const { data } = useUpOverview();
  return useMemo(() => {
    if (!month || !data?.actuals) return null;
    const hit = data.actuals.filter((a) => a.costItemId === costItemId && a.month === month);
    return hit.length ? hit.reduce((sum, a) => sum + a.cents, 0) : null;
  }, [data, costItemId, month]);
}
