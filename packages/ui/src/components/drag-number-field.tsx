// HOUP-120: native port of apps/web/src/components/ui/drag-number-field.tsx —
// a horizontal drag-to-adjust numeric field with tap-to-type-exact-value
// fallback. Web hand-rolls pointer tracking (pointerdown/move/up, a 4px
// tap-vs-drag threshold) because the browser gives no gesture primitive; on
// native, react-native-gesture-handler's `Gesture.Pan` (mirrors
// `swipe-actions.tsx`'s pattern) owns the tracking, and a below-threshold
// release opens the type-exact-value TextInput instead of committing a drag.
import * as React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { MoveHorizontal } from 'lucide-react-native';
import { cn } from '../lib/cn';
import { useSheetDismissBlock } from './bottom-sheet';

export interface DragNumberFieldProps {
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Decimal places. Default 0. */
  precision?: number;
  /** Drop trailing ".00" when displaying. Default false. */
  trimTrailingZeros?: boolean;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  /** Committing an empty edit yields null instead of 0. Default true. */
  allowEmpty?: boolean;
  /** HOUP-224: hides the drag-affordance icon — for compact inline-row use (e.g. a grocery row's qty/price chip) where the icon competes with denser row content. Default false (shows it, matching the existing form-field usage). */
  hideIcon?: boolean;
  accessibilityLabel?: string;
  className?: string;
  /** Classes for the resting value text (e.g. a muted price in a row). Tabular numbers always. */
  textClassName?: string;
}

const DRAG_PX = 10; // px of horizontal drag per one `step` change
const TAP_SLOP_PX = 4;

function clampRound(n: number, min: number, max: number, precision: number): number {
  const clamped = Math.max(min, Math.min(max, n));
  const factor = 10 ** precision;
  return Math.round(clamped * factor) / factor;
}

function format(value: number, precision: number, trim = false): string {
  if (precision <= 0) return String(value);
  const fixed = value.toFixed(precision);
  return trim ? String(parseFloat(fixed)) : fixed;
}

export function DragNumberField({
  value,
  onChange,
  step = 1,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  precision = 0,
  trimTrailingZeros = false,
  prefix,
  suffix,
  placeholder = '–',
  allowEmpty = true,
  hideIcon = false,
  accessibilityLabel,
  className,
  textClassName,
}: DragNumberFieldProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const inputRef = React.useRef<TextInput>(null);
  const startValueRef = React.useRef(value ?? 0);
  const lastEmittedRef = React.useRef<number | null>(value);

  const enterEdit = React.useCallback(() => {
    setDraft(value != null ? format(value, precision, trimTrailingZeros) : '');
    setEditing(true);
  }, [value, precision, trimTrailingZeros]);

  const commitDraft = React.useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onChange(allowEmpty ? null : clampRound(0, min, max, precision));
    } else {
      const parsed = parseFloat(trimmed);
      if (Number.isFinite(parsed)) onChange(clampRound(parsed, min, max, precision));
    }
    setEditing(false);
  }, [draft, allowEmpty, min, max, precision, onChange]);

  const applyDelta = React.useCallback(
    (deltaSteps: number) => {
      const next = clampRound(startValueRef.current + deltaSteps * step, min, max, precision);
      if (next !== lastEmittedRef.current) {
        lastEmittedRef.current = next;
        onChange(next);
      }
    },
    [step, min, max, precision, onChange]
  );

  const onDragStart = React.useCallback(() => {
    startValueRef.current = value ?? 0;
    lastEmittedRef.current = value;
  }, [value]);

  // HOUP-275: a diagonal drag can push dy past the sheet's activeOffsetY(12)
  // before dx clears failOffsetX([-16, 16]), letting the sheet's dismiss pan
  // activate under the user's finger — see useSheetDismissBlock's contract in
  // bottom-sheet.tsx. No-op outside a sheet.
  const pan = useSheetDismissBlock(
    Gesture.Pan()
      .enabled(!editing)
      .activeOffsetX([-TAP_SLOP_PX, TAP_SLOP_PX])
      .failOffsetY([-12, 12])
      .onStart(() => {
        'worklet';
        runOnJS(onDragStart)();
      })
      .onUpdate((event) => {
        'worklet';
        const deltaSteps = Math.round(event.translationX / DRAG_PX);
        runOnJS(applyDelta)(deltaSteps);
      })
      .onEnd((event) => {
        'worklet';
        if (Math.abs(event.translationX) < TAP_SLOP_PX) runOnJS(enterEdit)();
      })
  );

  if (editing) {
    return (
      <View
        className={cn(
          'h-8 flex-row items-center gap-1 rounded-lg border border-ring bg-background px-2.5',
          className
        )}
      >
        {!!prefix && <Text className="text-body text-muted-foreground">{prefix}</Text>}
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          onBlur={commitDraft}
          onSubmitEditing={commitDraft}
          keyboardType="decimal-pad"
          autoFocus
          selectTextOnFocus
          accessibilityLabel={accessibilityLabel}
          className="flex-1 text-body text-foreground"
        />
        {!!suffix && <Text className="text-body text-muted-foreground">{suffix}</Text>}
      </View>
    );
  }

  const display = value != null ? `${prefix ?? ''}${format(value, precision, trimTrailingZeros)}${suffix ? ` ${suffix}` : ''}` : placeholder;

  return (
    <GestureDetector gesture={pan}>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min, max, now: value ?? undefined }}
        className={cn(
          'h-8 flex-row items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent px-2.5',
          className
        )}
      >
        <Text
          className={cn('text-body', value != null ? 'text-foreground' : 'text-muted-foreground', textClassName)}
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {display}
        </Text>
        {!hideIcon && <MoveHorizontal size={13} className="shrink-0 text-muted-foreground" />}
      </Pressable>
    </GestureDetector>
  );
}
