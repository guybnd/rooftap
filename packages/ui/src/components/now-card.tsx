// Hearth v2 (Pulse): the Now card. Home's one "do this next" item, sitting
// under the Hero lede: its section tile, a Display title, one meta line and,
// for anything that can be finished, the slide-to-finish track. Tapping the
// card opens the item (M3's tap path); the slide is the only way to finish
// from here, so a stray tap never completes anything.
//
// Key it by the item id so a finished item's track resets for the next one.
//
// NowCardPager is how Home shows it: the next few things in order (core
// pickNowQueue), one card at a time. Swipe sideways on the card's top (tile,
// title and meta) to look ahead or back; the slide track below keeps its own
// sideways drag and never turns the page, and a vertical drag stays the
// screen's scroll. The chevrons beside the page dots are the visible path
// (M3). Finishing a card celebrates on it (SlideToComplete's burst), then the
// card leaves and the next one arrives in its place; the item is only marked
// done once it has left, so the finish lands with the card's exit.
//
// A card with a `body` (a dated checklist's items) opens in place instead:
// tapping its top shows the body inside the card, tapping again folds it,
// and turning the page folds it too. `progress` gives such a card its own
// segmented meter under the meta line (H3: the meter sits with its list).
import * as React from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { MOTION_DURATIONS_MS, nowQueueIndex } from '@homeup/core';
import { cn } from '../lib/cn';
import { useThemeMaterial } from '../theme/theme-provider';
import { SegmentMeter } from './hero-lede';
import { LeadingTile, type LeadingTileIcon } from './leading-tile';
import { SlideToComplete } from './slide-to-complete';

export interface NowCardProps {
  /** Section whose tile the item wears (core heroItemSectionId). */
  sectionId: string;
  Icon: LeadingTileIcon;
  /** Micro-label over the title: "Now", "Next up", "Overdue". */
  eyebrow: string;
  /** Tints the eyebrow: status hues stay text (H2). */
  eyebrowTone?: 'muted' | 'warning' | 'danger';
  title: string;
  /** One line of meta fragments: time, countdown, where it's from. */
  meta?: React.ReactNode;
  /** The item's own progress (a checklist's items), drawn as a segmented meter under the meta. */
  progress?: { done: number; total: number } | null;
  /**
   * What the card shows when it's open (a checklist's items). With a body,
   * tapping the card's top opens and folds it instead of calling `onOpen`.
   */
  body?: React.ReactNode;
  onOpen?: () => void;
  /** Omit for an item that can't be finished (a viewing, a calendar event). */
  onComplete?: () => void;
  className?: string;
}

interface NowCardInternalProps extends NowCardProps {
  /** The pager's page-turn pan, claimed on the card's top only (never the slide track). */
  headGesture?: GestureType;
  /** Whether the body shows; only a card with a body opens. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

const EYEBROW_TONE: Record<NonNullable<NowCardProps['eyebrowTone']>, string> = {
  muted: 'text-muted-foreground',
  warning: 'text-warning',
  danger: 'text-destructive',
};

export function NowCard(props: NowCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  return <NowCardFrame {...props} expanded={expanded} onToggleExpanded={() => setExpanded((open) => !open)} />;
}

function NowCardFrame({
  sectionId,
  Icon,
  eyebrow,
  eyebrowTone = 'muted',
  title,
  meta,
  progress,
  body,
  onOpen,
  onComplete,
  className,
  headGesture,
  expanded = false,
  onToggleExpanded,
}: NowCardInternalProps) {
  const material = useThemeMaterial();
  const opensInPlace = body != null && !!onToggleExpanded;
  const onPress = opensInPlace ? onToggleExpanded : onOpen;
  const head = (
    <View className="gap-2">
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole="button"
        accessibilityLabel={`${eyebrow}: ${title}`}
        accessibilityHint={opensInPlace ? (expanded ? 'Folds the list' : 'Shows the list') : onOpen ? 'Opens the item' : undefined}
        accessibilityState={opensInPlace ? { expanded } : undefined}
        className="flex-row items-center gap-3 active:opacity-80"
      >
        <LeadingTile sectionId={sectionId} Icon={Icon} size="lg" />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className={cn('text-micro-label uppercase', EYEBROW_TONE[eyebrowTone])}>{eyebrow}</Text>
          <Text numberOfLines={2} className="text-display text-foreground">
            {title}
          </Text>
        </View>
        {opensInPlace && (
          <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
            <ChevronDown size={20} className="text-muted-foreground" />
          </View>
        )}
      </Pressable>
      {meta != null && <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1 pl-[54px]">{meta}</View>}
      {progress && progress.total > 0 && (
        <View className="flex-row items-center gap-2.5 pl-[54px]">
          <SegmentMeter done={progress.done} total={progress.total} tone="success" className="flex-1" />
          <Text className="text-data-fragment text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {progress.done} of {progress.total}
          </Text>
        </View>
      )}
    </View>
  );
  return (
    <View
      className={cn('gap-4 rounded-3xl border border-border/60 bg-card p-4', className)}
      style={{ boxShadow: material.cardShadow }}
    >
      {headGesture ? <GestureDetector gesture={headGesture}>{head}</GestureDetector> : head}
      {opensInPlace && expanded && <View>{body}</View>}
      {/* mt-auto: in the pager every card is as tall as the tallest, and the
          track stays at the bottom edge where the thumb expects it. */}
      {onComplete && <SlideToComplete onComplete={onComplete} className="mt-auto" />}
    </View>
  );
}

