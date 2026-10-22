'use client';

// React glue for a Scout thread, shared by the web page and the native
// screen: loads the thread (polling while a run researches), sends a
// follow-up with the person's words shown at once, and works out what the
// page shows. Each app passes its own API calls.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { scoutRunStatus, type ShopperPick, type ShopperSearch } from './shopper-scout';
import { scoutLatestRun, scoutSuggestions, scoutTimeline, type ScoutMessage, type ScoutThread } from './shopper-scout-thread';

const POLL_MS = 3000;

export interface ScoutThreadApi {
  load: (id: string) => Promise<{ search: ShopperSearch | null; picks: ShopperPick[]; thread?: ScoutThread | null }>;
  send: (threadId: string, text: string, pickId: string | null) => Promise<{ messages: ScoutMessage[]; search?: ShopperSearch }>;
}

export function useScoutThread(id: string, api: ScoutThreadApi) {
  // undefined while loading, null when it isn't there.
  const [thread, setThread] = useState<ScoutThread | null | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const [pending, setPending] = useState<{ text: string; pickId: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .load(id)
      .then((run) => {
        if (cancelled) return;
        if (!run.search) return setThread(null);
        // A server from before threads sends only the run and its picks.
        setThread(run.thread ?? { runs: [run.search], picks: run.picks, messages: [] });
      })
      .catch(() => !cancelled && setThread((prev) => prev ?? null));
    return () => {
      cancelled = true;
    };
    // api is a stable module-level object in both apps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tick]);

  const running = !!thread?.runs.some((r) => scoutRunStatus(r) === 'running');
  // Poll while a run researches; each lands in a minute or so.
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setTick((n) => n + 1), POLL_MS);
    return () => clearTimeout(t);
  }, [running, tick]);

  const root = thread ? (thread.runs.find((r) => !r.thread_id) ?? thread.runs[0]) : null;
  const latest = thread ? scoutLatestRun(thread) : null;
  const latestPicks = useMemo(
    () => (thread && latest ? thread.picks.filter((p) => p.search_id === latest.id && !p.deleted).sort((a, b) => a.rank - b.rank) : []),
    [thread, latest],
  );
  const items = useMemo(() => (thread ? scoutTimeline(thread) : []), [thread]);
  const suggestions = useMemo(() => (latest && !running ? scoutSuggestions(latestPicks, latest.brief) : []), [latest, latestPicks, running]);

  const send = useCallback(
    async (text: string, pickId: string | null) => {
      if (!root || pending) return;
      setPending({ text, pickId });
      try {
        const out = await api.send(root.id, text, pickId);
        setThread((prev) =>
          prev
            ? {
                ...prev,
                runs: out.search ? [...prev.runs, out.search] : prev.runs,
                messages: [...prev.messages, ...(out.messages ?? [])],
              }
            : prev,
        );
      } finally {
        setPending(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root?.id, pending],
  );

  return {
    thread,
    root,
    latest,
    latestPicks,
    items,
    suggestions,
    running,
    /** The follow-up being sent, shown as the person's message until Scout answers. */
    pending,
    send,
    refresh: () => setTick((n) => n + 1),
  };
}
