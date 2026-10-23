'use client';

// Recipes v2 R2: the running cooks, shared by web and the app. Reads the
// person's cook_sessions with their recipes and steps, and gives the writes:
// start a recipe (or open the cook already running), move between steps,
// start, pause, resume, +1 min and stop a timer, and finish a cook.
//
// Gated on the `recipes.cook` module feature and on a server that has the
// table; off means the store never opens.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { use$ } from '@legendapp/state/react';
import { useReconnectSync, useStoreHelpers } from '../../data/create-group-store';
import { getStoreEnvironment, envRandomUUID } from '../../data/store-environment';
import { cookSessions$ } from '../../data/stores/cook-sessions-store';
import { recipes$ } from '../../data/stores/recipes-store';
import { useModules } from '../../modules-store';
import type { Recipe, RecipeStep } from '../../types';
import {
  addTimerMinute,
  buildCookSession,
  clampStep,
  allCookTimers,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  type CookSession,
  type CookTimer,
} from './cook';
import { recipeSteps } from './steps';

const DEVICE_KEY = 'rooftap.cook-device-id';
let deviceId: string | null = null;

/** This device's id, so a timer rings only where it was started. */
export function cookDeviceId(): string {
  if (deviceId) return deviceId;
  let stored: string | null = null;
  try {
    stored = getStoreEnvironment().keyValue.getItem(DEVICE_KEY);
  } catch {
    stored = null;
  }
  deviceId = stored || envRandomUUID();
  if (!stored) {
    try {
      getStoreEnvironment().keyValue.setItem(DEVICE_KEY, deviceId);
    } catch {
      // A device without storage keeps the id for this run only.
    }
  }
  return deviceId;
}

/** Now, ticking once a second while `active`. */
export function useCookClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export interface RunningCook {
  session: CookSession;
  recipe: Recipe;
  steps: RecipeStep[];
  /** The step the cook is on, clamped to the recipe's steps. */
  step: number;
}

export interface UseCooks {
  /** The feature is on and the server has the table. */
  enabled: boolean;
  /** Oldest first, so heads keep their order. */
  cooks: RunningCook[];
  cookForRecipe: (recipeId: string) => RunningCook | null;
  /**
   * Start cooking a recipe; returns the cook id. A recipe already running is
   * not started twice. `withTimer` also starts that step timer.
   */
  start: (recipeId: string, withTimer?: { step: number; index: number }) => string | null;
  setStep: (cookId: string, step: number) => void;
  next: (cookId: string) => void;
  back: (cookId: string) => void;
  startStepTimer: (cookId: string, step: number, index: number) => void;
  pause: (cookId: string, timerId: string) => void;
  resume: (cookId: string, timerId: string) => void;
  addMinute: (cookId: string, timerId: string) => void;
  stopTimer: (cookId: string, timerId: string) => void;
  finish: (cookId: string) => void;
  /** Undo a finish made in this app session. */
  restore: (cookId: string) => void;
}

/** Cooks finished in this app session, so Undo can bring them back. */
const finished = new Map<string, CookSession>();

