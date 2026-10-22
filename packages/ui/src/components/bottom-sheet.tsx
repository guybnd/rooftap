// HOUP-68: native port of apps/web/src/components/ui/bottom-sheet.tsx. The
// web primitive hand-rolls portal/backdrop/transition/drag-dismiss/Android-
// back on top of base-ui's headless Dialog; RN's `Modal` already owns the
// portal + backdrop + Android hardware-back (`onRequestClose`) natively.
//
// HOUP-202: RN's `Modal` renders its content in a separate native window
// (most visibly on Android), which sits outside the app-root
// `GestureHandlerRootView` (apps/mobile/src/app/_layout.tsx) — so the drag
// handle's pan gesture was wired correctly but never fired, because
// react-native-gesture-handler had no root to attach to inside the Modal.
// Each Modal branch needs its own nested `GestureHandlerRootView`. Also:
// Modal's `animationType="slide"` translates the whole Modal tree together,
// so the backdrop translated up in lockstep with the sheet, showing a hard
// edge (the backdrop's own top edge) sweeping up the screen — that's the
// "sharp delineation ahead of the sheet". The transition is now driven by
// hand: `animationType="none"` + independent Reanimated values for the
// scrim's opacity and the sheet's translateY, per Hearth MO's "Pull tab"
// choreography (.docs/design/hearth.md).
//
// HOUP-132: the sheet surface is a "glass" material (per the audit of
// globals.css's --glass-*/--card-shadow tokens) — background/border color
// and elevation come from useThemeMaterial() rather than the flat
// bg-popover/border-border classes.
//
// HOUP-244: native port of web's keyboard-float behaviour
// (apps/web/src/hooks/use-keyboard-inset.ts + item-form-sheet.tsx/
// capture-sheet.tsx's `{ bottom: keyboardInset, maxHeight: calc(...) }`).
// use-keyboard-offset.ts is the native analogue of the web hook; the offset
// is composed into translateY (floats the sheet above the keyboard) and
// subtracted from maxHeight (shrinks it to match), same as web. Lands here
// once so every BottomSheet/ItemFormSheet/Sheet caller inherits it — callers
// with no text input (menus/pickers) are unaffected since the keyboard never
// opens for them.
//
// HOUP-274: the hook is backed by react-native-keyboard-controller (not bare
// Reanimated) because this Modal is a separate native window on Android —
// see use-keyboard-offset.ts and the root KeyboardProvider in
// apps/mobile/src/app/_layout.tsx.
//
// The Modal's first frame on Android is laid out at the screen height minus
// the status and navigation bars (RN's ModalHostViewComponentDescriptor
// seeds it from getEncodedScreenSizeWithoutVerticalInsets); only once the
// edge-to-edge dialog window attaches does it re-lay out at full height. A
// `max-h-[88%]` sheet resolved against the short frame came out ~40dp
// shorter, so a sheet that fills its cap (the More sheet) clipped its last
// row, then grew under the finger. The content root is sized to the app's
// own frame (useSafeAreaFrame, the same edge-to-edge window) from the first
// frame instead, and the wrappers shrink so an over-tall body scrolls in a
// BottomSheetScrollView rather than overflowing the cap.
import * as React from 'react';
import { Modal, Pressable, useWindowDimensions, View, type ViewProps } from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  type GestureType,
  type NativeGesture,
  type PanGesture,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '../lib/cn';
import { tick } from '../lib/haptics';
import { useKeyboardOffset } from '../hooks/use-keyboard-offset';
import { useThemeMaterial } from '../theme/theme-provider';

