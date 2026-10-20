// Keeps the screen on while a rewards card is showing at the checkout. Goes
// through requireOptionalNativeModule rather than importing expo-keep-awake,
// whose entry throws at import when the native module is missing: the module
// ships with `expo` itself, but an older APK without it then just sleeps as
// usual instead of crashing an OTA.
import * as React from 'react';
import { requireOptionalNativeModule } from 'expo';

interface KeepAwakeModule {
  activate?: (tag: string) => Promise<void>;
  deactivate?: (tag: string) => Promise<void>;
}

const native = requireOptionalNativeModule<KeepAwakeModule>('ExpoKeepAwake');

/** Hold the screen awake under `tag` while `active` is true. */
export function useKeepAwakeWhile(active: boolean, tag: string): void {
  React.useEffect(() => {
    if (!active || !native?.activate) return;
    native.activate(tag).catch(() => {});
    return () => {
      native.deactivate?.(tag).catch(() => {});
    };
  }, [active, tag]);
}
