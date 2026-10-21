// Rooftap Assistant: the pop-up chat. It grows out of the + (swipe up or
// hold the +, the capture sheet's "Chat with Rooftap", a tapped notification
// or "Rooftap answered" banner) over whatever screen is open, and minimising
// shrinks it back into the +. Minimised, the conversation stays: a reply that
// lands meanwhile lights the + dot instead of a banner, and reopening shows
// it. core's openAssistantPopup() reaches this one host, mounted at the app
// root. Web twin: apps/web/src/components/assistant-chat-popup.tsx.
import * as React from 'react';
import { AppState, Keyboard, Modal, Pressable, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, Maximize2, SquarePen, Trash2 } from 'lucide-react-native';
import {
  MOTION_DURATIONS_MS,
  assistantUnread,
  conversationTitle,
  onAssistantPopup,
  setAssistantUnread,
  useAssistantThread,
  useModules,
  type AnsweredElsewhere,
  type AssistantConversation,
  type ThreadTarget,
} from '@homeup/core';
import { Text, haptics, toast, useKeyboardOffset, useThemeMaterial } from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';
import { useOpenRoute } from '@/lib/tab-routes';
import { assistantApi } from './assistant-api';
import { ThreadFooter, ThreadMessages } from './thread-body';

const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.42, 0, 1, 1);
/** The + sits this far above the bottom inset (tab bar row 58 less its -top-5 lift, to its centre). */
const FAB_CENTER_FROM_BOTTOM = 54;
/** The card rests this far above the bottom inset, covering the tab bar. */
const CARD_GAP = 10;
/** A drag down the header past this (or a flick) minimises. */
const DISMISS_PX = 110;
const DISMISS_VELOCITY = 800;

const popupToast = { error: (m: string) => toast.error(m), message: (m: string) => toast.message(m) };

interface PopupState {
  open: boolean;
  /** Bumped to start a different conversation (remounts the thread). */
  key: number;
  target: ThreadTarget;
  ask?: string;
}

export function AssistantChatPopup() {
  const modules = useModules();
  const { group } = useDataCache();
  const on = modules.isEnabled('assistant') && !!group?.id;
  const [state, setState] = React.useState<PopupState>({ open: false, key: 0, target: { id: 'new', kind: 'quick' } });
  // The conversation on show, so a request for it (or a plain reopen) resumes rather than restarts.
  const current = React.useRef<AssistantConversation | null>(null);

  React.useEffect(() => {
    if (!on) return;
    return onAssistantPopup((request) => {
      setState((prev) => {
        const shown = current.current;
        if (request.conversationId) {
          if (shown?.id === request.conversationId) return { ...prev, open: true, ask: undefined };
          current.current = null;
          return { open: true, key: prev.key + 1, target: { id: request.conversationId } };
        }
        // A quick ask that has since closed stays on show: its footer offers Continue or Start fresh.
        if (request.ask || request.fresh) {
          current.current = null;
          return { open: true, key: prev.key + 1, target: { id: 'new', kind: 'quick' }, ask: request.ask };
        }
        return { ...prev, open: true };
      });
    });
  }, [on]);

  const minimize = React.useCallback(() => setState((prev) => ({ ...prev, open: false })), []);
  const fresh = React.useCallback(() => {
    current.current = null;
    setState((prev) => ({ open: true, key: prev.key + 1, target: { id: 'new', kind: 'quick' } }));
  }, []);

  if (!on) return null;
  return (
    <PopupThread
      key={state.key}
      open={state.open}
      target={state.target}
      ask={state.ask}
      onMinimize={minimize}
      onFresh={fresh}
      onConversation={(c) => {
        current.current = c;
      }}
    />
  );
}

function PopupThread({
  open,
  target,
  ask,
  onMinimize,
  onFresh,
  onConversation,
}: {
  open: boolean;
  target: ThreadTarget;
  ask?: string;
  onMinimize: () => void;
  onFresh: () => void;
  onConversation: (c: AssistantConversation | null) => void;
}) {
  const { isOnline } = useDataCache();
  const openRoute = useOpenRoute();
  const openRef = React.useRef(open);
  React.useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Minimised with the app in front, a reply lights the + instead of a banner,
  // and counts as seen so no push follows.
  const quietAnswer = React.useCallback(({ conversation }: AnsweredElsewhere) => {
    setAssistantUnread(assistantUnread() + 1);
    haptics.tick();
    void assistantApi.markRead(conversation.id, { seen: true }).catch(() => {});
  }, []);
  const thread = useAssistantThread(target, {
    api: assistantApi,
    presence: () => (AppState.currentState !== 'active' ? 'background' : openRef.current ? 'here' : 'away'),
    onAway: quietAnswer,
    toast: popupToast,
  });
  const { conversation, send, reload } = thread;

  React.useEffect(() => onConversation(conversation), [conversation, onConversation]);

  // An ask handed over (the capture sheet's box) goes out once.
  const sentAsk = React.useRef(false);
  React.useEffect(() => {
    if (!ask || sentAsk.current) return;
    sentAsk.current = true;
    void send(ask);
  }, [ask, send]);

  // Reopening reads what landed while it was minimised (and clears the + dot).
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (open && !wasOpen.current && conversation) void reload();
    wasOpen.current = open;
  }, [open, conversation, reload]);

  const expand = () => {
    if (!conversation) return;
    onMinimize();
    openRoute(`/assistant/${conversation.id}`);
  };

  const title = conversation ? conversationTitle(conversation) : target.id === 'new' ? 'Ask Rooftap' : '';

  return (
    <PopupSurface
      open={open}
      onMinimize={onMinimize}
      header={
        <View className="flex-row items-center gap-1 pl-4 pr-1.5">
          <Text numberOfLines={1} className="min-w-0 flex-1 text-micro-label uppercase text-muted-foreground">
            {title}
          </Text>
          <Pressable onPress={onFresh} accessibilityRole="button" accessibilityLabel="New quick ask" className="h-11 w-10 items-center justify-center rounded-lg">
            <SquarePen size={18} className="text-muted-foreground" />
          </Pressable>
          {conversation && conversation.kind !== 'household' && (
            <Pressable
              onPress={() => void thread.remove().then((gone) => gone && onFresh())}
              accessibilityRole="button"
              accessibilityLabel="Delete this conversation"
              className="h-11 w-10 items-center justify-center rounded-lg"
            >
              <Trash2 size={18} className="text-muted-foreground" />
            </Pressable>
          )}
          {conversation && (
            <Pressable onPress={expand} accessibilityRole="button" accessibilityLabel="Open full screen" className="h-11 w-10 items-center justify-center rounded-lg">
              <Maximize2 size={18} className="text-muted-foreground" />
            </Pressable>
          )}
          <Pressable onPress={onMinimize} accessibilityRole="button" accessibilityLabel="Minimise" className="h-11 w-10 items-center justify-center rounded-lg">
            <ChevronDown size={20} className="text-muted-foreground" />
          </Pressable>
        </View>
      }
    >
      <ThreadMessages thread={thread} />
      <ThreadFooter thread={thread} offline={!isOnline} autoFocus={open && target.id === 'new' && !ask} onFresh={onFresh} />
    </PopupSurface>
  );
}