// HOUP-247: shares the live inner-scroll offset (and the scroller's own
// native gesture) between `BottomSheet`'s whole-surface dismiss pan and
// `BottomSheetScrollView` — the pan needs to know when the scroller is at top
// (to take over the drag) and needs the scroller's `Gesture.Native()` so RNGH
// can run the two gestures simultaneously instead of one blocking the other
// (`simultaneousWithExternalGesture` takes the other gesture object directly,
// not a ref to the view). Mirrors the small-context pattern in `sheet.tsx`.
// Not exported from the package index — internal wiring between these two
// files only.
//
// HOUP-275: `dismissGestureRef` publishes the dismiss pan itself so a custom
// pan-based component rendered inside a `BottomSheet` (a date/time wheel, a
// drag-to-adjust number field) can declare `.blocksExternalGesture(ctx.
// dismissGestureRef)` and make the dismiss pan wait for its own pan to fail,
// instead of racing it on activation thresholds. A component that renders a
// same-axis `Gesture.Pan()` inside a sheet and skips this contract will have
// a fast flick on it randomly hijacked by the sheet's dismiss — use the
// `useSheetDismissBlock` helper below rather than re-deriving the ref plumbing.
interface BottomSheetContextValue {
  scrollOffset: SharedValue<number>;
  nativeGesture: NativeGesture;
  dismissGestureRef: React.MutableRefObject<GestureType | undefined>;
}

const BottomSheetContext = React.createContext<BottomSheetContextValue | null>(null);

export function useBottomSheetContext(): BottomSheetContextValue | null {
  return React.useContext(BottomSheetContext);
}

/**
 * Opt-in for a custom pan-based component (e.g. `ScrollField`,
 * `DragNumberField`) rendered inside a `BottomSheet` — makes the sheet's
 * dismiss pan wait for this gesture to fail, so a same-axis drag on the
 * component never races the sheet's whole-surface dismiss. A no-op outside a
 * `BottomSheet` (`ctx === null`), so it's safe to apply unconditionally.
 */
export function useSheetDismissBlock(gesture: PanGesture): PanGesture {
  const ctx = useBottomSheetContext();
  return ctx ? gesture.blocksExternalGesture(ctx.dismissGestureRef) : gesture;
}

export interface BottomSheetProps extends ViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** Render the built-in drag handle. Default true. */
  showHandle?: boolean;
  handleClassName?: string;
  handleIndicatorClassName?: string;
  overlayClassName?: string;
  /** Float above the keyboard + shrink to fit (HOUP-244). Default true. */
  keyboardAware?: boolean;
}

/** Sheet's resting cap — 88% of the window, absent any keyboard. */
const MAX_HEIGHT_FRACTION = 0.88;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Hearth MO tokens (packages/core's MOTION_DURATIONS_MS/MOTION_EASE), ported
// to Reanimated — core's copy is a CSS duration/cubic-bezier string, not a
// worklet-usable curve, so the values are mirrored here by hand.
const MOTION_SLOW_MS = 300; // sheet open travel
const MOTION_FAST_MS = 150; // backdrop fade
const MOTION_BASE_MS = 200; // cancelled-drag snap-back
const MOTION_EXIT_MS = 250; // sheet close travel
const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.42, 0, 1, 1);

/** Hearth MO "Pull tab": flick past 30% of the sheet's own height dismisses. */
const DISMISS_FRACTION = 0.3;
const DISMISS_VELOCITY = 800;
// Belt-and-suspenders fallback for the (never-observed) case where the window
// height itself reports 0 — the sheet is capped at max-h-[88%], so the window
// height alone is always a safe "fully off-screen" position.
const OFFSCREEN_FALLBACK = 600;

/**
 * A closed sheet renders nothing: its body (gestures, animated styles,
 * keyboard tracking) mounts when it opens and leaves once its close
 * animation ends. Screens keep many closed sheets mounted, and each one
 * ran all of that on every render of its owner, including on every tab
 * switch for the tab bar's own two.
 */
export function BottomSheet(props: BottomSheetProps) {
  const [present, setPresent] = React.useState(props.open);
  // A sheet that starts open is simply there; one opened later slides in.
  const startedOpen = React.useRef(props.open);
  if (props.open && !present) setPresent(true);
  const onHidden = React.useCallback(() => {
    startedOpen.current = false;
    setPresent(false);
  }, []);
  if (!present) return null;
  return <SheetBody {...props} animateIn={!startedOpen.current} onHidden={onHidden} />;
}

