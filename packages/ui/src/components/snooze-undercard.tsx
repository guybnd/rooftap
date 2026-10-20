// HOUP-175: native port of apps/web/src/app/tasks/task-row.tsx's inline
// SnoozePicker undercard. Web renders it as a sibling directly under the row
// on swipe-left; mobile previously escalated straight to the quick-menu sheet
// (heavier, covers the list) for the same action. List-agnostic (no
// task-specific typing) so any swipeable row offering a snooze action can
// reuse it — mirrors ReorderableList's generic-primitive precedent.
import * as React from 'react';
import { Pressable, Text } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { cn } from '../lib/cn';

export interface SnoozeOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SnoozeUndercardProps<T extends string = string> {
  options: SnoozeOption<T>[];
  onPick: (value: T) => void;
  onClose: () => void;
  className?: string;
}

export function SnoozeUndercard<T extends string = string>({ options, onPick, onClose, className }: SnoozeUndercardProps<T>) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      className={cn('mt-1 flex-row flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-popover px-3 py-2', className)}
    >
      <Text className="text-caption font-medium text-warning">Snooze for</Text>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onPick(o.value)} hitSlop={4} className="rounded-md border border-border bg-muted px-2 py-1">
          <Text className="text-caption font-medium text-foreground">{o.label}</Text>
        </Pressable>
      ))}
      <Pressable onPress={onClose} hitSlop={4} className="ml-auto">
        <Text className="text-caption text-muted-foreground">Cancel</Text>
      </Pressable>
    </Animated.View>
  );
}