export interface NowCardPagerItem extends Omit<NowCardProps, 'className'> {
  /** The item's id: pages are keyed by it and the pager stays on it as the queue changes. */
  id: string;
}

export interface NowCardPagerProps {
  /** The queue, in order (core pickNowQueue). Empty renders nothing. */
  items: NowCardPagerItem[];
  className?: string;
}

/** Space between pages; matches the screen gutter so a neighbour waits just off the edge. */
const PAGE_GAP = 16;
/** A release past this share of a page (or a flick) turns it. */
const TURN_AT = 0.22;
const FLICK_VELOCITY = 600;
/** Drag resistance past the first and last page. */
const EDGE_RESIST = 0.25;
/** The finished card's beat: the thumb lands (fast), the burst plays (slow), a breath (fast). */
const CELEBRATE_MS = MOTION_DURATIONS_MS.fast + MOTION_DURATIONS_MS.slow + MOTION_DURATIONS_MS.fast;
/** How far the finished card drifts as it leaves, and the next one as it arrives. */
const SHIFT_PX = 16;
/** If the finished item hasn't left the queue by then, bring the card back anyway. */
const ARRIVE_FALLBACK_MS = 400;
const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.42, 0, 1, 1);

/** How the card got to its page: a swipe (its release already animates), a chevron (glide there), or neither (jump). */
type Via = 'gesture' | 'button' | null;