function SheetBody({
  open,
  onOpenChange,
  children,
  className,
  style,
  showHandle = true,
  handleClassName,
  handleIndicatorClassName,
  overlayClassName,
  keyboardAware = true,
  animateIn,
  onHidden,
  ...props
}: BottomSheetProps & { animateIn: boolean; onHidden: () => void }) {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const material = useThemeMaterial();
  const { height: windowHeight } = useWindowDimensions();
  const offscreenFallback = windowHeight || OFFSCREEN_FALLBACK;
  const keyboardOffset = useKeyboardOffset(insets.bottom, keyboardAware);
  const [visible, setVisible] = React.useState(open);
  const sheetHeight = useSharedValue(0);
  // HOUP-244 (Minor fix): the caller's actual resting height — snapshotted
  // from `sheetHeight` while the keyboard is closed, frozen once it opens —
  // so the keyboard-open shrink below is derived from what THIS caller
  // actually rests at (its own `max-h-*` cap, or shorter content), not a
  // hardcoded 88% fraction that ignores callers with a smaller resting cap
  // (e.g. searchable-picker's `max-h-[75%]`).
  const restingHeight = useSharedValue(0);
  const translateY = useSharedValue(open && !animateIn ? 0 : offscreenFallback);
  const scrimOpacity = useSharedValue(open && !animateIn ? 1 : 0);
  const crossedDismiss = useSharedValue(false);
  const scrollOffset = useSharedValue(0);
  const nativeGesture = React.useMemo(() => Gesture.Native(), []);
  const dismissGestureRef = React.useRef<GestureType | undefined>(undefined);
  // Cumulative translationY at the moment the at-top gate opened this drag —
  // see panGesture.onUpdate below for why this is needed to avoid a jump.
  const dragBaseline = useSharedValue(0);
  const wasGated = useSharedValue(true);
  const bottomSheetContext = React.useMemo(
    () => ({ scrollOffset, nativeGesture, dismissGestureRef }),
    [scrollOffset, nativeGesture]
  );
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const hide = React.useCallback(() => {
    setVisible(false);
    onHidden();
  }, [onHidden]);
  const fireTick = React.useCallback(() => tick(), []);

  React.useEffect(() => {
    if (open) {
      setVisible(true);
      translateY.value = withTiming(0, { duration: MOTION_SLOW_MS, easing: SWIFT_OUT });
      scrimOpacity.value = withTiming(1, { duration: MOTION_FAST_MS, easing: SWIFT_OUT });
    } else {
      const offscreen = sheetHeight.value || offscreenFallback;
      translateY.value = withTiming(offscreen, { duration: MOTION_EXIT_MS, easing: EASE_IN }, (finished) => {
        if (finished) runOnJS(hide)();
      });
      scrimOpacity.value = withTiming(0, { duration: MOTION_FAST_MS, easing: EASE_IN });
    }
  }, [open, translateY, scrimOpacity, sheetHeight, hide, offscreenFallback]);

  const panGesture = Gesture.Pan()
    // HOUP-275: publishes this gesture through `dismissGestureRef` so a
    // nested pan (a date/time wheel, a drag-number-field) can declare
    // `.blocksExternalGesture(ref)` and make THIS gesture wait for theirs to
    // fail, instead of racing on activation thresholds.
    .withRef(dismissGestureRef)
    // Downward-only activation, yields horizontal drags to swipeable rows /
    // horizontal scrollers inside the sheet (mirrors SwipeActions' own
    // axis-opposite guard so RNGH arbitration hands off cleanly).
    .activeOffsetY(12)
    .failOffsetX([-16, 16])
    // Lets the sheet's own scroller keep receiving touches — the scrollOffset
    // gate below decides whether THIS gesture actually moves the sheet.
    .simultaneousWithExternalGesture(nativeGesture)
    .onStart(() => {
      'worklet';
      crossedDismiss.value = false;
      dragBaseline.value = 0;
      wasGated.value = true;
    })
    .onUpdate((event) => {
      'worklet';
      if (scrollOffset.value > 1) {
        // Scrolled below top: let the scroller handle it, don't move the sheet.
        wasGated.value = true;
        return;
      }
      if (wasGated.value) {
        // First frame at-top: baseline the already-accumulated translationY so
        // the sheet starts following from the finger's *current* position
        // instead of snapping down by however far the drag has travelled so far.
        dragBaseline.value = event.translationY;
        wasGated.value = false;
      }
      const displacement = event.translationY - dragBaseline.value;
      if (displacement <= 0) return;
      translateY.value = displacement;
      const past = sheetHeight.value > 0 && displacement > sheetHeight.value * DISMISS_FRACTION;
      if (past !== crossedDismiss.value) {
        crossedDismiss.value = past;
        if (past) runOnJS(fireTick)();
      }
    })
    .onEnd((event) => {
      'worklet';
      if (scrollOffset.value > 1) {
        // Released while still scrolled below top — this gesture never moved
        // the sheet; a fast fling here is a scroll fling, not a dismiss.
        translateY.value = withTiming(0, { duration: MOTION_BASE_MS, easing: SWIFT_OUT });
        return;
      }
      const pastThreshold = sheetHeight.value > 0 && translateY.value > sheetHeight.value * DISMISS_FRACTION;
      if (pastThreshold || event.velocityY > DISMISS_VELOCITY) {
        runOnJS(close)();
      } else {
        translateY.value = withTiming(0, { duration: MOTION_BASE_MS, easing: SWIFT_OUT });
      }
    });

  // Keep `restingHeight` pinned to the last measured height while the
  // keyboard is closed; stop updating (freeze it) the moment it opens, so it
  // captures this caller's actual resting size, not a mid-shrink one.
  useAnimatedReaction(
    () => keyboardOffset.value,
    (offset) => {
      if (offset === 0) restingHeight.value = sheetHeight.value;
    }
  );

  // HOUP-244: float above the keyboard (offset subtracted from translateY,
  // same axis the drag gesture already animates) and shrink to match. The
  // shrink is a ceiling, not a subtraction: the smaller of the caller's own
  // measured resting height (falls back to the 88% default before the first
  // layout) and the space actually left above the keyboard, so a short sheet
  // keeps its natural height and just floats up, and only a tall one shrinks.
  //
  // The cap lives on an inner wrapper and always returns a maxHeight:
  // Reanimated leaves a key on the native view when a later frame stops
  // returning it, so toggling `maxHeight` on and off with the keyboard (the
  // earlier shape, on this outer view) stranded the keyboard-open cap after
  // the keyboard closed: the sheet stayed short, its footer clipped and its
  // body unscrollable. At rest the cap is the whole window, a no-op under
  // the caller's own `max-h-*` className on the outer view.
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value - keyboardOffset.value }],
  }));
  const keyboardCapStyle = useAnimatedStyle(() => {
    const offset = keyboardOffset.value;
    if (offset === 0) return { maxHeight: windowHeight };
    const restingCap = restingHeight.value > 0 ? restingHeight.value : windowHeight * MAX_HEIGHT_FRACTION;
    return { maxHeight: Math.min(restingCap, windowHeight - offset - insets.top) };
  });
  const backdropStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.value }));

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={close}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <GestureHandlerRootView
        style={
          frame.height > 0
            ? { position: 'absolute', left: 0, top: 0, width: frame.width, height: frame.height }
            : { flex: 1 }
        }
      >
        <AnimatedPressable
          accessibilityLabel="Close"
          onPress={close}
          style={backdropStyle}
          className={cn('absolute inset-0 bg-black/10', overlayClassName)}
        />
        <GestureDetector gesture={panGesture}>
          <Animated.View
            onLayout={(event) => {
              sheetHeight.value = event.nativeEvent.layout.height;
            }}
            style={[
              sheetStyle,
              { backgroundColor: material.glassBg, borderTopColor: material.glassBorder, boxShadow: material.cardShadow },
              style,
            ]}
            className={cn('absolute inset-x-0 bottom-0 max-h-[88%] rounded-t-2xl border-t', className)}
            {...props}
          >
            <Animated.View style={[{ flexShrink: 1 }, keyboardCapStyle]}>
              {showHandle && (
                <View className={cn('items-center py-3', handleClassName)}>
                  <View className={cn('h-1.5 w-12 rounded-full bg-foreground/20', handleIndicatorClassName)} />
                </View>
              )}
              <View style={{ flexShrink: 1, paddingBottom: insets.bottom }}>
                <BottomSheetContext.Provider value={bottomSheetContext}>{children}</BottomSheetContext.Provider>
              </View>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}
