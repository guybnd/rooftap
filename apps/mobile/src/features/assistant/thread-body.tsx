// Rooftap Assistant: a conversation's messages and composer, shared by the
// full chat screen (app/assistant/[id].tsx) and the pop-up chat that grows
// out of the + (chat-popup.tsx). State comes from core's useAssistantThread.
// Web twin: apps/web/src/app/assistant/thread-body.tsx.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import {
  ArriveScope,
  ArriveView,
  Button,
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  Text,
  cn,
  haptics,
} from '@homeup/ui';
import { askGreeting, askStarters, getSectionByPath, mentionOptions, minutesLeft, moduleHelper, useBriefOnShow, useBriefSlot, useModules, useThreadWindow, type AssistantThread } from '@homeup/core';
import { sectionIconFor } from '@/lib/section-icons';
import { useDataCache } from '@/lib/data-cache';
import { Composer, MessageBubble, Thinking } from './assistant-parts';
import { AssistantNotice } from './assistant-notice';
import { HelperAskChips, HelperBrief } from './helper-brief';
import { perfMark } from '@/lib/perf-log';

/** A thread still loading: faint lines where the conversation will be, not the thinking dots (nothing is thinking yet). */
function ThreadLoading() {
  return (
    <View className="gap-5" accessibilityLabel="Loading the conversation" accessibilityRole="progressbar">
      <View className="h-9 w-3/5 self-end rounded-2xl bg-muted/50" />
      <View className="gap-2">
        <View className="h-3 w-11/12 rounded-full bg-muted/40" />
        <View className="h-3 w-4/5 rounded-full bg-muted/40" />
        <View className="h-3 w-2/5 rounded-full bg-muted/40" />
      </View>
    </View>
  );
}

/** A load that failed (offline, timed out): why, and Try again. */
function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3">
      <Text className="min-w-0 flex-1 text-sm text-muted-foreground">{message}</Text>
      <Button variant="outline" className="h-11 px-3.5" onPress={onRetry}>
        <Text className="text-sm font-medium text-foreground">Try again</Text>
      </Button>
    </View>
  );
}

/**
 * "Try asking": asks worth asking from the household's enabled modules (core
 * askStarters: plans and changes, never what Home already shows), each a row
 * that sends the ask as it is. Shared by the empty Ask sheet and the
 * Assistant space. Renders nothing when no module offers one.
 */
