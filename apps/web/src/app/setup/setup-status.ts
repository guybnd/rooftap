// HOUP-88: visual class maps for the Home Setup section. The shared vocab
// (status/priority order + labels, nextStatus, summarize/SetupSummary) moved
// to @homeup/core/setup — these Tailwind class maps stay screen-local since
// they're styling, not logic (NativeWind ports its own copy of the same
// token names).

// Solid fill — used for dots and the progress meter.
export const STATUS_FILL: Record<string, string> = {
  // Hearth v2 (H2): still to buy is not a danger state, so it reads as the
  // meter's empty track and only bought items take a status hue.
  needed: 'bg-muted-foreground/30',
  installed: 'bg-success',
};

// Status as a word (H2: a tinted word, never a filled resting-state pill).
export const STATUS_TEXT: Record<string, string> = {
  needed: 'text-muted-foreground',
  installed: 'text-success',
};
