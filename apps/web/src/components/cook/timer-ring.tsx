'use client';

// Recipes v2: a timer's progress ring (mockups 3A, 1D). Tone follows Hearth
// status hues in small doses: primary while it runs, warning under a minute
// is the caller's job in text, destructive once done, muted when paused or
// not started.

import { cn } from '@/lib/utils';

export type TimerRingTone = 'running' | 'paused' | 'done' | 'idle';

const STROKE: Record<TimerRingTone, string> = {
  running: 'stroke-primary',
  paused: 'stroke-muted-foreground',
  done: 'stroke-destructive',
  idle: 'stroke-transparent',
};

export function TimerRing({
  progress,
  tone,
  size = 36,
  className,
}: {
  progress: number;
  tone: TimerRingTone;
  size?: number;
  className?: string;
}) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const p = tone === 'done' ? 1 : Math.min(1, Math.max(0, progress));
  return (
    <svg viewBox="0 0 36 36" width={size} height={size} className={cn('shrink-0', className)} aria-hidden>
      <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="stroke-foreground/10" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p)}
        transform="rotate(-90 18 18)"
        className={STROKE[tone]}
      />
    </svg>
  );
}
