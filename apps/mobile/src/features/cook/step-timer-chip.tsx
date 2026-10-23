// Recipes v2: a step's timer chip (mockup 3A), native twin of
// apps/web/src/components/cook/step-timer-chip.tsx. Chip shape means
// tappable (PC1): idle starts the timer, running pauses, paused resumes,
// done dismisses.
import * as React from 'react';
import { Pressable } from 'react-native';
import { BellRing, Pause, Play, Timer } from 'lucide-react-native';
import { Text, cn, haptics, pillVariants } from '@homeup/ui';
import { formatCountdown, formatTimerDuration, type NearestTimer } from '@homeup/core';

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
  const done = state === 'done';
  const tint = done ? 'text-destructive' : 'text-primary';
  const Icon = { idle: Timer, running: Pause, paused: Play, done: BellRing }[state];
  const action = { idle: onStart, running: onPause, paused: onResume, done: onDismiss }[state];
  const aria = {
    idle: `Start ${label} timer, ${formatTimerDuration(seconds)}`,
    running: `Pause ${label} timer`,
    paused: `Resume ${label} timer`,
    done: `${label} is done, dismiss`,
  }[state];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={aria}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      onPress={() => {
        if (state === 'idle') haptics.commit();
        else haptics.tick();
        action();
      }}
      className={cn(pillVariants({ variant: done ? 'destructive' : 'primary' }), 'h-7 gap-1.5 px-2.5')}
    >
      <Icon size={13} className={tint} />
      {state === 'idle' ? (
        <Text className={cn('text-xs font-medium', tint)}>
          {label} · <Text className={cn('font-mono text-xs', tint)}>{formatTimerDuration(seconds)}</Text>
        </Text>
      ) : (
        <Text className={cn('text-xs font-medium', tint)}>
          <Text className={cn('font-mono text-xs', tint)} style={{ fontVariant: ['tabular-nums'] }}>
            {done ? 'Done' : formatCountdown(running!.remainingMs)}
          </Text>{' '}
          {label}
        </Text>
      )}
    </Pressable>
  );
}