export function NowCardPager({ items, className }: NowCardPagerProps) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = React.useState(0);
  // Which item the person paged to (null follows the head), where it was, so
  // the card holds its place when that item leaves the queue, and how they got there.
  const [anchor, setAnchor] = React.useState<{ id: string | null; index: number; via: Via }>({ id: null, index: 0, via: null });
  // The item whose slide just finished, while it celebrates and leaves.
  const [celebratingId, setCelebratingId] = React.useState<string | null>(null);
  // The card opened in place (its body showing). Turning the page folds it.
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const ids = items.map((item) => item.id);
  const idsKey = ids.join('|');
  const count = items.length;
  const index = nowQueueIndex(ids, celebratingId ?? anchor.id, anchor.index);
  const stride = width + PAGE_GAP;

  const offset = useSharedValue(0);
  const fade = useSharedValue(1);
  const shift = useSharedValue(0);
  // One stable box for the timers and the finish still owed, so unmount can flush it.
  const run = React.useRef<{ timers: ReturnType<typeof setTimeout>[]; owed: NowCardPagerItem | null; leftId: string | null }>({
    timers: [],
    owed: null,
    leftId: null,
  });
  // The anchor and page width the strip was last parked for, so a turn is
  // honoured once and a resize always jumps.
  const parked = React.useRef({ anchor, stride });

  // Park the strip on the current page: glide there after a chevron, leave a
  // swipe to the animation its release already started, and jump for
  // anything else (first layout, a resize, the queue changing under the card).
  React.useLayoutEffect(() => {
    const fresh = parked.current.anchor !== anchor && parked.current.stride === stride && anchor.index === index;
    parked.current = { anchor, stride };
    const via = fresh ? anchor.via : null;
    const target = -index * stride;
    if (via === 'button') offset.value = withTiming(target, { duration: MOTION_DURATIONS_MS.base, easing: SWIFT_OUT });
    else if (via !== 'gesture') offset.value = target;
    // Runs on a page or width change only; the anchor is read as it stands then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, stride, offset]);

  const goTo = (target: number, source: Exclude<Via, null>) => {
    if (target < 0 || target >= ids.length || target === index) return;
    setExpandedId(null);
    setAnchor({ id: target === 0 ? null : ids[target], index: target, via: source });
  };
  const goToFromGesture = (target: number) => goTo(target, 'gesture');

  // The next card arrives where the finished one left: drift in and fade up.
  const arrive = React.useCallback(() => {
    if (run.current.leftId === null) return;
    run.current.leftId = null;
    if (reduceMotion) {
      fade.value = 1;
      shift.value = 0;
      return;
    }
    shift.value = SHIFT_PX;
    fade.value = withTiming(1, { duration: MOTION_DURATIONS_MS.slow, easing: SWIFT_OUT });
    shift.value = withTiming(0, { duration: MOTION_DURATIONS_MS.slow, easing: SWIFT_OUT });
  }, [reduceMotion, fade, shift]);

  const settle = React.useCallback(() => {
    const item = run.current.owed;
    run.current.owed = null;
    if (!item) return;
    run.current.leftId = item.id;
    setCelebratingId(null);
    item.onComplete?.();
    run.current.timers.push(setTimeout(arrive, ARRIVE_FALLBACK_MS));
  }, [arrive]);

  // Once the finished item is out of the queue, the strip has re-laid itself
  // out behind the faded card and the next one can arrive.
  React.useEffect(() => {
    const leftId = run.current.leftId;
    if (leftId !== null && !ids.includes(leftId)) arrive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, arrive]);

  const celebrate = (item: NowCardPagerItem, at: number) => {
    run.current.owed = item;
    setCelebratingId(item.id);
    setAnchor({ id: at === 0 ? null : item.id, index: at, via: null });
    const leaveMs = reduceMotion ? 0 : MOTION_DURATIONS_MS.exit;
    run.current.timers.push(
      setTimeout(() => {
        if (reduceMotion) return;
        fade.value = withTiming(0, { duration: leaveMs, easing: EASE_IN });
        shift.value = withTiming(-SHIFT_PX, { duration: leaveMs, easing: EASE_IN });
      }, CELEBRATE_MS),
      setTimeout(settle, CELEBRATE_MS + leaveMs)
    );
  };

  // Leaving mid-celebration still finishes the item.
  React.useEffect(() => {
    const box = run.current;
    return () => {
      box.timers.forEach(clearTimeout);
      const owed = box.owed;
      box.owed = null;
      owed?.onComplete?.();
    };
  }, []);

  // One pan per page (a gesture belongs to one detector), live only on the
  // page in view. It claims a clearly sideways drag; a vertical one fails it
  // and stays the screen's scroll.
  const pagePan = (at: number) =>
    Gesture.Pan()
      .enabled(at === index && count > 1 && celebratingId === null && width > 0)
      .activeOffsetX([-12, 12])
      .failOffsetY([-12, 12])
      .onUpdate((event) => {
        'worklet';
        let dx = event.translationX;
        if ((index === 0 && dx > 0) || (index === count - 1 && dx < 0)) dx *= EDGE_RESIST;
        offset.value = -index * stride + dx;
      })
      .onEnd((event) => {
        'worklet';
        const dx = event.translationX;
        let target = index;
        if ((dx < -stride * TURN_AT || event.velocityX < -FLICK_VELOCITY) && dx < 0 && index < count - 1) target = index + 1;
        else if ((dx > stride * TURN_AT || event.velocityX > FLICK_VELOCITY) && dx > 0 && index > 0) target = index - 1;
        offset.value = withTiming(-target * stride, { duration: MOTION_DURATIONS_MS.base, easing: SWIFT_OUT });
        if (target !== index) runOnJS(goToFromGesture)(target);
      });

  const wrapperStyle = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateX: shift.value }] }));
  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (count === 0) return null;

  const openId = expandedId !== null && expandedId === ids[index] ? expandedId : null;

  const renderCard = (item: NowCardPagerItem, at: number) => {
    return (
      <NowCardFrame
        sectionId={item.sectionId}
        Icon={item.Icon}
        eyebrow={item.eyebrow}
        eyebrowTone={item.eyebrowTone}
        title={item.title}
        meta={item.meta}
        progress={item.progress}
        body={item.body}
        expanded={openId === item.id}
        onToggleExpanded={
          celebratingId !== null ? undefined : () => setExpandedId((open) => (open === item.id ? null : item.id))
        }
        onOpen={celebratingId !== null ? undefined : item.onOpen}
        onComplete={item.onComplete ? () => celebrate(item, at) : undefined}
        headGesture={width > 0 ? pagePan(at) : undefined}
        // grow, not flex-1: flex-1's zero basis let a content-sized column
        // squeeze the card below its content when the screen relaid out
        // (the card drew over the feed controls). grow keeps the content
        // height and still fills a page stretched to a taller neighbour.
        className="grow"
      />
    );
  };

  return (
    <View className={cn('gap-2', className)}>
      <Animated.View onLayout={onLayout} style={wrapperStyle}>
        {width === 0 ? (
          renderCard(items[index], index)
        ) : (
          // An open card grows alone; its neighbours keep their own height
          // rather than stretching to match it.
          <Animated.View style={[{ flexDirection: 'row', gap: PAGE_GAP, alignItems: openId ? 'flex-start' : 'stretch' }, stripStyle]}>
            {items.map((item, at) => (
              <View
                key={item.id}
                style={{ width }}
                accessibilityElementsHidden={at !== index}
                importantForAccessibility={at === index ? 'auto' : 'no-hide-descendants'}
              >
                {renderCard(item, at)}
              </View>
            ))}
          </Animated.View>
        )}
      </Animated.View>
      {count > 1 && (
        <PagerControls
          index={index}
          count={count}
          disabled={celebratingId !== null}
          onPrev={() => goTo(index - 1, 'button')}
          onNext={() => goTo(index + 1, 'button')}
        />
      )}
    </View>
  );
}

