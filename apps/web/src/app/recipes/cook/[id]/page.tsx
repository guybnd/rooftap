'use client';

// Recipes v2 R4: cook mode (mockup 4A). One step at a time in big type, the
// ingredients for that step, and the step's timers. Swipe sideways, the
// arrow keys, or Back / Next move between steps; the step meter is local
// (H3). The screen stays on (Wake Lock API) and read-aloud speaks each step
// with the browser's speech (speechSynthesis) when it is on.
//
// Opening cook mode starts the recipe's cook, so its step and timers are
// the same as the head's and the other device's. Without running cooks
// (module feature off, or an older server) it still steps through locally.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { use$ } from '@legendapp/state/react';
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX, X, ChefHat } from 'lucide-react';
import {
  recipes$,
  recipeIngredients$,
  formatCountdown,
  formatTimerDuration,
  ingredientPillLabel,
  meterSegments,
  recipeSteps,
  stepIngredients,
  stepSpeech,
  stepTimerStates,
  useCookClock,
  useCooks,
  useReconnectSync,
  type Recipe,
  type RecipeIngredient,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { cn } from '@/lib/utils';
import { askTimerNotificationPermission } from '@/components/cook/cook-alarms';

function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    const take = () => {
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (released) void l.release();
          else lock = l;
        })
        .catch(() => undefined);
    };
    take();
    // The browser drops the lock when the tab hides; take it again on return.
    const onVisible = () => document.visibilityState === 'visible' && take();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}

