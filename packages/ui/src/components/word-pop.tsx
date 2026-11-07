// Hearth §8 "Word pop": a title word that starts setting a field fills with
// the roof colours and jiggles, then pops into its coral pill. A TextInput
// can't move one of its words, so the caller hides the word in the field for
// the pop and this draws a copy of it on top, in the same place and type.
// When it ends the field's own word shows again, lit. One shot; the caller
// skips it under reduced motion. Numbers come from core's word-pop.ts.
// Web twin: the mirror under apps/web's item sheet title (`.word-pop-*`).
import * as React from 'react';
import { Text as RNText, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  motionEaseOut,
  WORD_POP_COLORS,
  WORD_POP_FILL_MS,
  WORD_POP_MS,
  WORD_POP_PILL_KEYS,
  wordPopWobble,
} from '@homeup/core';

const AnimatedText = Animated.createAnimatedComponent(RNText);
/** Where the fill ends, as a share of the whole pop. */
const FILL_END = WORD_POP_FILL_MS / WORD_POP_MS;
const COLOR_AT = WORD_POP_COLORS.map((_, i) => i / (WORD_POP_COLORS.length - 1));
const COLORS = [...WORD_POP_COLORS];
const PILL_AT = [...WORD_POP_PILL_KEYS.at];
const PILL_SCALE = [...WORD_POP_PILL_KEYS.scale];

export interface WordPopProps {
  /** The word. */
  text: string;
  /** The word's box (its left and top edges), in the parent's coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The field's text classes, so the copy matches it. */
  textClassName: string;
  /** Called once the pop has landed. */
  onDone?: () => void;
}

export function WordPop({ text, x, y, width, height, textClassName, onDone }: WordPopProps) {
  const clock = useSharedValue(0);
  React.useEffect(() => {
    clock.value = withTiming(1, { duration: WORD_POP_MS, easing: Easing.linear }, (finished) => {
      if (finished && onDone) runOnJS(onDone)();
    });
    // One shot per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The fill: the word runs through the roof colours and wobbles.
  // Then the pill: it drops, swells past 1.12 and settles (swift-out).
  const wordStyle = useAnimatedStyle(() => {
    const t = clock.value;
    if (t < FILL_END) {
      const w = wordPopWobble(t / FILL_END);
      return { transform: [{ translateX: w.x }, { rotate: `${w.rotate}deg` }, { scale: w.scale }] };
    }
    const p = motionEaseOut((t - FILL_END) / (1 - FILL_END));
    return { transform: [{ translateX: 0 }, { rotate: '0deg' }, { scale: interpolate(p, PILL_AT, PILL_SCALE) }] };
  });
  const rainbowStyle = useAnimatedStyle(() => {
    const f = Math.min(1, clock.value / FILL_END);
    return { color: interpolateColor(f, COLOR_AT, COLORS), opacity: clock.value < FILL_END ? 1 : 0 };
  });
  const litStyle = useAnimatedStyle(() => ({ opacity: clock.value < FILL_END ? 0 : 1 }));

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x, top: y, width, height }, wordStyle]}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, litStyle]}>
        <View className="h-full w-full bg-primary/15" />
        <RNText numberOfLines={1} style={{ position: 'absolute', left: 0, top: 0 }} className={`text-primary ${textClassName}`}>
          {text}
        </RNText>
      </Animated.View>
      <AnimatedText numberOfLines={1} style={[{ position: 'absolute', left: 0, top: 0 }, rainbowStyle]} className={textClassName}>
        {text}
      </AnimatedText>
    </Animated.View>
  );
}
