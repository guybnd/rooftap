// HOUP-85: native port of apps/web's use-hero-module-config.ts. Persists to
// the SAME `user_settings.home_hero_modules` column as web (native has no
// localStorage — the DB is the only source, same convention as costs'
// persistSettings) — a user's toggle carries over whichever platform they
// open next. Immediate write-through (no debounce): a toggle in the
// customize sheet should land instantly.
// FLUX-258 widened this hook (rather than adding a sibling) with the
// countdown module's pinned event, which fires `onChange` on every
// keystroke/notch, so it goes through the shared `createWriteGate` trailing
// debounce instead of writing immediately.
import { useEffect, useRef, useState } from 'react';
import { createWriteGate, type UserSettings } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';

type Countdown = UserSettings['home_hero_countdown'];

export function useHeroModuleConfig() {
  const { userSettings, currentUserId, refresh } = useDataCache();
  const [config, setConfig] = useState<Record<string, boolean>>(userSettings?.home_hero_modules ?? {});
  const [countdown, setCountdownState] = useState<Countdown>(userSettings?.home_hero_countdown ?? null);
  // Bumped after every gate write settles — joins `userSettings` in the
  // reconciling effect's deps so a remote countdown change arriving
  // mid-debounce reconciles once the gate's write window closes.
  const [settleTick, setSettleTick] = useState(0);

  // Mirrors `config` synchronously so setModule always reads the truly
  // latest value even across two toggles fired before either has
  // re-rendered — avoids building `next` off a stale closure.
  const configRef = useRef(config);
  // Count of upserts in flight. While > 0 the reconciling effect below must
  // not overwrite optimistic state with a stale userSettings snapshot.
  const pendingWrites = useRef(0);
  // Chains upserts so they always reach Postgres in call order.
  const writeQueue = useRef(Promise.resolve());

  // The gate's writer closure is built once (see below) but must read the
  // CURRENT userId/refresh, not whatever was in scope on first render — on
  // mobile this hook mounts while cacheLoading is still true (or right after
  // a sign-out resets currentUserId to null), so a closure over the initial
  // render's values would silently no-op every write for the hook's whole
  // lifetime.
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const gateRef = useRef<ReturnType<typeof createWriteGate<Countdown>> | null>(null);
  if (!gateRef.current) {
    gateRef.current = createWriteGate<Countdown>(
      async (next) => {
        const userId = currentUserIdRef.current;
        if (!userId) return;
        const supabase = getCurrentSupabaseClient();
        await supabase
          .from('user_settings')
          .upsert(
            { user_id: userId, updated_at: new Date().toISOString(), home_hero_countdown: next },
            { onConflict: 'user_id' }
          );
        await refreshRef.current();
      },
      { onSettle: () => setSettleTick((t) => t + 1) }
    );
  }
  const gate = gateRef.current;

  // Two independent per-field bails, not one shared early return — see web's
  // twin for the full rationale (a combined bail would drop a remote
  // countdown change while a module toggle is in flight, or vice versa).
  useEffect(() => {
    if (pendingWrites.current === 0) {
      const next = userSettings?.home_hero_modules ?? {};
      configRef.current = next;
      setConfig(next);
    }
    if (!gate.isHolding()) {
      setCountdownState(userSettings?.home_hero_countdown ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSettings, settleTick]);

  const setModule = async (key: string, on: boolean) => {
    if (!currentUserId) return;
    const next = { ...configRef.current, [key]: on };
    configRef.current = next;
    setConfig(next);

    pendingWrites.current += 1;
    const write = writeQueue.current.then(async () => {
      const supabase = getCurrentSupabaseClient();
      await supabase
        .from('user_settings')
        .upsert({ user_id: currentUserId, updated_at: new Date().toISOString(), home_hero_modules: next }, { onConflict: 'user_id' });
    });
    writeQueue.current = write.then(
      () => undefined,
      () => undefined
    );
    try {
      await write;
      await refresh();
    } finally {
      pendingWrites.current -= 1;
    }
  };

  const setCountdown = (next: Countdown) => {
    setCountdownState(next);
    gate.schedule(next);
  };

  const flushCountdown = () => gate.flush();

  useEffect(() => () => gate.dispose(), [gate]);

  return { config, setModule, countdown, setCountdown, flushCountdown };
}
