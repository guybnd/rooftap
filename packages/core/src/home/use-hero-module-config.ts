'use client';

// The person's hero module toggles and the countdown module's pinned event,
// shared by both apps. Both persist to the same `user_settings` row, so a
// toggle carries over to whichever platform the person opens next. Toggles
// write through at once (a switch in the customize sheet should land
// instantly); the countdown fires `onChange` on every keystroke, so it goes
// through `createWriteGate`'s trailing debounce instead. Each app passes its
// data cache's slice and its own Supabase client getter.

import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserSettings } from '../types';
import { createWriteGate } from '../hero';

type Countdown = UserSettings['home_hero_countdown'];

export interface HeroModuleConfigSource {
  userSettings: Pick<UserSettings, 'home_hero_modules' | 'home_hero_countdown'> | null | undefined;
  currentUserId: string | null | undefined;
  refresh: () => Promise<unknown>;
}

export function useHeroModuleConfig({ userSettings, currentUserId, refresh }: HeroModuleConfigSource, getClient: () => SupabaseClient) {
  const [config, setConfig] = useState<Record<string, boolean>>(userSettings?.home_hero_modules ?? {});
  const [countdown, setCountdownState] = useState<Countdown>(userSettings?.home_hero_countdown ?? null);
  // Bumped after every gate write settles. It joins `userSettings` in the
  // reconciling effect's deps so a remote countdown change arriving
  // mid-debounce reconciles once the gate's write window closes, instead of
  // being dropped until some unrelated userSettings event.
  const [settleTick, setSettleTick] = useState(0);

  // Mirrors `config` synchronously (unlike React state) so setModule always
  // reads the latest value even across two toggles fired before either has
  // re-rendered.
  const configRef = useRef(config);
  // Count of upserts in flight. While > 0 the reconciling effect below must
  // not overwrite optimistic state with a stale userSettings snapshot (the
  // data cache's realtime, refetch or poll can refresh it independently).
  const pendingWrites = useRef(0);
  // Chains upserts so they reach Postgres in call order. Otherwise two rapid
  // toggles can race and the earlier payload can land last, reverting the
  // later toggle.
  const writeQueue = useRef(Promise.resolve());

  // The gate's writer closure is built once but must read the CURRENT
  // user/refresh/client: the hook can mount before the user is known (the
  // phone mounts it while its cache is still loading, or right after a
  // sign-out), and a closure over the first render would no-op every write.
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const getClientRef = useRef(getClient);
  getClientRef.current = getClient;

  const gateRef = useRef<ReturnType<typeof createWriteGate<Countdown>> | null>(null);
  if (!gateRef.current) {
    gateRef.current = createWriteGate<Countdown>(
      async (next) => {
        const userId = currentUserIdRef.current;
        if (!userId) return;
        await getClientRef
          .current()
          .from('user_settings')
          .upsert({ user_id: userId, updated_at: new Date().toISOString(), home_hero_countdown: next }, { onConflict: 'user_id' });
        await refreshRef.current();
      },
      { onSettle: () => setSettleTick((t) => t + 1) }
    );
  }
  const gate = gateRef.current;

  // Two independent per-field bails, not one shared early return: a toggle
  // write in flight must not block countdown reconciliation (and vice versa),
  // since nothing re-fires this effect when `pendingWrites` alone returns to 0.
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

    const supabase = getClient();
    pendingWrites.current += 1;
    const write = writeQueue.current.then(() =>
      supabase
        .from('user_settings')
        .upsert({ user_id: currentUserId, updated_at: new Date().toISOString(), home_hero_modules: next }, { onConflict: 'user_id' })
    );
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
