'use client';

// Recipes v2: a step's timer chip (mockup 3A). Chip shape means tappable
// (PC1): an idle chip starts the timer, a running one pauses, a paused one
// resumes, and a finished one is dismissed. Accent tint, since a tap acts.

import { Pause, Play, Timer, BellRing } from 'lucide-react';
import { formatCountdown, formatTimerDuration, type NearestTimer } from '@homeup/core';
import { pillVariants } from '@/components/ui/pill';
import { cn } from '@/lib/utils';

export function StepTimerChip({
  label,
  seconds,
  running,
  onStart,
  onPause,
  onResume,
  onDismiss,
}: {
  label: string;
  seconds: number;
  running: NearestTimer | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onDismiss: () => void;
}) {
  const state = running?.state ?? 'idle';
  const action = { idle: onStart, running: onPause, paused: onResume, done: onDismiss }[state];
  const aria = {
    idle: `Start ${label} timer, ${formatTimerDuration(seconds)}`,
    running: `Pause ${label} timer`,
    paused: `Resume ${label} timer`,
    done: `${label} is done, dismiss`,
  }[state];
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        action();
      }}
      aria-label={aria}
      className={cn(
        pillVariants({ variant: state === 'done' ? 'destructive' : 'primary' }),
        'relative isolate h-7 gap-1.5 px-2.5 text-xs before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[""]',
      )}
    >
      {state === 'idle' && <Timer className="size-3.5" />}
      {state === 'running' && <Pause className="size-3.5" />}
      {state === 'paused' && <Play className="size-3.5" />}
      {state === 'done' && <BellRing className="size-3.5" />}
      {state === 'idle' ? (
        <>
          {label} · <span className="font-mono">{formatTimerDuration(seconds)}</span>
        </>
      ) : (
        <>
          <span className="font-mono tabular-nums">{state === 'done' ? 'Done' : formatCountdown(running!.remainingMs)}</span>
          {label}
        </>
      )}
    </button>
  );
}
