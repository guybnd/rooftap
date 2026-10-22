// A section root's first visit mounts its screen after the page slide, not
// in the tap's commit. Mounting a section (its lists, stores, fetches and
// effects) took 100-450ms of JS on a first visit, and the slide only starts
// once that commit is done, so a tap sat still before anything moved. Now
// the tap commits an empty page over the ground (the glow and texture
// already sit behind every section root), the slide starts at once, and the
// screen mounts when the slide lands, fading in on Hearth's `fast` step.
//
// The first section the app opens on mounts at once, and so does every
// section under still motion: there is no slide to wait for. Later visits
// find the screen already mounted.
import * as React from 'react';
import { Animated } from 'react-native';
import { MOTION_DURATIONS_MS, useNavShiftMs } from '@homeup/core';
import { useStillMotion } from '@homeup/ui';

// Set once the app's first section root has mounted.
let launched = false;

// Lands the mount even if the navigator never reports the slide's end.
const FALLBACK_SLACK_MS = 150;

type TransitionEvents = {
  addListener: (type: 'transitionEnd', listener: () => void) => () => void;
};

export function DeferredScene({ navigation, children }: { navigation: TransitionEvents; children: React.ReactNode }) {
  const shiftMs = useNavShiftMs();
  const reduceMotion = useStillMotion();
  // Still motion (or a still theme) switches with no slide to wait behind.
  const [ready, setReady] = React.useState(() => {
    if (launched) return reduceMotion;
    launched = true;
    return true;
  });
  const [fade] = React.useState(() => new Animated.Value(ready || reduceMotion ? 1 : 0));

  React.useEffect(() => {
    if (ready) return;
    const land = () => setReady(true);
    const unsubscribe = navigation.addListener('transitionEnd', land);
    const timer = setTimeout(land, shiftMs + FALLBACK_SLACK_MS);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [ready, navigation, shiftMs]);

  React.useEffect(() => {
    if (!ready) return;
    Animated.timing(fade, { toValue: 1, duration: MOTION_DURATIONS_MS.fast, useNativeDriver: true }).start();
  }, [ready, fade]);

  if (!ready) return null;
  return <Animated.View style={{ flex: 1, opacity: fade }}>{children}</Animated.View>;
}
