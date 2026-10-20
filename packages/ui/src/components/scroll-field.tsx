// HOUP-81: universal port of apps/web/src/components/scroll-field.tsx. The
// web version hand-rolls `onWheel` + pointer-drag + `setPointerCapture` since
// the browser has no gesture primitive; native has no wheel/pointer-capture
// at all, so this port splits the two input paths instead of forcing one
// mechanism to cover both:
//   - drag (both platforms): react-native-gesture-handler's `Gesture.Pan` +
//     Reanimated own the tracking (same primitive swipe-actions.tsx uses),
//     converted to discrete steps at the same DRAG_THRESHOLD as web.
//   - wheel (web only): react-native-web forwards a plain DOM node through
//     the View ref, so a native `wheel` listener is attached directly to it
//     via an effect gated on `Platform.OS === 'web'` — no `.web.tsx` split
//     needed since native simply never mounts that effect's listener.
import * as React from 'react';
import { Platform, Pressable, Text, View, type ViewProps } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { ChevronUp, ChevronDown } from 'lucide-react-native';
import { cn } from '../lib/cn';
import { tick } from '../lib/haptics';
import { wrapValue } from '../lib/scroll-field-math';
import { useSheetDismissBlock } from './bottom-sheet';

export interface ScrollFieldProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  label: string;
  pad?: number;
  step?: number;
  display?: string;
  wide?: boolean;
}

const DRAG_THRESHOLD = 20; // px per step, matches the web version

export function ScrollField({ value, onChange, min, max, label, pad = 2, step = 1, display, wide }: ScrollFieldProps) {
  // Stable refs so the worklet's runOnJS callback always sees the latest
  // value/bounds without needing to rebuild the gesture on every render.
  const state = React.useRef({ value, min, max, step, onChange });
  state.current = { value, min, max, step, onChange };

  const increment = React.useCallback(() => {
    const { value, min, max, step, onChange } = state.current;
    onChange(wrapValue(value + step, min, max, step));
    tick();
  }, []);

  const decrement = React.useCallback(() => {
    const { value, min, max, step, onChange } = state.current;
    onChange(wrapValue(value - step, min, max, step));
    tick();
  }, []);

  // Drag path mirrors drag-number-field.tsx's pattern: capture the value at
  // gesture start and compute each frame's result from that fixed snapshot
  // plus the total step delta so far — never loop single-unit increment()
  // calls, which re-read the same stale state.current.value between
  // synchronous iterations and silently drop steps on fast drags while still
  // firing one haptic tick per (dropped) step.
  const dragStartValue = React.useRef(value);
  const onDragStart = React.useCallback(() => {
    dragStartValue.current = state.current.value;
  }, []);
  const applyDrag = React.useCallback((totalSteps: number) => {
    const { min, max, step, onChange } = state.current;
    onChange(wrapValue(dragStartValue.current + totalSteps * step, min, max, step));
    tick();
  }, []);

  const lastStep = useSharedValue(0);
  // HOUP-275: a finger on the wheel must never let a fast vertical flick
  // hijack the ancestor BottomSheet's whole-surface dismiss pan — see
  // useSheetDismissBlock's contract in bottom-sheet.tsx. No-op outside a sheet.
  const pan = useSheetDismissBlock(
    Gesture.Pan()
      .onStart(() => {
        'worklet';
        lastStep.value = 0;
        runOnJS(onDragStart)();
      })
      .onUpdate((e) => {
        'worklet';
        // Dragging up (negative translationY) increments, mirroring the web
        // version's `deltaY < 0` wheel-up-increments convention.
        const steps = Math.trunc(-e.translationY / DRAG_THRESHOLD);
        if (steps !== lastStep.value) {
          lastStep.value = steps;
          runOnJS(applyDrag)(steps);
        }
      })
  );

  // Web-only wheel support — react-native-web's View ref forwards the
  // underlying DOM node directly, so a real `wheel` listener works here.
  const trackRef = React.useRef<View>(null);
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = trackRef.current as unknown as HTMLElement | null;
    if (!node) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) increment();
      else decrement();
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [increment, decrement]);

  return (
    <View className="items-center gap-0.5">
      <Pressable
        onPress={increment}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        className="rounded p-0.5 active:bg-muted"
      >
        <ChevronUp size={14} className="text-muted-foreground" />
      </Pressable>

      <GestureDetector gesture={pan}>
        <View
          ref={trackRef}
          className={cn(
            'h-9 items-center justify-center rounded-md border border-border bg-background',
            wide ? 'w-12' : 'w-10'
          )}
        >
          <Text className="font-medium text-sm text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {display ?? String(value).padStart(pad, '0')}
          </Text>
        </View>
      </GestureDetector>

      <Pressable
        onPress={decrement}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        className="rounded p-0.5 active:bg-muted"
      >
        <ChevronDown size={14} className="text-muted-foreground" />
      </Pressable>

      <Text className="text-[10px] text-muted-foreground">{label}</Text>
    </View>
  );
}

export interface ScrollFieldRowProps extends ViewProps {
  children: React.ReactNode;
}

/** Layout wrapper shared by DateScrollField/TimeScrollField/AppointmentModal's inline spinner row. */
export function ScrollFieldRow({ className, children, ...props }: ScrollFieldRowProps) {
  return (
    <View className={cn('flex-row items-start justify-center gap-1.5 py-1', className)} {...props}>
      {children}
    </View>
  );
}
