// HOUP-88: visual class maps for the native Home Setup section — screen-local
// counterpart of apps/web/src/app/setup/setup-status.ts. Same NativeWind
// token names as the web Tailwind classes (styling, not logic — the shared
// vocab lives in @homeup/core's setup.ts).
import type { SetupStatus } from '@homeup/core';

// Solid fill — used for the checkbox tick and the progress meter.
export const STATUS_FILL: Record<SetupStatus, string> = {
  // Hearth v2 (H2): still to buy is not a danger state, so it reads as the
  // meter's empty track and only bought items take a status hue.
  needed: 'bg-muted-foreground/30',
  installed: 'bg-success',
};

// Status as a word (H2: a tinted word, never a filled resting-state pill).
export const STATUS_TEXT: Record<SetupStatus, string> = {
  needed: 'text-muted-foreground',
  installed: 'text-success',
};
