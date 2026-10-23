// Recipes v2 R3: cooking heads (mockup 1C), the native primitive. The web
// twin is apps/web/src/components/cook/cook-heads.tsx.
//
// Each head is a round tile on the Recipes peach hue with initials, a ring
// for its nearest timer and a badge (the countdown, or the step). From
// HEADS_STACK_AT heads on they pile into one stack with a count. Drag moves
// the pile and it snaps to the nearest side edge on release; dropping the
// dragged head on the bottom target stops it. A tap opens it: the app draws
// the card (it owns the cook data).
//
// Plain RN Animated + PanResponder (JS thread, no worklets), so it ships by
// OTA with nothing to declare in order. The snap uses Hearth's settle token
// on the swift-out curve, and reduced motion makes it a jump (MO).
import * as React from 'react';
import { Animated, Easing, PanResponder, Pressable, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { cssInterop } from 'nativewind';
import { X } from 'lucide-react-native';
import {
  HEAD_GAP,
  HEAD_SIZE,
  HEADS_STACK_AT,
  MOTION_DURATIONS_MS,
  hueSwatch,
  overStopTarget,
  snapHeadDock,
  stopTargetCenter,
  type HeadDock,
} from '@homeup/core';
import { cn } from '../lib/cn';
import { commit, remove, select, warn } from '../lib/haptics';
import { useStillMotion, useThemeMaterial } from '../theme/theme-provider';
import { Text } from './text';

export interface CookHead {
  id: string;
  initials: string;
  /** "0:48", "2/3", or "Done". */
  badge: string;
  /** done = finished timer (danger), soon = under a minute (warning), step = no timer, paused = muted. */
  tone: 'running' | 'soon' | 'paused' | 'done' | 'step';
  /** How far the nearest timer is, 0 to 1; null with no timer. */
  progress: number | null;
  /** Spoken name: "Lemon risotto, timer 0:48". */
  label: string;
}

export interface CookHeadsProps {
  heads: CookHead[];
  dock: HeadDock;
  onDockChange: (dock: HeadDock) => void;
  onOpen: (id: string) => void;
  onStop: (id: string) => void;
  /** Space kept clear at the bottom (the tab bar and safe area). */
  bottomInset: number;
  /** Space kept clear at the top (the status bar). */
  topInset: number;
}

// The ring takes its colour from a `text-*` class as currentColor.
cssInterop(Svg, { className: { target: 'style', nativeStyleToProp: { color: true } } });

const EDGE = 10;
const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);

const BADGE_TEXT: Record<CookHead['tone'], string> = {
  running: 'text-foreground',
  soon: 'text-warning',
  paused: 'text-muted-foreground',
  done: 'text-destructive',
  step: 'text-muted-foreground',
};
const RING_TEXT: Record<CookHead['tone'], string> = {
  running: 'text-primary',
  soon: 'text-warning',
  paused: 'text-muted-foreground',
  done: 'text-destructive',
  step: 'text-transparent',
};

