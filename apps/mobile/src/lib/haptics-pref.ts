// Hearth §9: the device-local Haptics switch (Settings > Appearance). Stored in
// the synchronous kv-store so the very first tap after launch already obeys
// it; applied to @homeup/ui's haptics module as a side effect on import (see
// app/_layout.tsx). On by default.
import * as React from 'react';
import { haptics } from '@homeup/ui';
import { nativeStoreEnvironment } from './legend/environment';

const HAPTICS_PREF_KEY = 'homeup-haptics';

function readStored(): boolean {
  try {
    return nativeStoreEnvironment.keyValue.getItem(HAPTICS_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

haptics.setHapticsEnabled(readStored());

export function useHapticsPref(): [boolean, (next: boolean) => void] {
  const [on, setOn] = React.useState(haptics.hapticsEnabled);
  const set = React.useCallback((next: boolean) => {
    haptics.setHapticsEnabled(next);
    setOn(next);
    try {
      nativeStoreEnvironment.keyValue.setItem(HAPTICS_PREF_KEY, next ? 'on' : 'off');
    } catch {
      // kv-store unavailable — the switch still holds for this session.
    }
    // Turning it on answers with the pulse you just enabled.
    if (next) haptics.select();
  }, []);
  return [on, set];
}
