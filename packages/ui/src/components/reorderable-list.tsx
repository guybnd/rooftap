// HOUP-129: universal long-press drag-to-reorder primitive, built on the
// existing gesture-handler + reanimated stack the app already hand-rolls its
// gesture primitives on (swipe-actions.tsx, drag-number-field.tsx) — no new
// dependency (react-native-draggable-flatlist lags Reanimated 4).
//
// Each row is wrapped whole (not just a handle icon) in a single `Pan`
// gesture configured with `activateAfterLongPress`: RNGH won't claim the
// touch from the surrounding ScrollView until the hold completes, so normal
// page scrolling is untouched outside a deliberate long-press-and-drag. This
// is only safe because consumers render `ReorderableList` in a mode where
// competing row gestures (tap-to-edit, swipe, long-press-to-edit) are
// already suppressed — see setup-item-card.tsx's `reorderMode` prop.
//
// Reused by HOUP-95 (Groceries in-aisle reorder) — keep this list-agnostic;
// no Setup/Groceries specifics belong here.
import * as React from 'react';
import { type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { ListGroup } from './list-item';
import { tick, commit } from '../lib/haptics';

const LONG_PRESS_MS = 250;
const SHIFT_DURATION_MS = 150;
const DROP_DURATION_MS = 200;

export interface ReorderableListProps<T> {
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, dragging: boolean) => React.ReactNode;
  onReorder: (nextOrderedIds: string[]) => void;
  disabled?: boolean;
  className?: string;
  /** Passed to ListGroup: false drops its card border and shadow, for a list
   *  that sits as an inset fill inside a panel that owns the border (H4). */
  bordered?: boolean;
}

export function ReorderableList<T>({ data, keyExtractor, renderItem, onReorder, disabled, className, bordered }: ReorderableListProps<T>) {
  const idsRef = React.useRef<string[]>([]);
  idsRef.current = data.map(keyExtractor);

  const rowHeight = useSharedValue(0);
  const draggedIndex = useSharedValue(-1);
  const targetIndex = useSharedValue(-1);
  const translateY = useSharedValue(0);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  const onRowLayout = React.useCallback(
    (e: LayoutChangeEvent) => {
      if (rowHeight.value === 0) rowHeight.value = e.nativeEvent.layout.height;
    },
    [rowHeight]
  );

  const handleDrop = React.useCallback(
    (from: number, to: number) => {
      if (from < 0 || to < 0 || from === to) return;
      const next = [...idsRef.current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onReorder(next);
    },
    [onReorder]
  );

  return (
    <ListGroup className={className} bordered={bordered}>
      {data.map((item, index) => {
        const id = keyExtractor(item);
        return (
          <ReorderableRow
            key={id}
            index={index}
            total={data.length}
            disabled={!!disabled}
            rowHeight={rowHeight}
            draggedIndex={draggedIndex}
            targetIndex={targetIndex}
            translateY={translateY}
            onLayout={onRowLayout}
            onDragStart={() => setDraggingId(id)}
            onDragEnd={() => setDraggingId(null)}
            onDrop={handleDrop}
          >
            {renderItem(item, draggingId === id)}
          </ReorderableRow>
        );
      })}
    </ListGroup>
  );
}

interface ReorderableRowProps {
  index: number;
  total: number;
  disabled: boolean;
  rowHeight: SharedValue<number>;
  draggedIndex: SharedValue<number>;
  targetIndex: SharedValue<number>;
  translateY: SharedValue<number>;
  onLayout: (e: LayoutChangeEvent) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: (from: number, to: number) => void;
  children: React.ReactNode;
}

function ReorderableRow({
  index,
  total,
  disabled,
  rowHeight,
  draggedIndex,
  targetIndex,
  translateY,
  onLayout,
  onDragStart,
  onDragEnd,
  onDrop,
  children,
}: ReorderableRowProps) {
  const pan = Gesture.Pan()
    .enabled(!disabled)
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => {
      'worklet';
      draggedIndex.value = index;
      targetIndex.value = index;
      runOnJS(commit)();
      runOnJS(onDragStart)();
    })
    .onUpdate((event) => {
      'worklet';
      translateY.value = event.translationY;
      const height = rowHeight.value || 1;
      const rawTarget = index + Math.round(event.translationY / height);
      const clamped = Math.max(0, Math.min(total - 1, rawTarget));
      if (clamped !== targetIndex.value) {
        targetIndex.value = clamped;
        runOnJS(tick)();
      }
    })
    .onEnd(() => {
      'worklet';
      const from = draggedIndex.value;
      const to = targetIndex.value;
      draggedIndex.value = -1;
      targetIndex.value = -1;
      translateY.value = withTiming(0, { duration: DROP_DURATION_MS });
      runOnJS(commit)();
      runOnJS(onDrop)(from, to);
      runOnJS(onDragEnd)();
    });

  const style = useAnimatedStyle(() => {
    if (draggedIndex.value === index) {
      return {
        transform: [{ translateY: translateY.value }],
        zIndex: 10,
        elevation: 8,
        opacity: 0.96,
      };
    }
    const d = draggedIndex.value;
    const t = targetIndex.value;
    let shift = 0;
    if (d !== -1 && t !== -1 && d !== t) {
      if (d < t && index > d && index <= t) shift = -rowHeight.value;
      else if (d > t && index >= t && index < d) shift = rowHeight.value;
    }
    return {
      transform: [{ translateY: withTiming(shift, { duration: SHIFT_DURATION_MS }) }],
      zIndex: 0,
      elevation: 0,
      opacity: 1,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style} onLayout={onLayout}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