export function CookHeadFace({ head, size = HEAD_SIZE }: { head: CookHead; size?: number }) {
  const material = useThemeMaterial();
  const swatch = hueSwatch('peach', material.scheme);
  const r = 29;
  const c = 2 * Math.PI * r;
  const p = head.tone === 'done' ? 1 : head.progress ?? 0;
  return (
    <View
      className="items-center justify-center rounded-full border-2 border-background"
      style={{
        width: size,
        height: size,
        backgroundColor: swatch.tile,
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 9,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
      }}
    >
      {head.progress != null && (
        <Svg
          width={size + 8}
          height={size + 8}
          viewBox="0 0 62 62"
          style={{ position: 'absolute', left: -6, top: -6 }}
          className={RING_TEXT[head.tone]}
        >
          <Circle
            cx={31}
            cy={31}
            r={r}
            fill="none"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${c}`}
            strokeDashoffset={c * (1 - p)}
            stroke="currentColor"
            transform="rotate(-90 31 31)"
          />
        </Svg>
      )}
      <Text className="font-heading text-lg font-bold" style={{ color: swatch.glyph }}>
        {head.initials}
      </Text>
      {!!head.badge && (
        <View
          className="absolute h-5 items-center justify-center rounded-full border border-border bg-card px-1.5"
          style={{ bottom: -9, alignSelf: 'center' }}
        >
          <Text className={cn('font-mono text-[11px] font-semibold', BADGE_TEXT[head.tone])} style={{ fontVariant: ['tabular-nums'] }}>
            {head.badge}
          </Text>
        </View>
      )}
    </View>
  );
}

export function CookHeads({ heads, dock, onDockChange, onOpen, onStop, bottomInset, topInset }: CookHeadsProps) {
  const { width: viewW, height: viewH } = useWindowDimensions();
  const still = useStillMotion();
  const stacked = heads.length >= HEADS_STACK_AT;
  const shown = stacked ? heads.slice(0, 1) : heads;
  const pileHeight = stacked ? HEAD_SIZE + 12 : shown.length * HEAD_SIZE + Math.max(0, shown.length - 1) * HEAD_GAP;

  const rest = React.useMemo(() => {
    const left = dock.side === 'left' ? EDGE : viewW - HEAD_SIZE - EDGE;
    const maxTop = Math.max(topInset + 8, viewH - bottomInset - pileHeight - 24);
    const top = Math.min(Math.max(topInset + 8, dock.y * viewH - HEAD_SIZE / 2), maxTop);
    return { x: left, y: top };
  }, [dock, viewW, viewH, topInset, bottomInset, pileHeight]);

  const pos = React.useRef(new Animated.ValueXY(rest)).current;
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [overStop, setOverStop] = React.useState(false);
  const target = stopTargetCenter(viewW, viewH, bottomInset);

  // Glide to a new resting spot (after a snap, a rotation or a new head).
  React.useEffect(() => {
    if (dragging) return;
    if (still) {
      pos.setValue(rest);
      return;
    }
    Animated.timing(pos, {
      toValue: rest,
      duration: MOTION_DURATIONS_MS.settle,
      easing: SWIFT_OUT,
      useNativeDriver: false,
    }).start();
  }, [rest, dragging, still, pos]);

  // Latest values for the responder, which is made once per head.
  const live = React.useRef({ rest, viewW, viewH, bottomInset, onOpen, onStop, onDockChange, overStop });
  React.useEffect(() => {
    live.current = { rest, viewW, viewH, bottomInset, onOpen, onStop, onDockChange, overStop };
  });

  const responders = React.useRef(new Map<string, ReturnType<typeof PanResponder.create>>());
  const responderFor = (id: string) => {
    let r = responders.current.get(id);
    if (r) return r;
    r = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.hypot(g.dx, g.dy) > 6,
      onPanResponderGrant: () => {
        pos.stopAnimation();
      },
      onPanResponderMove: (_e, g) => {
        const L = live.current;
        if (Math.hypot(g.dx, g.dy) <= 6) return;
        setDragging((d) => {
          if (!d) select();
          return id;
        });
        pos.setValue({ x: L.rest.x + g.dx, y: L.rest.y + g.dy });
        const over = overStopTarget(L.rest.x + HEAD_SIZE / 2 + g.dx, L.rest.y + HEAD_SIZE / 2 + g.dy, L.viewW, L.viewH, L.bottomInset);
        if (over !== L.overStop) {
          if (over) warn();
          setOverStop(over);
        }
      },
      onPanResponderRelease: (_e, g) => {
        const L = live.current;
        setDragging(null);
        setOverStop(false);
        if (Math.hypot(g.dx, g.dy) <= 6) {
          commit();
          L.onOpen(id);
          return;
        }
        const cx = L.rest.x + HEAD_SIZE / 2 + g.dx;
        const cy = L.rest.y + HEAD_SIZE / 2 + g.dy;
        if (overStopTarget(cx, cy, L.viewW, L.viewH, L.bottomInset)) {
          remove();
          pos.setValue(L.rest);
          L.onStop(id);
          return;
        }
        L.onDockChange(snapHeadDock(cx, cy, L.viewW, L.viewH));
      },
      onPanResponderTerminate: () => {
        setDragging(null);
        setOverStop(false);
      },
    });
    responders.current.set(id, r);
    return r;
  };

  if (heads.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 60 }}>
      {dragging && (
        <View
          pointerEvents="none"
          className={cn(
            'absolute h-14 w-14 items-center justify-center rounded-full border-2 border-dashed bg-background/80',
            overStop ? 'border-destructive' : 'border-border',
          )}
          style={{ left: target.x - 28, top: target.y - 28, transform: [{ scale: overStop ? 1.1 : 1 }] }}
        >
          <X size={20} className={overStop ? 'text-destructive' : 'text-muted-foreground'} />
        </View>
      )}
      <Animated.View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: pos.x, top: pos.y, gap: HEAD_GAP }}
      >
        {stacked &&
          [2, 1].map((n) => (
            <View key={n} pointerEvents="none" style={{ position: 'absolute', top: n * 6, left: 0 }}>
              <CookHeadFace head={{ ...heads[n], badge: '', progress: null }} />
            </View>
          ))}
        {shown.map((head) => (
          <View key={head.id} {...responderFor(head.id).panHandlers}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={stacked ? `${head.label}, ${heads.length} recipes cooking` : head.label}
              onPress={() => onOpen(head.id)}
              style={{ transform: [{ scale: dragging === head.id ? 1.05 : 1 }] }}
            >
              <CookHeadFace head={head} />
              {stacked && (
                <View className="absolute -right-1 -top-1 h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1">
                  <Text className="font-mono text-[11px] font-semibold text-background">{heads.length}</Text>
                </View>
              )}
            </Pressable>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}