const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export default function CookModePage() {
  const router = useRouter();
  const { id: recipeId } = useParams<{ id: string }>();
  const { group, currentUserId } = useDataCache();
  const recs$ = recipes$(group?.id);
  const ings$ = recipeIngredients$(group?.id);
  useReconnectSync(recs$);
  useReconnectSync(ings$);
  const recipe = use$(() => {
    const r = ((recs$.get() ?? {}) as Record<string, Recipe>)[recipeId];
    return r && !r.deleted ? r : null;
  });
  const allIngredients = use$(() =>
    Object.values(ings$.get() ?? {}).filter((i): i is RecipeIngredient => !!i && !i.deleted && i.recipe_id === recipeId),
  );
  const steps = useMemo(() => (recipe ? recipeSteps(recipe) : []), [recipe]);

  const cooks = useCooks(group?.id, currentUserId);
  const cook = cooks.cookForRecipe(recipeId);
  const [localStep, setLocalStep] = useState(0);
  const step = cook ? cook.step : Math.min(localStep, Math.max(0, steps.length - 1));
  const now = useCookClock(!!cook && cook.session.timers.length > 0);

  // Opening cook mode starts the cook (or picks up the one running).
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !cooks.enabled || !recipe || cook) return;
    started.current = true;
    cooks.start(recipeId);
  }, [cooks, recipe, cook, recipeId]);

  useWakeLock(!!recipe);

  const go = useCallback(
    (delta: number) => {
      const next = Math.min(Math.max(0, step + delta), Math.max(0, steps.length - 1));
      if (cook) cooks.setStep(cook.session.id, next);
      else setLocalStep(next);
    },
    [cook, cooks, step, steps.length],
  );

  // ── Read aloud ───────────────────────────────────────────────────────────
  const [reading, setReading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const text = steps[step]?.text ?? '';
  useEffect(() => {
    if (!reading || !canSpeak() || !text) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(stepSpeech(step, steps.length, text));
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.speak(u);
    return () => synth.cancel();
  }, [reading, step, text, steps.length]);
  useEffect(() => () => {
    if (canSpeak()) window.speechSynthesis.cancel();
  }, []);

  // ── Keys and swipes ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') router.push(`/recipes/${recipeId}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, router, recipeId]);
  const touch = useRef<{ x: number; y: number } | null>(null);

  if (!group || !recipe) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-6 text-muted-foreground">
        {group && !recipe ? (
          <span>
            Recipe not found.{' '}
            <Link href="/recipes" className="text-primary">
              Back to recipes
            </Link>
          </span>
        ) : (
          'Loading…'
        )}
      </div>
    );
  }

  const current = steps[step];
  const used = current ? stepIngredients(current, allIngredients) : [];
  const timerStates = current ? stepTimerStates(cook?.session ?? null, current, step, now) : [];
  const meter = meterSegments(step + 1, Math.max(1, steps.length));
  const last = step >= steps.length - 1;
  const leave = () => router.push(`/recipes/${recipeId}`);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const t = touch.current;
        touch.current = null;
        if (!t) return;
        const dx = e.changedTouches[0].clientX - t.x;
        const dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4 pt-4 md:px-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={leave}
            aria-label="Leave cook mode"
            className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 truncate text-center text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {recipe.title}
          </div>
          {canSpeak() ? (
            <button
              type="button"
              onClick={() => setReading((r) => !r)}
              aria-label={reading ? 'Read aloud is on' : 'Read aloud is off'}
              aria-pressed={reading}
              className={cn(
                'inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted',
                reading ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {reading ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>
          ) : (
            <span className="w-11" />
          )}
        </div>

        {steps.length === 0 ? (
          <p className="text-lg text-muted-foreground">This recipe has no steps yet. Edit it to add some.</p>
        ) : (
          <>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                <span className="font-mono tabular-nums">Step {step + 1}</span> of {steps.length}
              </div>
              <div className="flex gap-1.5" aria-hidden>
                {Array.from({ length: meter.count }, (_, i) => (
                  <span key={i} className={cn('h-[3px] flex-1 rounded-full', i < meter.filled ? 'bg-primary' : 'bg-foreground/10')} />
                ))}
              </div>
            </div>

            <p className="font-heading text-[26px] font-semibold leading-snug text-foreground md:text-[30px]" aria-live="polite">
              {current?.text}
            </p>

            {(used.length > 0 || current?.temp) && (
              <div className="space-y-2 rounded-2xl bg-muted/60 p-3.5">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">For this step</div>
                <div className="flex flex-wrap gap-2">
                  {current?.temp && <span className="font-mono text-sm text-foreground">{current.temp}</span>}
                  {used.map((ing) => (
                    <span key={ing.id} className="rounded-full bg-background px-3 py-1 text-sm text-foreground">
                      {ingredientPillLabel(ing)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {cooks.enabled && timerStates.length > 0 && (
              <div className="flex flex-col items-start gap-2">
                {timerStates.map((t) => {
                  const r = t.running;
                  const timerId = r?.timer.id;
                  if (!r) {
                    return (
                      <button
                        key={t.index}
                        type="button"
                        onClick={() => {
                          askTimerNotificationPermission();
                          cooks.start(recipeId, { step, index: t.index });
                        }}
                        className="inline-flex h-11 items-center gap-2 rounded-full bg-primary/15 px-4 text-sm font-semibold text-primary hover:bg-primary/25"
                      >
                        Start {formatTimerDuration(t.seconds)} timer
                        {t.label && t.label !== 'Timer' ? <span className="font-normal">· {t.label}</span> : null}
                      </button>
                    );
                  }
                  return (
                    <div key={t.index} className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold',
                          r.state === 'done' ? 'bg-destructive/15 text-destructive' : 'bg-primary/15 text-primary',
                        )}
                      >
                        <span className="font-mono tabular-nums">{r.state === 'done' ? 'Done' : formatCountdown(r.remainingMs)}</span>
                        {t.label}
                      </span>
                      {cook && timerId && r.state !== 'done' && (
                        <button
                          type="button"
                          onClick={() =>
                            r.state === 'paused' ? cooks.resume(cook.session.id, timerId) : cooks.pause(cook.session.id, timerId)
                          }
                          aria-label={r.state === 'paused' ? 'Resume timer' : 'Pause timer'}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                        >
                          {r.state === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                        </button>
                      )}
                      {cook && timerId && (
                        <button
                          type="button"
                          onClick={() => cooks.stopTimer(cook.session.id, timerId)}
                          aria-label={r.state === 'done' ? 'Dismiss timer' : 'Stop timer'}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <p className="mt-auto pt-2 text-center text-xs text-muted-foreground">
              Screen stays on · swipe sideways for the next step
            </p>
          </>
        )}
      </div>

      <div className="relative mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={step === 0}
          aria-label="Previous step"
          className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card text-foreground hover:bg-accent disabled:opacity-40"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        {reading && canSpeak() ? (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => {
                const synth = window.speechSynthesis;
                if (speaking && !synth.paused) synth.pause();
                else if (synth.paused) synth.resume();
                else {
                  const u = new SpeechSynthesisUtterance(stepSpeech(step, steps.length, text));
                  u.onstart = () => setSpeaking(true);
                  u.onend = () => setSpeaking(false);
                  synth.speak(u);
                }
              }}
              aria-label={speaking ? 'Pause reading' : 'Read this step'}
              className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/85"
            >
              {speaking ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
            </button>
            <span className="text-xs text-muted-foreground">{speaking ? 'Reading' : 'Read step'}</span>
          </div>
        ) : (
          <span className="flex-1" />
        )}
        {last && steps.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              if (cook) cooks.finish(cook.session.id);
              leave();
            }}
            aria-label="Finish cooking"
            className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/85"
          >
            <ChefHat className="h-6 w-6" />
          </button>
        ) : (
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next step"
          className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/85"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
        )}
      </div>
    </div>
  );
}
