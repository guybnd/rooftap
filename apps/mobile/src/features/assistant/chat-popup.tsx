// Rooftap Assistant: the pop-up chat. It grows out of the + (swipe up or
// hold the +, the capture sheet's "Chat with Rooftap", a tapped notification
// or "Rooftap answered" banner) over whatever screen is open, and minimising
// shrinks it back into the +. Minimised, the conversation stays: a reply that
// lands meanwhile shows the "Rooftap answered" banner and lights the + dot,
// and reopening shows it. core's openAssistantPopup() reaches this one host, mounted at the app
// root. Web twin: apps/web/src/components/assistant-chat-popup.tsx.
import * as React from 'react';
import { AppState, Keyboard, Modal, Pressable, ScrollView, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { ChevronDown, Maximize2, MessagesSquare, SquarePen, Trash2 } from 'lucide-react-native';
import {
  MOTION_DURATIONS_MS,
  deleteConversation,
  openAssistantPopup,
  popupTitle,
  useAssistantPopupState,
  usePopupChats,
  usePopupThreadLifecycle,
  useAssistantThread,
  useModules,
  type AssistantConversation,
  type ThreadTarget,
} from '@homeup/core';
import { Button, ListGroup, Text, toast, useKeyboardOffset, useThemeMaterial, useStillMotion } from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';
import { useOpenRoute } from '@/lib/tab-routes';
import { assistantApi } from './assistant-api';
import { archiveToast } from '@/lib/archive-toast';
import { ConversationRow } from './conversation-row';
import { ThreadFooter, ThreadMessages } from './thread-body';
import { devicePosition } from '@/lib/device-position';

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

export function AssistantChatPopup() {
  const modules = useModules();
  const { group } = useDataCache();
  const on = modules.isEnabled('assistant') && !!group?.id;
  const { state, minimize, fresh, remember } = useAssistantPopupState(on);

  if (!on) return null;
  return (
    <PopupThread
      key={state.key}
      open={state.open}
      target={state.target}
      ask={state.ask}
      onMinimize={minimize}
      onFresh={fresh}
      onConversation={remember}
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
  // The screen behind the chat, so "this" in a question can mean what is open.
  const pathname = usePathname();
  const pathRef = React.useRef(pathname);
  React.useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const openRef = React.useRef(open);
  React.useEffect(() => {
    openRef.current = open;
  }, [open]);

  const thread = useAssistantThread(target, {
    api: assistantApi,
    presence: () => (AppState.currentState !== 'active' ? 'background' : openRef.current ? 'here' : 'away'),
    toast: popupToast,
    screen: () => pathRef.current,
    here: devicePosition,
  });
  const { conversation, loadError, send, reload } = thread;
  // A delete can be taken back on servers that have archiving.
  const canUndo = useModules().server('assistant.archive');

  usePopupThreadLifecycle({ open, ask, conversation, loadError, send, reload, onConversation });

  const expand = () => {
    if (!conversation) return;
    onMinimize();
    openRoute(`/assistant/${conversation.id}`);
  };

  // The header's chats button swaps the thread for the list of chats; picking one opens it here.
  const [showChats, setShowChats] = React.useState(false);
  const pick = (id: string) => {
    setShowChats(false);
    if (id !== conversation?.id) openAssistantPopup({ conversationId: id });
  };
  const allChats = () => {
    onMinimize();
    openRoute('/assistant');
  };

  const title = popupTitle(showChats, conversation, target.id);

  return (
    <PopupSurface
      open={open}
      onMinimize={onMinimize}
      header={
        <View className="flex-row items-center gap-1 pl-4 pr-1.5">
          <Text numberOfLines={1} className="min-w-0 flex-1 text-micro-label uppercase text-muted-foreground">
            {title}
          </Text>
          <Pressable
            onPress={() => setShowChats((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={showChats ? 'Back to this chat' : 'Your chats'}
            accessibilityState={{ selected: showChats }}
            className={`h-11 w-10 items-center justify-center rounded-lg ${showChats ? 'bg-muted' : ''}`}
          >
            <MessagesSquare size={18} className={showChats ? 'text-foreground' : 'text-muted-foreground'} />
          </Pressable>
          <Pressable onPress={onFresh} accessibilityRole="button" accessibilityLabel="New quick ask" className="h-11 w-10 items-center justify-center rounded-lg">
            <SquarePen size={18} className="text-muted-foreground" />
          </Pressable>
          {!showChats && conversation && conversation.kind !== 'household' && (
            <Pressable
              onPress={() => void (canUndo ? deleteConversation(assistantApi, conversation, archiveToast) : thread.remove()).then((gone) => gone && onFresh())}
              accessibilityRole="button"
              accessibilityLabel="Delete this conversation"
              className="h-11 w-10 items-center justify-center rounded-lg"
            >
              <Trash2 size={18} className="text-muted-foreground" />
            </Pressable>
          )}
          {!showChats && conversation && (
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
      {showChats ? (
        <PopupChats currentId={conversation?.id ?? null} onPick={pick} onAll={allChats} />
      ) : (
        <>
          <ThreadMessages thread={thread} />
          <ThreadFooter thread={thread} offline={!isOnline} autoFocus={open && target.id === 'new' && !ask} onFresh={onFresh} />
        </>
      )}
    </PopupSurface>
  );
}

/**
 * The pop-up's list of chats: the Household thread, kept chats, open quick
 * asks and the latest closed ones, the same rows as the Assistant space.
 * Paints from the device's cache at once and refreshes from the server.
 */
function PopupChats({ currentId, onPick, onAll }: { currentId: string | null; onPick: (id: string) => void; onAll: () => void }) {
  const { sections, error } = usePopupChats(assistantApi);
  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 py-3" keyboardShouldPersistTaps="handled">
      {error && <Text className="px-1 text-sm text-muted-foreground">{error}</Text>}
      {sections.length === 0 && !error && (
        <Text className="px-1 py-10 text-center text-sm text-muted-foreground">No chats yet. Ask something and it shows here.</Text>
      )}
      {sections.map((section) => (
        <View key={section.label} className="gap-2">
          <Text className="px-1 text-micro-label uppercase text-muted-foreground">{section.label}</Text>
          <ListGroup>
            {section.rows.map((c) => (
              <ConversationRow key={c.id} conversation={c} current={c.id === currentId} onPress={() => onPick(c.id)} />
            ))}
          </ListGroup>
        </View>
      ))}
      <Button variant="ghost" onPress={onAll} className="h-11 self-center px-3.5">
        <Text className="text-sm font-medium text-foreground">All chats</Text>
      </Button>
    </ScrollView>
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
  const still = useStillMotion();
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
  // The +'s coral, fading into the glass while the card is still small. It is
  // gone by a quarter of the way so a stalled first frame (the Modal's new
  // window on Android, a busy thread right after the hold) never holds a
  // full-size coral card.
  const fabTintStyle = useAnimatedStyle(() => ({ opacity: still ? 0 : interpolate(progress.value, [0, 0.25], [1, 0], 'clamp') }));

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
          {/* Hidden until the animated style lands: a Modal's first frame can draw before it does. */}
          <Animated.View pointerEvents="none" className="absolute inset-0 bg-primary" style={[{ opacity: 0 }, fabTintStyle]} />
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
