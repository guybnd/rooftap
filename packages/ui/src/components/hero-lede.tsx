// Hearth v2 (Pulse, H1): the Hero lede. A surface leads with one huge number
// (the `hero` step on Home, `hero-section` on a section screen) and says what
// it counts in words beside it: "3 of 7 left today", "12 to buy". At most one
// per surface, and it is the lede: rows and tiles below never restate it.
import * as React from 'react';
import { Text, View, type ViewProps } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { HERO_ROLL_MS, MOTION_DURATIONS_MS, heroRollDirection, meterSegments } from '@homeup/core';
import { cn } from '../lib/cn';
import { useStillMotion } from '../theme/theme-provider';
import { ArriveView } from './arrive';

const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);

export interface HeroLedeProps extends ViewProps {
  /** The number or short value the surface leads with (tabular). */
  value: React.ReactNode;
  /** What the value counts, in words, set beside it: "of 7 left today". */
  label?: React.ReactNode;
  /** One muted line of secondary fragments under the number. */
  caption?: React.ReactNode;
  /** 'home' is the full Hero step; 'section' the smaller one for section screens. */
  size?: 'home' | 'section';
  /** H3: the lede's own segmented meter (done of total). */
  meter?: { done: number; total: number };
  /** Status tone for the value; status hues stay text (H2). */
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  /** 'inline' stacks the label and caption in a column beside the number, so
   *  a busy section screen's lede is one row (Groceries). */
  layout?: 'stacked' | 'inline';
  /** Inline layout only: the screen's actions, at the row's far end. */
  trailing?: React.ReactNode;
}

const TONE_CLASS: Record<NonNullable<HeroLedeProps['tone']>, string> = {
  neutral: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
};

export function HeroLede({ value, label, caption, size = 'section', meter, tone = 'neutral', layout = 'stacked', trailing, className, ...props }: HeroLedeProps) {
  if (layout === 'inline') {
    return (
      <ArriveView className={cn('gap-2', className)} {...props}>
        <View className="flex-row items-center gap-2.5">
          <HeroValue value={value} className={cn(size === 'home' ? 'text-hero' : 'text-hero-section', TONE_CLASS[tone])} />
          <View className="min-w-0 flex-1 gap-0.5">
            {label != null && (
              <Text numberOfLines={1} className="text-title text-muted-foreground">
                {label}
              </Text>
            )}
            {caption != null && (
              <Text numberOfLines={1} className="text-caption text-muted-foreground">
                {caption}
              </Text>
            )}
          </View>
          {trailing}
        </View>
        {meter && <SegmentMeter done={meter.done} total={meter.total} />}
      </ArriveView>
    );
  }
  return (
    <ArriveView className={cn('gap-2', className)} {...props}>
      <View className="flex-row flex-wrap items-end gap-x-2.5">
        <HeroValue value={value} className={cn(size === 'home' ? 'text-hero' : 'text-hero-section', TONE_CLASS[tone])} />
        {label != null && (
          <Text className={cn('text-title text-muted-foreground', size === 'home' ? 'pb-3' : 'pb-2')}>{label}</Text>
        )}
      </View>
      {meter && <SegmentMeter done={meter.done} total={meter.total} />}
      {caption != null && <Text className="text-caption text-muted-foreground">{caption}</Text>}
    </ArriveView>
  );
}

/**
 * The Hero number. When it changes from one number to another it rolls like
 * an odometer (Hearth §8 "Hero roll", core heroRollDirection): counting down,
 * the new number drops in from above and the old one falls away; counting
 * up, the reverse. Words, the first render and still motion just show.
 */
function HeroValue({ value, className }: { value: React.ReactNode; className: string }) {
  const still = useStillMotion();
  const [shown, setShown] = React.useState(value);
  const [leaving, setLeaving] = React.useState<{ value: React.ReactNode; dir: -1 | 1 } | null>(null);
  const [height, setHeight] = React.useState(0);
  const roll = useSharedValue(1);
  const dir = useSharedValue(0);
  const h = useSharedValue(0);
  React.useEffect(() => {
    if (value === shown) return;
    const d = heroRollDirection(shown, value);
    setShown(value);
    if (d === 0 || still || height === 0) {
      setLeaving(null);
      return;
    }
    setLeaving({ value: shown, dir: d });
    dir.value = d;
    h.value = height;
    roll.value = 0;
    roll.value = withTiming(1, { duration: HERO_ROLL_MS, easing: SWIFT_OUT }, (finished) => {
      if (finished) runOnJS(setLeaving)(null);
    });
    // Only a new value starts a roll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const inStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - roll.value) * dir.value * h.value }] }));
  const outStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -roll.value * dir.value * h.value }] }));
  const text = { fontVariant: ['tabular-nums' as const] };
  return (
    <View style={leaving ? { overflow: 'hidden' } : undefined} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <Animated.Text accessibilityRole="header" className={className} style={[text, inStyle]}>
        {shown}
      </Animated.Text>
      {leaving && (
        <Animated.Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className={className}
          style={[text, { position: 'absolute', left: 0, top: 0 }, outStyle]}
        >
          {leaving.value}
        </Animated.Text>
      )}
    </View>
  );
}

export interface SegmentMeterProps extends ViewProps {
  done: number;
  total: number;
  /** Most segments drawn; bigger totals scale down to fit one row. */
  max?: number;
  /** 'success' is the checklist meter (Hearth colour roles), as on the Now card. */
  tone?: 'primary' | 'success';
}

/**
 * H3 meter for a lede: one 3px segment per item, finished ones in coral. The
 * empty ones stay visible as a faint track with clear gaps between them, so
 * the meter reads as segments from the first item, not as one line.
 */
export function SegmentMeter({ done, total, max = 10, tone = 'primary', className, ...props }: SegmentMeterProps) {
  const { count, filled } = meterSegments(done, total, max);
  if (count === 0) return null;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${done} of ${total} done`}
      accessibilityValue={{ min: 0, max: total, now: done }}
      className={cn('flex-row gap-1.5', className)}
      {...props}
    >
      {Array.from({ length: count }, (_, i) => (
        <MeterSegment key={i} filled={i < filled} tone={tone} />
      ))}
    </View>
  );
}

/**
 * One segment. Filling sweeps the coral in from its left edge at slow
 * (MO: transform only); emptying (an undo) retreats at fast. It mounts at
 * its value, so only a change animates, and Reanimated's default
 * ReduceMotion.System makes both instant under reduced motion.
 */
function MeterSegment({ filled, tone }: { filled: boolean; tone: 'primary' | 'success' }) {
  const fill = useSharedValue(filled ? 1 : 0);
  React.useEffect(() => {
    fill.value = withTiming(filled ? 1 : 0, {
      duration: filled ? MOTION_DURATIONS_MS.slow : MOTION_DURATIONS_MS.fast,
      easing: SWIFT_OUT,
    });
  }, [filled, fill]);
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));
  return (
    <View className="h-[3px] flex-1 overflow-hidden rounded-full bg-foreground/15">
      <Animated.View style={[{ transformOrigin: 'left' }, fillStyle]} className={cn('absolute inset-0 rounded-full', tone === 'success' ? 'bg-success' : 'bg-primary')} />
    </View>
  );
}
