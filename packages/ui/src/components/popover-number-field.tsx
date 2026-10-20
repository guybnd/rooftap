// A number shown as plain text that opens a small editor right next to it
// when tapped (Guy, 2026-10-20: dragging a grocery row's price changed it by
// accident). The editor holds a typed field, a drag strip and -/+ steps;
// tapping anywhere outside it (or Back) closes it and commits the value, and
// nothing changes until then. Positioned like ActionMenu: the trigger's
// window rect, opening below it, right-aligned to it, flipping above when
// there's no room, and lifting clear of the keyboard while the field is typed
// into.
import * as React from 'react';
import { Keyboard, Modal, Pressable, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAnimatedKeyboard } from 'react-native-keyboard-controller';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Minus, MoveHorizontal, Plus } from 'lucide-react-native';
import { cn } from '../lib/cn';
import { select, tick } from '../lib/haptics';
import { useThemeMaterial } from '../theme/theme-provider';
import type { ActionMenuAnchor } from './action-menu';

export interface PopoverNumberFieldProps {
  value: number | null;
  /** Fires once, when the editor closes with a different value. */
  onChange: (value: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Decimal places. Default 0. */
  precision?: number;
  prefix?: string;
  /** The editor field's prefix when it differs from the trigger's (e.g. "$"
   *  for a trigger reading "~$" on an estimate). Defaults to `prefix`. */
  inputPrefix?: string;
  suffix?: string;
  placeholder?: string;
  /** The editor's caption, e.g. "Price". */
  label?: string;
  /** Committing an empty field yields null instead of 0. Default true. */
  allowEmpty?: boolean;
  accessibilityLabel?: string;
  /** Classes for the trigger. */
  className?: string;
  /** Classes for the trigger's text. Tabular numbers always. */
  textClassName?: string;
}

const POPOVER_WIDTH = 232;
// Header + input row + drag row + padding; used to flip above the trigger.
const POPOVER_HEIGHT = 148;
const GAP = 6;
const EDGE = 12;
const DRAG_PX = 10; // px of horizontal drag per one `step`
// Hearth MO: fast (150ms) swift-out, same as ActionMenu.
const MOTION_FAST_MS = 150;
const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);

function clampRound(n: number, min: number, max: number, precision: number): number {
  const clamped = Math.max(min, Math.min(max, n));
  const factor = 10 ** precision;
  return Math.round(clamped * factor) / factor;
}

function format(value: number, precision: number): string {
  return precision <= 0 ? String(value) : value.toFixed(precision);
}