export function AskStarters({ onAsk, disabled, count, className }: { onAsk: (text: string) => void; disabled: boolean; count?: number; className?: string }) {
  const modules = useModules();
  const starters = React.useMemo(() => askStarters((id) => modules.isEnabled(id), count), [modules, count]);
  if (starters.length === 0) return null;
  return (
    <View className={cn('gap-2', className)}>
      <ArriveView>
        <Text className="px-1 text-micro-label uppercase text-muted-foreground">Try asking</Text>
      </ArriveView>
      <ArriveView>
        <ListGroup>
          {starters.map((s) => (
            <ListItem
              key={s.module}
              disabled={disabled}
              className={cn('items-center gap-3', disabled && 'opacity-50')}
              onPress={() => {
                haptics.select();
                onAsk(s.text);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Ask: ${s.text}`}
            >
              <LeadingTile sectionId={s.module} Icon={sectionIconFor(s.module)} size="md" />
              <ListItemContent>
                <ListItemTitle numberOfLines={2}>{s.text}</ListItemTitle>
                <ListItemMeta>
                  <Text className="text-caption text-muted-foreground">{s.touches}</Text>
                </ListItemMeta>
              </ListItemContent>
              <ListItemTrailing className="mt-0">
                <ChevronRight size={16} className="text-muted-foreground" />
              </ListItemTrailing>
            </ListItem>
          ))}
        </ListGroup>
      </ArriveView>
    </View>
  );
}

/**
 * A new ask with nothing said yet (Hearth §13 "Ask sheet"): a greeting, then
 * asks worth asking from the household's enabled modules as a list (core
 * askStarters: plans and changes, never what Home already shows). Rows rise
 * in one after another (Arrive); a tap sends the ask as it is.
 */
function AskEmpty({ onAsk, disabled }: { onAsk: (text: string) => void; disabled: boolean }) {
  const { memberProfiles, currentUserId } = useDataCache();
  const name = currentUserId ? memberProfiles[currentUserId]?.name : null;
  return (
    <ArriveScope>
      <View className="gap-3">
        <ArriveView className="gap-1.5 px-0.5 pt-1">
          <Text className="font-heading text-[26px] font-bold leading-tight text-foreground">{askGreeting(name)}</Text>
          <Text className="text-sm leading-snug text-muted-foreground">
            I can plan, add and sort things across the house. I check with you before I change anything.
          </Text>
        </ArriveView>
        <AskStarters onAsk={onAsk} disabled={disabled} className="pt-1" />
      </View>
    </ArriveScope>
  );
}

/** What the chat can see behind it ("Looking at Groceries"), so "this" in an ask makes sense. */
function LookingAt({ path }: { path: string }) {
  const section = getSectionByPath(path);
  const Icon = sectionIconFor(section.id);
  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-full border border-border bg-card py-1 pl-1.5 pr-2.5">
      <Icon size={12} className="text-muted-foreground" />
      <Text className="text-xs text-muted-foreground">Looking at {section.shortLabel}</Text>
    </View>
  );
}

export function ThreadMessages({
  thread,
  chatKey,
  className,
  offline = false,
  onScrollY,
}: {
  thread: AssistantThread;
  /** Which chat this is, where one view shows several in turn (the pop-up): a new key opens at the start again. */
  chatKey?: React.Key;
  className?: string;
  offline?: boolean;
  /** How far the messages are scrolled (the pop-up closes on a drag down only from the top). */
  onScrollY?: (y: number) => void;
}) {
  const { loading, loadError, reload, messages, sending, thinking, draft, kind, showCost, deciding, decide, send, blocked, helper } = thread;
  // A helper chat opens on today's brief, kept above what this visit asked (useBriefSlot).
  const briefSlot = useBriefSlot(helper, messages);
  // A long chat opens on its latest messages; older ones wait behind Show earlier, so it paints at once.
  const { start, showEarlier } = useThreadWindow(messages.length, briefSlot);
  React.useEffect(() => perfMark('helper:messages', `${helper ?? 'rooftap'} n=${messages.length} start=${start} loading=${loading}`), [helper, messages.length, start, loading]);
  // Showing earlier messages grows the chat at the top: it stays where it is, not jumping to the end.
  const keepPlace = React.useRef(false);
  const scrollRef = React.useRef<ScrollView>(null);
  // The brief is the last thing on show (nothing asked this visit): the chat
  // opens at its top, not its end, and stays put while its rows load. Once
  // the person asks, the chat follows the answer to the end again.
  const briefLast = useBriefOnShow(thread);
  const briefTop = React.useRef<number | null>(null);
  // Another chat in the same view: forget this one's place, and land on the
  // new one without a scroll animation.
  const shownKey = React.useRef(chatKey);
  const jumping = React.useRef(false);
  if (shownKey.current !== chatKey) {
    shownKey.current = chatKey;
    briefTop.current = null;
    keepPlace.current = false;
    jumping.current = true;
  }
  React.useEffect(() => {
    if (!jumping.current) return;
    if (briefLast) scrollRef.current?.scrollTo({ y: 0, animated: false });
    else scrollRef.current?.scrollToEnd({ animated: false });
    const t = setTimeout(() => {
      jumping.current = false;
    }, 400);
    return () => clearTimeout(t);
  }, [chatKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const brief = helper ? (
    <View
      key="brief"
      onLayout={(e) => {
        const y = e.nativeEvent.layout.y;
        if (briefTop.current === y) return;
        briefTop.current = y;
        if (briefLast) scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: false });
      }}
    >
      <HelperBrief key={helper} helper={helper} />
    </View>
  ) : null;
  return (
    <ScrollView
      ref={scrollRef}
      className={className ?? 'flex-1'}
      contentContainerClassName="gap-5 px-4 py-4"
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => {
        if (keepPlace.current) {
          keepPlace.current = false;
          return;
        }
        if (!briefLast) scrollRef.current?.scrollToEnd({ animated: !loading && !jumping.current });
      }}
      // The keyboard shortens the chat: keep the newest message in sight.
      onLayout={() => {
        if (!briefLast) scrollRef.current?.scrollToEnd({ animated: false });
      }}
      scrollEventThrottle={onScrollY ? 16 : undefined}
      onScroll={onScrollY ? (e) => onScrollY(e.nativeEvent.contentOffset.y) : undefined}
    >
      {loadError && !loading && <LoadFailed message={loadError} onRetry={() => void reload()} />}
      {loading ? (
        <ThreadLoading />
      ) : loadError && messages.length === 0 ? null : messages.length === 0 && !sending ? (
        kind === 'household' && !helper ? (
          <Text className="px-1 py-10 text-center text-sm text-muted-foreground">
            The household chat. Talk to each other here, and tag @Rooftap when you want it to look something up or make a change.
          </Text>
        ) : helper ? (
          brief
        ) : (
          <AskEmpty onAsk={(text) => void send(text)} disabled={offline || !!blocked} />
        )
      ) : (
        [
          start > 0 ? (
            <Pressable
              key="earlier"
              onPress={() => {
                keepPlace.current = true;
                showEarlier();
              }}
              accessibilityRole="button"
              hitSlop={6}
              className="h-9 self-center justify-center rounded-full px-3 active:bg-muted"
            >
              <Text className="text-xs font-medium text-muted-foreground">Show earlier</Text>
            </Pressable>
          ) : null,
          ...messages.slice(start).map((m, j) => {
          const i = start + j;
          return [
          i === briefSlot ? brief : null,
          <MessageBubble
            key={m.id}
            message={m}
            showAuthor={kind === 'household'}
            showCost={showCost}
            busy={deciding === m.id}
            onDecide={(mid, d, picks) => void decide(mid, d, picks)}
          />,
          ];
          }),
        ]
      )}
      {messages.length > 0 && briefSlot === messages.length && !sending ? brief : null}
      {thinking && <Thinking draft={draft} />}
    </ScrollView>
  );
}

/** A quick ask past its quiet time: carry on with its history, or start over. */
function ClosedFooter({ onContinue, onFresh }: { onContinue: () => void; onFresh?: () => void }) {
  return (
    <View className="gap-3 rounded-2xl border border-border/60 bg-card p-4">
      <Text className="text-sm text-muted-foreground">This quick ask closed after a quiet spell. Pick it back up with everything said so far, or start over.</Text>
      <View className="flex-row gap-2">
        <Button size="lg" className="h-11 flex-1" onPress={onContinue}>
          <Text className="text-body font-medium text-primary-foreground">Continue</Text>
        </Button>
        {onFresh && (
          <Button size="lg" variant="outline" className="h-11 flex-1" onPress={onFresh}>
            <Text className="text-body font-medium text-foreground">Start fresh</Text>
          </Button>
        )}
      </View>
    </View>
  );
}

export function ThreadFooter({
  thread,
  chatKey,
  offline,
  autoFocus,
  onFresh,
  band = false,
  lookingAt,
  onListening,
}: {
  thread: AssistantThread;
  /** Which chat this is, where one view shows several in turn: a new key clears the text box. */
  chatKey?: React.Key;
  offline: boolean;
  autoFocus?: boolean;
  /** The pop-up: the composer sits on its own tinted band under a hairline, and the header says how long a quick ask stays open. */
  band?: boolean;
  /** The route behind the pop-up: shown above the composer while nothing has been said. */
  lookingAt?: string;
  /** Voice input started or stopped. */
  onListening?: (on: boolean) => void;
  /** Starts a new quick ask (offered when this one has closed). */
  onFresh?: () => void;
}) {
  const { conversation, kind, blocked, sending, send, closed, resume, helper } = thread;
  const briefOnShow = useBriefOnShow(thread);
  // A helper chat the household shares answers every message, so it needs no tags.
  const room = kind === 'household' && !helper;
  const left = conversation && !closed ? minutesLeft(conversation) : null;
  const { groupMembers, memberProfiles, currentUserId } = useDataCache();
  const mentions = React.useMemo(
    () => (room ? mentionOptions(groupMembers, memberProfiles, currentUserId) : undefined),
    [room, groupMembers, memberProfiles, currentUserId]
  );
  return (
    <View className={cn('gap-2 px-4 pb-3', band && 'border-t border-border bg-muted/40 pt-2.5')}>
      {blocked && blocked !== 'assistant_conversation_closed' && <AssistantNotice code={blocked} />}
      {closed || blocked === 'assistant_conversation_closed' ? (
        <ClosedFooter onContinue={resume} onFresh={onFresh} />
      ) : (
        <>
          {lookingAt && !thread.messages.length && !thread.loading && <LookingAt path={lookingAt} />}
          {helper && briefOnShow ? (
            <HelperAskChips helper={helper} onAsk={(text) => void send(text)} disabled={offline || !!blocked} />
          ) : null}
          <Composer
            key={chatKey}
            placeholder={
              room
                ? 'Message the household, tag @Rooftap to ask it'
                : helper && kind === 'household'
                  ? 'Ask the helper, everyone at home sees it'
                  : helper
                    ? `Ask the ${moduleHelper(helper)?.label ?? 'helper'}`
                    : conversation
                      ? 'Ask a follow-up'
                      : 'Ask Rooftap anything'
            }
            disabled={offline || blocked === 'assistant_requires_plus' || (blocked === 'assistant_not_configured' && !room)}
            busy={sending}
            autoFocus={autoFocus || thread.resumed}
            photos={thread.photos}
            mentions={mentions}
            voice
            onListening={onListening}
            onSend={send}
          />
          {!band && left != null && left > 0 && (
            <Text className="px-2 text-[11px] text-muted-foreground">Takes follow-ups for {left} more min. Pin it to keep it as a chat.</Text>
          )}
        </>
      )}
    </View>
  );
}