/**
 * The card itself: grows from the + (scaling up from its bottom centre while
 * the +'s coral fades into the glass), and shrinks back into it. Its own
 * Modal window, so like BottomSheet it needs its own gesture root, sizes
 * itself to the app frame and lifts over the keyboard (use-keyboard-offset).
 */
function PopupSurface({
  open,
  onMinimize,
  header,
  children,
}: {
  open: boolean;
  onMinimize: () => void;
  /** The title row; it drags down to minimise along with the handle. */
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const material = useThemeMaterial();
  const still = useReducedMotion();
  const keyboardOffset = useKeyboardOffset(insets.bottom);
  const [visible, setVisible] = React.useState(open);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);

  const restingHeight = Math.min(frame.height * 0.74, frame.height - insets.top - insets.bottom - 40);
  // From the card's resting bottom edge up to the +'s centre.
  const toFab = FAB_CENTER_FROM_BOTTOM - CARD_GAP;
  const hide = React.useCallback(() => setVisible(false), []);

  React.useEffect(() => {
    if (open) {
      setVisible(true);
      drag.value = 0;
      progress.value = withTiming(1, { duration: MOTION_DURATIONS_MS.slow, easing: SWIFT_OUT });
    } else {
      Keyboard.dismiss();
      progress.value = withTiming(0, { duration: MOTION_DURATIONS_MS.exit, easing: EASE_IN }, (finished) => {
        if (finished) runOnJS(hide)();
      });
    }
  }, [open, progress, drag, hide]);

  const headerDrag = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetX([-20, 20])
    .onUpdate((event) => {
      'worklet';
      drag.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      'worklet';
      if (event.translationY > DISMISS_PX || event.velocityY > DISMISS_VELOCITY) runOnJS(onMinimize)();
      else drag.value = withTiming(0, { duration: MOTION_DURATIONS_MS.base, easing: SWIFT_OUT });
    });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * Math.max(0, 1 - drag.value / restingHeight) }));
  const cardStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const lift = keyboardOffset.value;
    const room = frame.height - insets.top - 12 - (insets.bottom + CARD_GAP + lift);
    const height = Math.min(restingHeight, room);
    if (still) return { height, opacity: p, transform: [{ translateY: drag.value - lift }] };
    return {
      height,
      opacity: interpolate(p, [0, 0.15, 1], [0, 1, 1]),
      borderRadius: interpolate(p, [0, 0.5, 1], [40, 28, 28]),
      transform: [
        { translateY: drag.value - lift - toFab * (1 - p) },
        { scale: interpolate(p, [0, 1], [0.08, 1]) },
      ],
    };
  });
  // The +'s coral, fading into the glass as the card grows out of it.
  const fabTintStyle = useAnimatedStyle(() => ({ opacity: still ? 0 : interpolate(progress.value, [0, 0.45], [1, 0], 'clamp') }));

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onMinimize} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView
        style={frame.height > 0 ? { position: 'absolute', left: 0, top: 0, width: frame.width, height: frame.height } : { flex: 1 }}
      >
        <Animated.View style={scrimStyle} className="absolute inset-0 bg-black/40">
          <Pressable onPress={onMinimize} accessibilityLabel="Minimise" className="flex-1" />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[
            cardStyle,
            {
              position: 'absolute',
              left: CARD_GAP,
              right: CARD_GAP,
              bottom: insets.bottom + CARD_GAP,
              transformOrigin: 'bottom',
              backgroundColor: material.glassBg,
              borderColor: material.glassBorder,
              boxShadow: material.cardShadow,
            },
          ]}
          className="overflow-hidden rounded-[28px] border"
        >
          <GestureDetector gesture={headerDrag}>
            <View>
              <View className="items-center pb-1 pt-2.5">
                <View className="h-1.5 w-10 rounded-full bg-foreground/20" />
              </View>
              {header}
            </View>
          </GestureDetector>
          {children}
          <Animated.View pointerEvents="none" className="absolute inset-0 bg-primary" style={fabTintStyle} />
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
