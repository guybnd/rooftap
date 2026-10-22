'use client';

// Up Bank connector: one read of Up per Costs visit, shared by the spending
// card, the cost rows ("Paid 3w ago") and the cost editor's "Paid from Up"
// section on both apps. It shows what's stored straight away, then reads Up
// (the server skips that when it read Up under a minute ago) and shows the
// result. Servers without 'connectors.up-bank-links' answer the older
// spending call. Each app passes its own client (createUpBankApi).

import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { monthStartOf, type CostBankLink, type UpBankApi, type UpBankStatus, type UpOverview, type UpSpending } from './up-bank';

export interface UpOverviewState {
  status: UpBankStatus | null;
  /** The spending, plus balances and links on newer servers. */
  data: (UpSpending & Partial<UpOverview>) | null;
  error: string | null;
  /** The server can link payments to cost lines. */
  linking: boolean;
  /** Read the stored data again (after a link changes). */
  reload: () => void;
}

const UpOverviewContext = createContext<UpOverviewState>({
  status: null,
  data: null,
  error: null,
  linking: false,
  reload: () => {},
});

export function UpOverviewProvider({
  api,
  enabled,
  linking,
  children,
}: {
  api: UpBankApi;
  enabled: boolean;
  linking: boolean;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<UpBankStatus | null>(null);
  const [data, setData] = useState<UpOverviewState['data']>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const month = monthStartOf(new Date());

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const read = () => (linking ? api.overview(month) : api.spending(month));
    void (async () => {
      try {
        const s = await api.status();
        if (!live) return;
        setStatus(s);
        if (!s.allowed || !s.connection) return;
        const first = await read();
        if (live) setData(first);
        const synced = await api.sync().catch((err: unknown) => {
          if (live) setError(err instanceof Error ? err.message : "Couldn't reach Up.");
          return null;
        });
        if (synced && live) {
          setStatus(synced.status);
          if (synced.saved > 0) {
            const next = await read();
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
  }, [api, enabled, linking, month]);

  // A reload reads only what's stored: Up was just read on open.
  useEffect(() => {
    if (!round || !enabled) return;
    let live = true;
    (linking ? api.overview(month) : api.spending(month))
      .then((next) => {
        if (live) setData(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, round, enabled, linking, month]);

  const value = useMemo<UpOverviewState>(
    () => ({ status, data, error, linking: enabled && linking, reload: () => setRound((r) => r + 1) }),
    [status, data, error, enabled, linking],
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
