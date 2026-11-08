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
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { ChevronDown, Maximize2, MessagesSquare, SquarePen, Trash2, X } from 'lucide-react-native';
import {
  MOTION_DURATIONS_MS,
  chatChoices,
  deleteConversation,
  moduleHelper,
  openAssistantPopup,
  stepChoice,
  popupStatus,
  popupTitle,
  useAssistantPopupState,
  usePopupChats,
  usePopupSlot,
  usePopupSlotValue,
  usePopupThreadLifecycle,
  useAssistantThread,
  useModules,
  type AssistantConversation,
  type AssistantEdgePace,
  type ChatChoice,
  type PopupSlot,
  type ThreadTarget,
} from '@homeup/core';
import { Button, LeadingTile, ListGroup, SpectrumEdge, Text, cn, haptics, toast, useKeyboardOffset, useThemeMaterial, useStillMotion } from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';
import { sectionIconFor } from '@/lib/section-icons';
import { useOpenRoute } from '@/lib/tab-routes';
import { assistantApi } from './assistant-api';
import { archiveToast } from '@/lib/archive-toast';
import { ConversationRow } from './conversation-row';
import { ThreadFooter, ThreadMessages } from './thread-body';
import { devicePosition } from '@/lib/device-position';
import { RooftapTile } from '@/components/brand/rooftap-mark';

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

/** What the thread hands its card (core PopupSlot): the card stays put while the chat inside changes. */
interface PopupContent {
  /** Changes with the chat, so the inside starts clean. */
  key: number;
  pace: AssistantEdgePace;
  onSwipe?: (step: 1 | -1) => void;
  scrollY: SharedValue<number>;
  header: React.ReactNode;
  body: React.ReactNode;
}

export function AssistantChatPopup() {
  const modules = useModules();
  const { group } = useDataCache();
  const on = modules.isEnabled('assistant') && !!group?.id;
  const { state, minimize, dismissBack, fresh, remember } = useAssistantPopupState(on);
  const slot = usePopupSlot<PopupContent>();

  if (!on) return null;
  // The thread is keyed (a new chat starts clean) but the card is not, so
  // hopping between chats swaps what is inside it, with no shrink and grow.
  return (
    <>
    <PopupThread
      key={state.key}
      slotKey={state.key}
      slot={slot}
      open={state.open}
      target={state.target}
      ask={state.ask}
      back={state.back}
      onMinimize={minimize}
      onNavigateAway={() => minimize('navigate')}
      onDismissBack={dismissBack}
      onFresh={fresh}
      onConversation={remember}
    />
    <PopupCard slot={slot} open={state.open} onMinimize={minimize} />
    </>
  );
}

function PopupCard({ slot, open, onMinimize }: { slot: PopupSlot<PopupContent>; open: boolean; onMinimize: () => void }) {
  const content = usePopupSlotValue(slot);
  const idle = useSharedValue(0);
  return (
    <PopupSurface
      open={open}
      pace={content?.pace ?? 'rest'}
      onMinimize={onMinimize}
      onSwipe={content?.onSwipe}
      scrollY={content?.scrollY ?? idle}
      header={content ? <React.Fragment key={content.key}>{content.header}</React.Fragment> : null}
    >
      {content ? <React.Fragment key={content.key}>{content.body}</React.Fragment> : null}
    </PopupSurface>
  );
}