export function useCooks(groupId: string | null | undefined, userId: string | null | undefined): UseCooks {
  const modules = useModules();
  const enabled = modules.feature('recipes.cook') && modules.server('recipes.cook') && !!groupId;
  const store$ = cookSessions$(enabled ? groupId : undefined);
  const recs$ = recipes$(enabled ? groupId : undefined);
  useReconnectSync(store$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(store$, userId);

  const sessions = use$(() =>
    Object.values(store$.get() ?? {}).filter(
      (s): s is CookSession => !!s && !s.deleted && (!userId || !s.user_id || s.user_id === userId),
    ),
  );
  const recipes = use$(() => (recs$.get() ?? {}) as Record<string, Recipe>);

  const cooks = useMemo(() => {
    const out: RunningCook[] = [];
    for (const session of sessions) {
      const recipe = recipes[session.recipe_id];
      if (!recipe || recipe.deleted) continue;
      const steps = recipeSteps(recipe);
      out.push({ session, recipe, steps, step: clampStep(session.step, steps.length) });
    }
    return out.sort((a, b) => (a.session.started_at ?? '').localeCompare(b.session.started_at ?? ''));
  }, [sessions, recipes]);

  const byId = useCallback((id: string) => cooks.find((c) => c.session.id === id) ?? null, [cooks]);

  const cookForRecipe = useCallback(
    (recipeId: string) => cooks.find((c) => c.recipe.id === recipeId) ?? null,
    [cooks],
  );

  const start = useCallback(
    (recipeId: string, withTimer?: { step: number; index: number }) => {
      if (!enabled || !groupId) return null;
      const running = cooks.find((c) => c.recipe.id === recipeId);
      const recipe = recipes[recipeId];
      const t = withTimer && recipe ? recipeSteps(recipe)[withTimer.step]?.timers[withTimer.index] : undefined;
      const timerInput = t && withTimer ? { ...withTimer, label: t.label, seconds: t.seconds } : null;
      if (running) {
        if (timerInput) {
          patchRow(running.session.id, {
            timers: startTimer(allCookTimers(running.session), timerInput, cookDeviceId(), Date.now()),
          });
        }
        return running.session.id;
      }
      const session = buildCookSession({ groupId, userId: userId ?? null, recipeId });
      if (timerInput) {
        session.step = timerInput.step;
        session.timers = startTimer([], timerInput, cookDeviceId(), Date.now());
      }
      writeRow(session);
      return session.id;
    },
    [enabled, groupId, userId, cooks, recipes, writeRow, patchRow],
  );

  const setTimers = useCallback(
    (cookId: string, fn: (timers: CookTimer[], now: number) => CookTimer[]) => {
      const cook = byId(cookId);
      if (!cook) return;
      patchRow(cookId, { timers: fn(allCookTimers(cook.session), Date.now()) });
    },
    [byId, patchRow],
  );

  const setStep = useCallback(
    (cookId: string, step: number) => {
      const cook = byId(cookId);
      if (!cook) return;
      const next = clampStep(step, cook.steps.length);
      if (next !== cook.session.step) patchRow(cookId, { step: next });
    },
    [byId, patchRow],
  );

  return {
    enabled,
    cooks,
    cookForRecipe,
    start,
    setStep,
    next: (cookId) => {
      const cook = byId(cookId);
      if (cook) setStep(cookId, cook.step + 1);
    },
    back: (cookId) => {
      const cook = byId(cookId);
      if (cook) setStep(cookId, cook.step - 1);
    },
    startStepTimer: (cookId, step, index) => {
      const cook = byId(cookId);
      const t = cook?.steps[step]?.timers[index];
      if (!t) return;
      setTimers(cookId, (timers, now) =>
        startTimer(timers, { step, index, label: t.label, seconds: t.seconds }, cookDeviceId(), now),
      );
    },
    pause: (cookId, timerId) => setTimers(cookId, (timers, now) => pauseTimer(timers, timerId, now)),
    resume: (cookId, timerId) => setTimers(cookId, (timers, now) => resumeTimer(timers, timerId, cookDeviceId(), now)),
    addMinute: (cookId, timerId) =>
      setTimers(cookId, (timers, now) => addTimerMinute(timers, timerId, cookDeviceId(), now)),
    stopTimer: (cookId, timerId) => setTimers(cookId, (timers) => stopTimer(timers, timerId)),
    finish: (cookId) => {
      const cook = byId(cookId);
      if (cook) finished.set(cookId, cook.session);
      softDeleteRow(cookId);
    },
    // The finished row may already have left the store (a synced delete
    // drops it), so Undo starts the same cook again as a new row.
    restore: (cookId) => {
      const old = finished.get(cookId);
      if (!old || !groupId) return;
      finished.delete(cookId);
      writeRow({
        ...buildCookSession({ groupId, userId: userId ?? null, recipeId: old.recipe_id }),
        step: old.step,
        timers: allCookTimers(old),
        started_at: old.started_at,
      });
    },
  };
}