export function PopoverNumberField({
  value,
  onChange,
  step = 1,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  precision = 0,
  prefix,
  inputPrefix = prefix,
  suffix,
  placeholder = '–',
  label,
  allowEmpty = true,
  accessibilityLabel,
  className,
  textClassName,
}: PopoverNumberFieldProps) {
  const material = useThemeMaterial();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const triggerRef = React.useRef<View>(null);
  const [anchor, setAnchor] = React.useState<ActionMenuAnchor | null>(null);
  // The editor's text is the one source of truth while it's open: typing
  // writes it, the drag strip and -/+ rewrite it, closing parses it.
  const [draft, setDraft] = React.useState('');
  const dragStartRef = React.useRef(0);
  const lastStepRef = React.useRef(0);
  const progress = useSharedValue(0);
  const keyboard = useAnimatedKeyboard();

  const parsedDraft = React.useCallback((): number | null => {
    const trimmed = draft.trim();
    if (!trimmed) return allowEmpty ? null : clampRound(0, min, max, precision);
    const parsed = parseFloat(trimmed);
    return Number.isFinite(parsed) ? clampRound(parsed, min, max, precision) : value;
  }, [draft, allowEmpty, min, max, precision, value]);

  const open = () => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setDraft(value != null ? format(value, precision) : '');
      setAnchor({ x, y, width, height });
      progress.value = withTiming(1, { duration: MOTION_FAST_MS, easing: SWIFT_OUT });
    });
  };

  const close = () => {
    Keyboard.dismiss();
    const next = parsedDraft();
    setAnchor(null);
    progress.value = 0;
    if (next !== value) {
      select();
      onChange(next);
    }
  };

  const nudge = (deltaSteps: number) => {
    const base = parsedDraft() ?? 0;
    const next = clampRound(base + deltaSteps * step, min, max, precision);
    setDraft(format(next, precision));
    tick();
  };

  const onDragStart = () => {
    Keyboard.dismiss();
    dragStartRef.current = parsedDraft() ?? 0;
    lastStepRef.current = 0;
  };
  const onDragSteps = (steps: number) => {
    if (steps === lastStepRef.current) return;
    const next = clampRound(dragStartRef.current + steps * step, min, max, precision);
    const prev = clampRound(dragStartRef.current + lastStepRef.current * step, min, max, precision);
    lastStepRef.current = steps;
    if (next === prev) return;
    setDraft(format(next, precision));
    tick();
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-4, 4])
    .onStart(() => {
      'worklet';
      runOnJS(onDragStart)();
    })
    .onUpdate((event) => {
      'worklet';
      runOnJS(onDragSteps)(Math.round(event.translationX / DRAG_PX));
    });

  const below = anchor ? anchor.y + anchor.height + GAP : 0;
  const flip = anchor ? below + POPOVER_HEIGHT > windowHeight - EDGE : false;
  const top = anchor ? (flip ? Math.max(EDGE, anchor.y - GAP - POPOVER_HEIGHT) : below) : 0;
  const left = anchor
    ? Math.min(Math.max(EDGE, anchor.x + anchor.width - POPOVER_WIDTH), windowWidth - POPOVER_WIDTH - EDGE)
    : 0;
  const bottomEdge = top + POPOVER_HEIGHT;

  const popoverStyle = useAnimatedStyle(() => {
    // Lift clear of the keyboard while the field is typed into.
    const overlap = bottomEdge - (windowHeight - keyboard.height.value - EDGE);
    return {
      opacity: progress.value,
      transform: [
        { translateY: (1 - progress.value) * (flip ? 6 : -6) - Math.max(0, overlap) },
        { scale: 0.96 + progress.value * 0.04 },
      ],
    };
  });

  const display = value != null ? `${prefix ?? ''}${format(value, precision)}${suffix ? ` ${suffix}` : ''}` : placeholder;

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={() => {
          tick();
          open();
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: display }}
        className={cn('flex-row items-center rounded', anchor && 'bg-muted', className)}
      >
        <Text className={cn('text-body text-foreground', textClassName)} style={{ fontVariant: ['tabular-nums'] }}>
          {display}
        </Text>
      </Pressable>
      <Modal transparent visible={anchor != null} animationType="none" onRequestClose={close} statusBarTranslucent>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Pressable accessibilityLabel="Done" onPress={close} className="absolute inset-0" />
          <Animated.View
            style={[
              popoverStyle,
              { top, left, width: POPOVER_WIDTH, backgroundColor: material.glassBg, borderColor: material.glassBorder, boxShadow: material.cardShadow },
            ]}
            className="absolute gap-2.5 rounded-xl border p-3"
          >
            {!!label && <Text className="text-caption text-muted-foreground">{label}</Text>}
            <View className="h-11 flex-row items-center gap-1 rounded-lg border border-input bg-background px-3">
              {!!inputPrefix && <Text className="text-body text-muted-foreground">{inputPrefix}</Text>}
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={close}
                keyboardType="decimal-pad"
                returnKeyType="done"
                selectTextOnFocus
                placeholder={format(0, precision)}
                accessibilityLabel={accessibilityLabel}
                className="flex-1 text-body text-foreground"
                style={{ fontVariant: ['tabular-nums'] }}
              />
              {!!suffix && <Text className="text-body text-muted-foreground">{suffix}</Text>}
            </View>
            <View className="h-10 flex-row items-center gap-2">
              <Pressable
                onPress={() => nudge(-1)}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel="Less"
                className="h-10 w-10 items-center justify-center rounded-lg border border-input active:bg-muted"
              >
                <Minus size={16} className="text-foreground" />
              </Pressable>
              <GestureDetector gesture={pan}>
                <View
                  accessibilityRole="adjustable"
                  accessibilityLabel="Drag left or right to adjust"
                  className="h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-muted/60"
                >
                  <MoveHorizontal size={14} className="text-muted-foreground" />
                  <Text className="text-caption text-muted-foreground">Drag</Text>
                </View>
              </GestureDetector>
              <Pressable
                onPress={() => nudge(1)}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel="More"
                className="h-10 w-10 items-center justify-center rounded-lg border border-input active:bg-muted"
              >
                <Plus size={16} className="text-foreground" />
              </Pressable>
            </View>
          </Animated.View>
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}
