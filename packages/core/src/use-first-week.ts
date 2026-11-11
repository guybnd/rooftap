'use client';

// React glue for first-week.ts, shared by Home on web and the phone. The
// stored state is read in an effect, so a web SSR pass and the first client
// paint agree (no card), then the card appears if it should.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStoreEnvironment } from './data/store-environment';
import {
  FIRST_WEEK_STORAGE_PREFIX,
  firstWeekSteps,
  firstWeekVisible,
  parseFirstWeekState,
  type FirstWeekInput,
  type FirstWeekState,
  type FirstWeekStep,
  type FirstWeekStepId,
} from './first-week';

function read(key: string): FirstWeekState {
  try {
    return parseFirstWeekState(getStoreEnvironment().keyValue.getItem(key));
  } catch {
    return parseFirstWeekState(null);
  }
}

function write(key: string, state: FirstWeekState): void {
  try {
    getStoreEnvironment().keyValue.setItem(key, JSON.stringify(state));
  } catch {
    // Storage unavailable: the card shows its steps again next time.
  }
}

export interface UseFirstWeek {
  visible: boolean;
  steps: FirstWeekStep[];
  done: number;
  /** Mark a step done because the person followed its link. */
  tap: (id: FirstWeekStepId) => void;
  /** Hide the card for good on this device. */
  dismiss: () => void;
}

export function useFirstWeek(
  input: Omit<FirstWeekInput, 'tapped'> & { groupId: string | null | undefined; groupCreatedAt: string | null | undefined }
): UseFirstWeek {
  const key = input.groupId ? FIRST_WEEK_STORAGE_PREFIX + input.groupId : null;
  // null until read, so nothing shows before the stored state is known.
  const [state, setState] = useState<FirstWeekState | null>(null);
  useEffect(() => {
    setState(key ? read(key) : null);
  }, [key]);

  const update = useCallback(
    (fn: (s: FirstWeekState) => FirstWeekState) => {
      if (!key) return;
      setState((prev) => {
        const next = fn(prev ?? read(key));
        write(key, next);
        return next;
      });
    },
    [key]
  );

  const { platform, webDevice, notificationsOn, dinnerOn, billOn, dinnerPlanned, hasCost, memberCount, groupCreatedAt } = input;
  const tappedList = state?.tapped;
  const steps = useMemo(
    () =>
      firstWeekSteps({
        platform,
        webDevice,
        notificationsOn,
        dinnerOn,
        billOn,
        dinnerPlanned,
        hasCost,
        memberCount,
        tapped: new Set(tappedList ?? []),
      }),
    [platform, webDevice, notificationsOn, dinnerOn, billOn, dinnerPlanned, hasCost, memberCount, tappedList]
  );

  return {
    visible: state !== null && firstWeekVisible({ groupCreatedAt, now: new Date(), dismissed: state.dismissed, steps }),
    steps,
    done: steps.filter((s) => s.done).length,
    tap: (id) => update((s) => (s.tapped.includes(id) ? s : { ...s, tapped: [...s.tapped, id] })),
    dismiss: () => update((s) => ({ ...s, dismissed: true })),
  };
}
