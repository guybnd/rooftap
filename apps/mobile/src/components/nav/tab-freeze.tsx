// Freezes a section root once it has slid off screen, so a tab you left
// stops re-rendering for its data, its timers and the tabs it shares stores
// with until you come back to it.
//
// The tabs navigator's own `freezeOnBlur` never kicks in with an animated
// tab switch: BottomTabView only freezes a screen whose activity state is
// exactly INACTIVE, and with `animation: 'shift'` an unfocused screen's
// state is an Animated interpolation, never that number. So every visited
// tab stayed live and rendered in the background, sometimes mid-slide.
//
// React suspends a frozen tree and holds its updates until it thaws; the
// Legend stores keep the data outside React, so the first render on return
// reads the latest. A tab thaws in the same commit that focuses it, before
// its slide starts, and freezes once the slide out has finished.
import * as React from 'react';
import { NAV_SPEED_MS } from '@homeup/core';

/** After a blur: the slide out (at the slower navigation speed) plus a frame or two of slack. */
export const TAB_FREEZE_DELAY_MS = NAV_SPEED_MS.smooth + 100;

/**
 * A screen that mounts unfocused (a tab warmed up ahead of its first visit)
 * renders, runs its effects and loads its rows before it freezes.
 */
export const TAB_WARM_FREEZE_DELAY_MS = 2000;

const never = { then() {} };

function Suspender({ freeze, children }: { freeze: boolean; children: React.ReactNode }) {
  if (freeze) throw never;
  return <>{children}</>;
}

interface TabFreezeProps {
  navigation: {
    isFocused(): boolean;
    addListener(event: 'focus' | 'blur', callback: () => void): () => void;
  };
  children: React.ReactNode;
}

export function TabFreeze({ navigation, children }: TabFreezeProps) {
  const focused = navigation.isFocused();
  const [settled, setSettled] = React.useState(false);
  // Re-render on focus changes even when the navigator doesn't re-render us.
  const [, bump] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => setSettled(true), delay);
    };
    if (!navigation.isFocused()) arm(TAB_WARM_FREEZE_DELAY_MS);
    const offBlur = navigation.addListener('blur', () => {
      bump();
      arm(TAB_FREEZE_DELAY_MS);
    });
    const offFocus = navigation.addListener('focus', () => {
      clearTimeout(timer);
      setSettled(false);
      bump();
    });
    return () => {
      clearTimeout(timer);
      offBlur();
      offFocus();
    };
  }, [navigation]);

  return (
    <React.Suspense fallback={null}>
      <Suspender freeze={!focused && settled}>{children}</Suspender>
    </React.Suspense>
  );
}
