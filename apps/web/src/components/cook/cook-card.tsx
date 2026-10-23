'use client';

// Recipes v2: one running cook (mockup 1D). The step it is on with a local
// segmented meter (H3), that step's text, its timers with +1 min, pause and
// stop, the next timer to come, and Back / Next. Shown on the recipe page
// while it cooks, and in a cooking head's card (R3).

import { Pause, Play, X, ChefHat } from 'lucide-react';
import {
  cookTimers,
  formatCountdown,
  formatTimerDuration,
  meterSegments,
  timerProgress,
  timerRemainingMs,
  timerState,
  upcomingStepTimer,
  type RunningCook,
  type UseCooks,
} from '@homeup/core';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TimerRing } from './timer-ring';
import { askTimerNotificationPermission } from './cook-alarms';

export function CookCard({
  cook,
  cooks,
  now,
  onOpen,
  onStop,
  className,
}: {
  cook: RunningCook;
  cooks: UseCooks;
  now: number;
  /** Shows an Open button that leads to the recipe. */
  onOpen?: () => void;
  /** Stops the cook before its last step. Defaults to stopping it with Undo. */
  onStop?: () => void;
  className?: string;
}) {
  const { session, steps, step, recipe } = cook;
  const id = session.id;
  const text = steps[step]?.text ?? 'This recipe has no steps yet.';
  const last = step >= steps.length - 1;
  const timers = cookTimers(session).sort((a, b) => timerRemainingMs(a, now) - timerRemainingMs(b, now));
  // The next step timer not used yet (a dismissed one counts as used).
  const upcoming = upcomingStepTimer(session, steps, step);
  const meter = meterSegments(step + 1, Math.max(1, steps.length));
  const stop = () => {
    if (onStop) return onStop();
    cooks.finish(id);
    toast(`Stopped cooking ${recipe.title}`, { action: { label: 'Undo', onClick: () => cooks.restore(id) } });
  };

  return (
    <div className={cn('space-y-3 rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]', className)}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-heading text-base font-semibold text-foreground">{recipe.title}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {steps.length ? `Step ${step + 1} of ${steps.length}` : 'Cooking'}
          </div>
        </div>
        <button
          type="button"
          onClick={stop}
          aria-label={`Stop cooking ${recipe.title}`}
          className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Stop
        </button>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex h-10 items-center rounded-lg border border-border bg-muted px-3 text-sm font-medium text-foreground hover:bg-accent"
          >
            Open
          </button>
        )}
      </div>
      {steps.length > 1 && (
        <div className="flex gap-1.5" aria-hidden>
          {Array.from({ length: meter.count }, (_, i) => (
            <span key={i} className={cn('h-[3px] flex-1 rounded-full', i < meter.filled ? 'bg-primary' : 'bg-foreground/10')} />
          ))}
        </div>
      )}
      <p className="text-[17px] leading-snug text-foreground">{text}</p>

      {(timers.length > 0 || upcoming) && (
        <div className="-mx-4 divide-y divide-border/60 border-t border-border/60">
          {timers.map((t) => {
            const state = timerState(t, now);
            const remaining = timerRemainingMs(t, now);
            return (
              <div key={t.id} className="flex min-h-[55px] items-center gap-3 px-4 py-2">
                <TimerRing progress={timerProgress(t, now)} tone={state} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">
                    <span
                      className={cn(
                        'font-mono tabular-nums',
                        state === 'done' ? 'text-destructive' : remaining < 60_000 ? 'text-warning' : 'text-foreground',
                      )}
                    >
                      {state === 'done' ? 'Done' : formatCountdown(remaining)}
                    </span>{' '}
                    {t.label}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {state === 'paused' ? 'Paused' : `Step ${t.step + 1}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => cooks.addMinute(id, t.id)}
                  className="inline-flex h-9 items-center rounded-lg border border-border bg-muted px-2.5 text-xs font-medium text-foreground hover:bg-accent"
                >
                  +1 min
                </button>
                {state !== 'done' && (
                  <button
                    type="button"
                    onClick={() => (state === 'paused' ? cooks.resume(id, t.id) : cooks.pause(id, t.id))}
                    aria-label={state === 'paused' ? 'Resume timer' : 'Pause timer'}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {state === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => cooks.stopTimer(id, t.id)}
                  aria-label={state === 'done' ? 'Dismiss timer' : 'Stop timer'}
                  className="-mr-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
          {upcoming && (
            <div className="flex min-h-[55px] items-center gap-3 px-4 py-2">
              <TimerRing progress={0} tone="idle" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-foreground">
                  {upcoming.timer.label} · <span className="font-mono">{formatTimerDuration(upcoming.timer.seconds)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {upcoming.step === step ? 'This step' : `Step ${upcoming.step + 1}`}
                </div>
              </div>
              {upcoming.step === step && (
                <button
                  type="button"
                  onClick={() => {
                    askTimerNotificationPermission();
                    cooks.startStepTimer(id, upcoming.step, upcoming.index);
                  }}
                  className="inline-flex h-9 items-center rounded-lg border border-border bg-muted px-3 text-xs font-medium text-foreground hover:bg-accent"
                >
                  Start
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => cooks.back(id)}
          disabled={step === 0}
          className="h-12 flex-1 rounded-xl border border-border bg-muted text-sm font-medium text-foreground hover:bg-accent disabled:opacity-40"
        >
          Back
        </button>
        {last ? (
          <button
            type="button"
            onClick={() => cooks.finish(id)}
            className="inline-flex h-12 flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/85"
          >
            <ChefHat className="h-4 w-4" />
            Finish cooking
          </button>
        ) : (
          <button
            type="button"
            onClick={() => cooks.next(id)}
            className="h-12 flex-[1.4] rounded-xl bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/85"
          >
            Next step
          </button>
        )}
      </div>
    </div>
  );
}