/** Page dots with a chevron either side: where you are, and the tap path to turn (M3). */
function PagerControls({
  index,
  count,
  disabled,
  onPrev,
  onNext,
}: {
  index: number;
  count: number;
  disabled: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const atStart = index === 0;
  const atEnd = index === count - 1;
  return (
    <View className="flex-row items-center justify-center gap-2">
      <Pressable
        onPress={onPrev}
        disabled={disabled || atStart}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Previous item"
        accessibilityState={{ disabled: disabled || atStart }}
        className={cn('h-7 w-7 items-center justify-center rounded-full active:bg-muted', atStart && 'opacity-30')}
      >
        <ChevronLeft size={16} className="text-muted-foreground" />
      </Pressable>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Up next"
        accessibilityValue={{ text: `${index + 1} of ${count}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (disabled) return;
          if (e.nativeEvent.actionName === 'increment') onNext();
          if (e.nativeEvent.actionName === 'decrement') onPrev();
        }}
        className="flex-row items-center gap-1.5 px-1"
      >
        {Array.from({ length: count }, (_, at) => (
          <View key={at} className={cn('h-1.5 w-1.5 rounded-full', at === index ? 'bg-foreground/70' : 'bg-foreground/20')} />
        ))}
      </View>
      <Pressable
        onPress={onNext}
        disabled={disabled || atEnd}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Next item"
        accessibilityState={{ disabled: disabled || atEnd }}
        className={cn('h-7 w-7 items-center justify-center rounded-full active:bg-muted', atEnd && 'opacity-30')}
      >
        <ChevronRight size={16} className="text-muted-foreground" />
      </Pressable>
    </View>
  );
}
