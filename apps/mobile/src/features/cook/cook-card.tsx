// Recipes v2: one running cook (mockup 1D), native twin of
// apps/web/src/components/cook/cook-card.tsx. The step it is on with a
// local segmented meter (H3), that step's text, its timers with +1 min,
// pause and stop, the next timer to come, and Back / Next. Shown on the
// recipe screen while it cooks, and in a cooking head's card (R3).
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { ChefHat, Pause, Play, X } from 'lucide-react-native';
import { Button, Text, cn, haptics } from '@homeup/ui';
import {
  cookTimers,
  formatCountdown,
  formatTimerDuration,
  meterSegments,
  timerProgress,
  timerRemainingMs,
  timerState,
  type RunningCook,
  type UseCooks,
} from '@homeup/core';
import { TimerRing } from './timer-ring';
import { askTimerNotificationPermission } from './cook-alarms';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

export function CookCard({
  cook,
  cooks,
  now,
  onOpen,
  className,
}: {
  cook: RunningCook;
  cooks: UseCooks;
  now: number;
  /** Shows an Open button that leads to the recipe. */
  onOpen?: () => void;
  className?: string;
}) {
  const { session, steps, step, recipe } = cook;
  const id = session.id;
  const text = steps[step]?.text ?? 'This recipe has no steps yet.';
  const last = step >= steps.length - 1;
  const timers = cookTimers(session).sort((a, b) => timerRemainingMs(a, now) - timerRemainingMs(b, now));
  const upcoming = (() => {
    for (let s = step; s < steps.length; s++) {
      const idx = steps[s].timers.findIndex((_, j) => !timers.some((t) => t.step === s && t.index === j));
      if (idx >= 0) return { step: s, index: idx, timer: steps[s].timers[idx] };
    }
    return null;
  })();
  const meter = meterSegments(step + 1, Math.max(1, steps.length));

  return (
    <View className={cn('gap-3 rounded-3xl border border-border/60 bg-card p-4', className)}>
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-heading text-base font-semibold text-foreground">
            {recipe.title}
          </Text>
          <Text className="text-xs text-muted-foreground" style={TABULAR}>
            {steps.length ? `Step ${step + 1} of ${steps.length}` : 'Cooking'}
          </Text>
        </View>
        {onOpen && (
          <Button variant="outline" size="sm" onPress={onOpen} className="h-10 px-3">
            Open
          </Button>
        )}
      </View>
      {steps.length > 1 && (
        <View className="flex-row gap-1.5">
          {Array.from({ length: meter.count }, (_, i) => (
            <View key={i} className={cn('h-[3px] flex-1 rounded-full', i < meter.filled ? 'bg-primary' : 'bg-foreground/10')} />
          ))}
        </View>
      )}
      <Text className="text-[17px] leading-snug text-foreground">{text}</Text>

      {(timers.length > 0 || !!upcoming) && (
        <View className="-mx-4 border-t border-border/60">
          {timers.map((t, i) => {
            const state = timerState(t, now);
            const remaining = timerRemainingMs(t, now);
            return (
              <View key={t.id} className={cn('min-h-[55px] flex-row items-center gap-3 px-4 py-2', i > 0 && 'border-t border-border/60')}>
                <TimerRing progress={timerProgress(t, now)} tone={state} />
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-sm text-foreground">
                    <Text
                      className={cn(
                        'font-mono text-sm',
                        state === 'done' ? 'text-destructive' : remaining < 60_000 ? 'text-warning' : 'text-foreground',
                      )}
                      style={TABULAR}
                    >
                      {state === 'done' ? 'Done' : formatCountdown(remaining)}
                    </Text>{' '}
                    {t.label}
                  </Text>
                  <Text className="text-xs text-muted-foreground">{state === 'paused' ? 'Paused' : `Step ${t.step + 1}`}</Text>
                </View>
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    haptics.tick();
                    cooks.addMinute(id, t.id);
                  }}
                >
                  +1 min
                </Button>
                {state !== 'done' && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={state === 'paused' ? 'Resume timer' : 'Pause timer'}
                    onPress={() => {
                      haptics.tick();
                      if (state === 'paused') cooks.resume(id, t.id);
                      else cooks.pause(id, t.id);
                    }}
                    className="h-11 w-10 items-center justify-center rounded-lg"
                  >
                    {state === 'paused' ? (
                      <Play size={16} className="text-muted-foreground" />
                    ) : (
                      <Pause size={16} className="text-muted-foreground" />
                    )}
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={state === 'done' ? 'Dismiss timer' : 'Stop timer'}
                  onPress={() => {
                    haptics.remove();
                    cooks.stopTimer(id, t.id);
                  }}
                  className="-mr-2 h-11 w-10 items-center justify-center rounded-lg"
                >
                  <X size={16} className="text-muted-foreground" />
                </Pressable>
              </View>
            );
          })}
          {!!upcoming && (
            <View className={cn('min-h-[55px] flex-row items-center gap-3 px-4 py-2', timers.length > 0 && 'border-t border-border/60')}>
              <TimerRing progress={0} tone="idle" />
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-sm text-foreground">
                  {upcoming.timer.label} · <Text className="font-mono text-sm text-foreground">{formatTimerDuration(upcoming.timer.seconds)}</Text>
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {upcoming.step === step ? 'This step' : `Step ${upcoming.step + 1}`}
                </Text>
              </View>
              {upcoming.step === step && (
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    haptics.commit();
                    askTimerNotificationPermission();
                    cooks.startStepTimer(id, upcoming.step, upcoming.index);
                  }}
                >
                  Start
                </Button>
              )}
            </View>
          )}
        </View>
      )}

      <View className="flex-row gap-2.5">
        <Button
          variant="outline"
          onPress={() => {
            haptics.select();
            cooks.back(id);
          }}
          disabled={step === 0}
          className="h-12 flex-1 rounded-xl"
        >
          Back
        </Button>
        {last ? (
          <Button
            onPress={() => {
              haptics.success();
              cooks.finish(id);
            }}
            className="h-12 flex-[1.4] rounded-xl"
          >
            <ChefHat size={16} className="text-primary-foreground" />
            Finish cooking
          </Button>
        ) : (
          <Button
            onPress={() => {
              haptics.select();
              cooks.next(id);
            }}
            className="h-12 flex-[1.4] rounded-xl"
          >
            Next step
          </Button>
        )}
      </View>
    </View>
  );
}