function PopupThread({
  slotKey,
  slot,
  open,
  target,
  ask,
  back,
  onMinimize,
  onNavigateAway,
  onDismissBack,
  onFresh,
  onConversation,
}: {
  slotKey: number;
  slot: PopupSlot<PopupContent>;
  open: boolean;
  target: ThreadTarget;
  ask?: string;
  back: 'pill' | 'bubble' | null;
  onMinimize: () => void;
  /** A tap in the chat opened another screen: put the chat away and offer it back. */
  onNavigateAway: () => void;
  onDismissBack: () => void;
  onFresh: () => void;
  onConversation: (c: AssistantConversation | null) => void;
}) {
  const { isOnline } = useDataCache();
  const openRoute = useOpenRoute();
  // The screen behind the chat, so "this" in a question can mean what is open.
  const pathname = usePathname();
  const pathRef = React.useRef(pathname);
  const openRef = React.useRef(open);
  React.useEffect(() => {
    openRef.current = open;
  }, [open]);
  React.useEffect(() => {
    // A tap in the chat (a row, a link) opened another screen behind it: the
    // item shows as usual, and a "Back to chat" pill brings the chat back.
    if (pathRef.current !== pathname && openRef.current) onNavigateAway();
    pathRef.current = pathname;
  }, [pathname, onNavigateAway]);

  const thread = useAssistantThread(target, {
    api: assistantApi,
    presence: () => (AppState.currentState !== 'active' ? 'background' : openRef.current ? 'here' : 'away'),
    toast: popupToast,
    screen: () => pathRef.current,
    here: devicePosition,
  });
  const { conversation, loadError, send, reload } = thread;
  // A delete can be taken back on servers that have archiving.
  const modules = useModules();
  const canUndo = modules.server('assistant.archive');

  usePopupThreadLifecycle({ open, ask, conversation, loadError, send, reload, onConversation });

  const expand = () => {
    if (!conversation) return;
    onMinimize();
    openRoute(`/assistant/${conversation.id}`);
  };

  // The header's chats button swaps the thread for the list of chats; picking one opens it here.
  const [showChats, setShowChats] = React.useState(false);
  // How far the chat (or the chats list) is scrolled: a drag down anywhere closes the card only from the top.
  const scrollY = useSharedValue(0);
  const onScrollY = React.useCallback((y: number) => {
    scrollY.value = y;
  }, [scrollY]);
  React.useEffect(() => {
    scrollY.value = 0;
  }, [showChats, scrollY]);
  const pick = (id: string) => {
    setShowChats(false);
    if (id !== conversation?.id) openAssistantPopup({ conversationId: id });
  };
  const allChats = () => {
    onMinimize();
    openRoute('/assistant');
  };

  const helper = conversation?.helper ?? target.helper ?? null;
  const title = popupTitle(showChats, conversation, target.id, helper);
  // The chats it can hop between (Rooftap and each helper): a strip under the header, and a sideways swipe on it.
  const choices = modules.server('assistant.helpers') ? chatChoices((id) => modules.isEnabled(id)) : [];
  const hop = React.useCallback(
    (step: 1 | -1) => {
      const next = stepChoice(choices, helper, step);
      if (!next) return;
      haptics.select();
      openAssistantPopup(next.helper ? { helper: next.helper } : { plain: true });
    },
    [choices, helper]
  );
  const [listening, setListening] = React.useState(false);
  // Re-read each minute so a quick ask's "more min" counts down while the pop-up is open.
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!open || conversation?.kind !== 'quick') return;
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [open, conversation?.kind]);
  const status = showChats ? null : listening ? 'Listening' : popupStatus(conversation, target.id, new Date(), helper);

  const backToChat =
    !open && back ? (
      <BackToChat
        mode={back}
        label={popupTitle(false, conversation, target.id, helper) || 'Rooftap'}
        helper={helper}
        working={thread.thinking}
        onOpen={() => openAssistantPopup()}
        onDismiss={onDismissBack}
      />
    ) : null;

  const header = (
        <View>
        <View className="flex-row items-center gap-1 pb-2 pl-3.5 pr-1.5">
          {!showChats && (
            <View>
              <RooftapTile size="md" working={thread.thinking} />
              {/* A helper wears its module's tile as a badge. */}
              {helper ? (
                <View className="absolute -bottom-2.5 -right-2.5" style={{ transform: [{ scale: 0.64 }] }}>
                  <LeadingTile sectionId={helper} Icon={sectionIconFor(helper)} size="sm" />
                </View>
              ) : null}
            </View>
          )}
          <View className={showChats ? 'min-w-0 flex-1 pl-0.5' : 'min-w-0 flex-1 pl-2'}>
            <Text numberOfLines={1} className="text-body font-semibold text-foreground">
              {title}
            </Text>
            {status && (
              <Text numberOfLines={1} className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {status}
              </Text>
            )}
          </View>
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
        {!showChats && choices.length > 1 ? <HelperStrip choices={choices} current={helper} /> : null}
        </View>
  );

  const body = showChats ? (
        <PopupChats currentId={conversation?.id ?? null} onPick={pick} onAll={allChats} onScrollY={onScrollY} />
      ) : (
        <>
          <ThreadMessages thread={thread} offline={!isOnline} onScrollY={onScrollY} />
          <ThreadFooter thread={thread} offline={!isOnline} autoFocus={open && target.id === 'new' && !target.helper && !ask} onFresh={onFresh} band lookingAt={pathname} onListening={setListening} />
        </>
      );

  // Every render hands the card what it shows now (before paint, so a hop never flashes the old chat).
  const pace: AssistantEdgePace = thread.thinking ? 'thinking' : listening ? 'listening' : 'rest';
  const onSwipe = !showChats && choices.length > 1 ? hop : undefined;
  React.useLayoutEffect(() => {
    slot.set({ key: slotKey, pace, onSwipe, scrollY, header, body });
  });

  return backToChat;
}

