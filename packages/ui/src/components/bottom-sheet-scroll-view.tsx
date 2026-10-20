// HOUP-247: drop-in `ScrollView` replacement for a `BottomSheet` body. Reads
// `BottomSheetContext` (bottom-sheet.tsx) to (a) write the live scroll offset
// into the sheet's shared value on every frame via `useAnimatedScrollHandler`
// — the at-top gate the sheet's whole-surface dismiss pan checks — and
// (b) attach the scroller's own `Gesture.Native()` (from context) via a
// nested `GestureDetector`, which the sheet's pan gesture was built with
// `.simultaneousWithExternalGesture(nativeGesture)` against — letting the two
// gestures run together while the offset gate decides who actually moves.
// Rendered outside a `BottomSheet` (ctx is null), it's a plain animated
// scroller with no wiring.
import * as React from 'react';
import { type ScrollView, type ScrollViewProps } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedScrollHandler, type AnimatedProps } from 'react-native-reanimated';
import { useBottomSheetContext } from './bottom-sheet';

// Typed against what this actually renders (`Animated.ScrollView`), not the
// plain `ScrollViewProps` react-native exports — otherwise a caller passing
// a `useAnimatedStyle` result (e.g. item-form-sheet.tsx's keyboard-aware
// `maxHeight`) fails to typecheck even though it works at runtime.
export const BottomSheetScrollView = React.forwardRef<ScrollView, AnimatedProps<ScrollViewProps>>(
  function BottomSheetScrollView(props, forwardedRef) {
    const ctx = useBottomSheetContext();
    // Destructured to a bare SharedValue before the worklet closes over it —
    // capturing `ctx` itself would pull `ctx.nativeGesture` (a live
    // Gesture.Native() instance) into the worklet's shareable conversion,
    // which Reanimated cannot serialize ("Cannot copy value of type
    // `NativeGesture`"). A SharedValue is the one thing worklets can safely
    // capture across the JS/UI thread boundary.
    const scrollOffset = ctx?.scrollOffset;
    const scrollHandler = useAnimatedScrollHandler((event) => {
      if (scrollOffset) scrollOffset.value = event.contentOffset.y;
    });

    const scrollView = <Animated.ScrollView scrollEventThrottle={16} {...props} ref={forwardedRef} onScroll={scrollHandler} />;

    if (!ctx) return scrollView;

    return <GestureDetector gesture={ctx.nativeGesture}>{scrollView}</GestureDetector>;
  }
);
