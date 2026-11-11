// Reanimated for screen tests: animated components are the plain react-native
// ones, shared values are plain objects and animations jump to their end.
import * as React from 'react';
import { FlatList, Image, ScrollView, Text, View } from 'react-native';
import { stubModule } from './stub-module';

const id = <T,>(v: T) => v;
const animated = {
  View,
  Text,
  ScrollView,
  Image,
  FlatList,
  createAnimatedComponent: <T,>(c: T) => c,
};

function useSharedValue<T>(initial: T) {
  const [shared] = React.useState(() => {
    const box = {
      value: initial,
      get: () => box.value,
      set: (next: T) => {
        box.value = next;
      },
    };
    return box;
  });
  return shared;
}

export function reanimatedStub() {
  return stubModule({
    default: animated,
    ...animated,
    useSharedValue,
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useAnimatedStyle: (fn: () => object) => {
      try {
        return fn();
      } catch {
        return {};
      }
    },
    useAnimatedProps: (fn: () => object) => {
      try {
        return fn();
      } catch {
        return {};
      }
    },
    useAnimatedRef: () => React.useRef(null),
    useAnimatedScrollHandler: () => () => {},
    useAnimatedReaction: () => {},
    useReducedMotion: () => true,
    useFrameCallback: () => ({ setActive: () => {} }),
    withTiming: id,
    withSpring: id,
    withDelay: (_ms: number, v: unknown) => v,
    withSequence: (...v: unknown[]) => v[v.length - 1],
    withRepeat: id,
    cancelAnimation: () => {},
    runOnJS: (fn: (...a: unknown[]) => unknown) => fn,
    runOnUI: (fn: (...a: unknown[]) => unknown) => fn,
    interpolate: (_v: number, _i: number[], out: number[]) => out[0],
    interpolateColor: (_v: number, _i: number[], out: string[]) => out[0],
    measure: () => null,
    scrollTo: () => {},
  }, { capitalised: 'chain' });
}
