'use client';

import { useCallback, useState } from 'react';

/**
 * How many of a chat's latest messages show when it opens. Older ones wait
 * behind "Show earlier", so opening or swapping to a long chat (each answer
 * carries its rows) paints at once.
 */
export const THREAD_WINDOW = 16;

/**
 * The first message on show: the latest `shown`, and never past the helper's
 * brief slot, so the brief and what was asked after it always show.
 */
export function threadWindowStart(length: number, shown: number, briefSlot: number | null): number {
  const start = Math.max(0, length - shown);
  return briefSlot == null ? start : Math.min(start, briefSlot);
}

/** The chat's window of messages: where it starts, and the way to show older ones. */
export function useThreadWindow(length: number, briefSlot: number | null, step = THREAD_WINDOW) {
  const [shown, setShown] = useState(step);
  const start = threadWindowStart(length, shown, briefSlot);
  const showEarlier = useCallback(() => setShown((n) => n + step * 2), [step]);
  return { start, showEarlier };
}