/**
 * The chats the pop-up can hop between: plain Rooftap, then each helper that
 * is on (core chatChoices). The one on show is filled; a tap, or a sideways
 * swipe on the header, opens another where it was left.
 */
function HelperStrip({ choices, current }: { choices: ChatChoice[]; current: string | null }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5 px-3.5 pb-2" accessibilityRole="tablist">
      {choices.map((c) => {
        const on = c.helper === current;
        return (
          <Pressable
            key={c.helper ?? 'rooftap'}
            onPress={() => {
              if (on) return;
              haptics.select();
              openAssistantPopup(c.helper ? { helper: c.helper } : { plain: true });
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            className={cn('h-8 flex-row items-center gap-1.5 rounded-full px-3', on ? 'bg-foreground' : 'bg-muted active:bg-muted/70')}
          >
            {c.helper ? (
              <View style={{ transform: [{ scale: 0.6 }] }} className="-mx-1.5">
                <LeadingTile sectionId={c.helper} Icon={sectionIconFor(c.helper)} size="sm" />
              </View>
            ) : (
              <View style={{ transform: [{ scale: 0.6 }] }} className="-mx-1.5">
                <RooftapTile size="sm" />
              </View>
            )}
            <Text className={cn('text-xs font-medium', on ? 'text-background' : 'text-foreground')}>
              {c.helper ? moduleHelper(c.helper)?.label.replace(/ helper$/, '') ?? c.label : c.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * The chat, put away, offering itself back: a "Back to <chat>" pill after a
 * tap in the chat opened an item, or a bubble at the edge for a helper chat
 * swiped away. Either one opens the chat where it was; the x lets it go (the
 * chat stays behind the +).
 */
function BackToChat({
  mode,
  label,
  helper,
  working,
  onOpen,
  onDismiss,
}: {
  mode: 'pill' | 'bubble';
  label: string;
  helper: string | null;
  working: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const material = useThemeMaterial();
  const badge = helper ? (
    <View className="absolute -bottom-2.5 -right-2.5" style={{ transform: [{ scale: 0.64 }] }}>
      <LeadingTile sectionId={helper} Icon={sectionIconFor(helper)} size="sm" />
    </View>
  ) : null;
  const open = () => {
    haptics.select();
    onOpen();
  };
  if (mode === 'pill') {
    return (
      <View pointerEvents="box-none" className="absolute inset-x-0 items-center px-4" style={{ bottom: insets.bottom + 84 }}>
        <View className="flex-row items-center gap-1 rounded-full border border-border bg-popover p-1" style={{ boxShadow: material.cardShadow }}>
          <Pressable onPress={open} accessibilityRole="button" className="min-h-11 flex-row items-center gap-2 rounded-full pl-1 pr-3 active:bg-muted">
            <View>
              <RooftapTile size="sm" working={working} />
              {badge}
            </View>
            <Text className="text-sm font-medium text-foreground">Back to {label}</Text>
          </Pressable>
          <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={6} className="h-9 w-9 items-center justify-center rounded-full active:bg-muted">
            <X size={16} className="text-muted-foreground" />
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View pointerEvents="box-none" className="absolute right-3" style={{ bottom: insets.bottom + 92 }}>
      <Pressable
        onPress={open}
        onLongPress={() => {
          haptics.remove();
          onDismiss();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Open ${label}`}
        accessibilityHint="Hold to close the bubble"
        className="h-14 w-14 items-center justify-center rounded-full border border-border bg-popover"
        style={{ boxShadow: material.cardShadow }}
      >
        <View>
          <RooftapTile size="md" working={working} />
          {badge}
        </View>
      </Pressable>
    </View>
  );
}

/**
 * The pop-up's list of chats: the Household thread, kept chats, open quick
 * asks and the latest closed ones, the same rows as the Assistant space.
 * Paints from the device's cache at once and refreshes from the server.
 */
function PopupChats({
  currentId,
  onPick,
  onAll,
  onScrollY,
}: {
  currentId: string | null;
  onPick: (id: string) => void;
  onAll: () => void;
  onScrollY: (y: number) => void;
}) {
  const { sections, error } = usePopupChats(assistantApi);
  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 px-4 py-3"
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={(e) => onScrollY(e.nativeEvent.contentOffset.y)}
    >
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
  pace,
  onMinimize,
  onSwipe,
  scrollY,
  header,
  children,
}: {
  open: boolean;
  /** A sideways swipe on the header: the next (1) or previous (-1) chat. */
  onSwipe?: (step: 1 | -1) => void;
  /** How far the body is scrolled; a drag down on the body closes the card only from the top. */
  scrollY: SharedValue<number>;
  /** How busy Rooftap is: the spectrum edge turns faster while it works. */
  pace: AssistantEdgePace;
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

  // Sideways on the header hops to the next or previous chat, like turning a page.
  const hasSwipe = !!onSwipe;
  const swipe = React.useCallback((step: 1 | -1) => onSwipe?.(step), [onSwipe]);
  const headerSwipe = Gesture.Pan()
    .enabled(hasSwipe)
    .activeOffsetX([-24, 24])
    .failOffsetY([-14, 14])
    .onEnd((event) => {
      'worklet';
      if (event.translationX < -60 || event.velocityX < -600) runOnJS(swipe)(1);
      else if (event.translationX > 60 || event.velocityX > 600) runOnJS(swipe)(-1);
    });
  const headerGesture = Gesture.Race(headerDrag, headerSwipe);

  // The same drag anywhere on the body, once nothing above is left to scroll
  // to (an empty ask never scrolls). It decides by hand: down from the top
  // takes over (the scroll view lets go), anything else is left to the
  // scroll view and the rows' own swipes.
  const touchStart = useSharedValue({ x: 0, y: 0 });
  const bodyDrag = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      'worklet';
      const t = e.allTouches[0];
      if (t) touchStart.value = { x: t.absoluteX, y: t.absoluteY };
    })
    .onTouchesMove((e, state) => {
      'worklet';
      const t = e.allTouches[0];
      if (!t) return;
      const dx = t.absoluteX - touchStart.value.x;
      const dy = t.absoluteY - touchStart.value.y;
      if (scrollY.value > 1 || dy < -8 || Math.abs(dx) > 16) state.fail();
      else if (dy > 12 && dy > Math.abs(dx) * 1.5) state.activate();
    })
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
              boxShadow: material.cardShadow,
            },
          ]}
          className="overflow-hidden rounded-[28px]"
        >
          {/* Hearth §13 "Living edge": the Rooftap spectrum round the card, turning faster while Rooftap works. */}
          <SpectrumEdge pace={pace} active={visible} radius={28} fill={material.glassBg} />
          <GestureDetector gesture={headerGesture}>
            <View className="border-b border-border">
              <View className="items-center pb-1 pt-2.5">
                <View className="h-1.5 w-10 rounded-full bg-foreground/20" />
              </View>
              {header}
            </View>
          </GestureDetector>
          <GestureDetector gesture={bodyDrag}>
            <View className="flex-1">{children}</View>
          </GestureDetector>
          {/* Hidden until the animated style lands: a Modal's first frame can draw before it does. */}
          <Animated.View pointerEvents="none" className="absolute inset-0 bg-primary" style={[{ opacity: 0 }, fabTintStyle]} />
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
