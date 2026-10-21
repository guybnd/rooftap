// HOUP-443: the pieces of an Assistant conversation on native: reply text
// (core's parseReply subset), a message bubble, the proposal card and the
// composer. The proposal card's "Do it" is the one primary action on it (PC);
// its rows follow the three-slot line item (H6).
// Web twin: apps/web/src/app/assistant/assistant-parts.tsx.
import * as React from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { ArrowUp, Check, X } from 'lucide-react-native';
import { Text, LeadingTile, cn } from '@homeup/ui';
import {
  GHOST_REPLY_GROW_MS,
  GHOST_REPLY_LINES,
  GHOST_REPLY_STAGGER_MS,
  formatMicros,
  parseReply,
  timeAgo,
  type AssistantMessage,
  type ProposalState,
  type ReplySpan,
} from '@homeup/core';
import { sectionIconFor } from '@/lib/section-icons';

function Spans({ spans }: { spans: ReplySpan[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.href) {
          const href = s.href;
          return (
            <Text key={i} className="text-primary underline" onPress={() => void Linking.openURL(href)}>
              {s.text}
            </Text>
          );
        }
        if (s.bold) return <Text key={i} className="font-semibold text-foreground">{s.text}</Text>;
        if (s.italic) return <Text key={i} className="italic text-foreground">{s.text}</Text>;
        return <Text key={i}>{s.text}</Text>;
      })}
    </>
  );
}

export function ReplyText({ text }: { text: string }) {
  return (
    <View className="gap-1.5">
      {parseReply(text).map((b, i) =>
        b.type === 'paragraph' ? (
          <Text key={i} className="text-body leading-relaxed text-foreground">
            <Spans spans={b.spans} />
          </Text>
        ) : (
          <View key={i} className="flex-row gap-2 pl-1">
            <Text className="text-body text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {b.type === 'bullet' ? '•' : `${b.n}.`}
            </Text>
            <Text className="min-w-0 flex-1 text-body leading-relaxed text-foreground">
              <Spans spans={b.spans} />
            </Text>
          </View>
        )
      )}
    </View>
  );
}

const STATE_LABEL: Record<ProposalState, string> = { pending: 'Waiting', confirmed: 'Approved', declined: 'Not done', expired: 'Expired' };

export function ProposalCard({
  message,
  busy,
  onDecide,
}: {
  message: AssistantMessage;
  busy: boolean;
  onDecide: (decision: 'confirm' | 'decline') => void;
}) {
  const proposal = message.proposal;
  if (!proposal || proposal.items.length === 0) return null;
  const pending = proposal.state === 'pending';
  return (
    <View className="mt-2 overflow-hidden rounded-2xl bg-muted/40">
      {proposal.items.map((item, i) => (
        <View key={i} className={cn('min-h-[52px] flex-row items-center gap-3 px-3 py-2.5', i > 0 && 'border-t border-border/60')}>
          <LeadingTile sectionId={item.module} Icon={sectionIconFor(item.module)} size="sm" />
          <Text className="min-w-0 flex-1 text-sm text-foreground">{item.summary}</Text>
        </View>
      ))}
      <View className="flex-row items-center justify-end gap-2 px-3 pb-3 pt-1">
        {pending ? (
          <>
            <Pressable
              disabled={busy}
              onPress={() => onDecide('decline')}
              accessibilityRole="button"
              className={cn('h-11 justify-center rounded-xl px-3.5 active:bg-muted', busy && 'opacity-50')}
            >
              <Text className="text-sm font-medium text-muted-foreground">Not now</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => onDecide('confirm')}
              accessibilityRole="button"
              className={cn('h-11 flex-row items-center gap-1.5 rounded-xl bg-primary px-3.5 active:bg-primary/80', busy && 'opacity-50')}
            >
              <Check size={16} className="text-primary-foreground" />
              <Text className="text-sm font-medium text-primary-foreground">
                {proposal.items.length > 1 ? `Do all ${proposal.items.length}` : 'Do it'}
              </Text>
            </Pressable>
          </>
        ) : (
          <View className="flex-row items-center gap-1">
            {proposal.state === 'confirmed' ? (
              <Check size={14} className="text-success" />
            ) : (
              <X size={14} className="text-muted-foreground" />
            )}
            <Text className="text-xs text-muted-foreground">{STATE_LABEL[proposal.state]}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export function MessageBubble({
  message,
  showAuthor,
  showCost,
  busy,
  onDecide,
}: {
  message: AssistantMessage;
  showAuthor: boolean;
  showCost: boolean;
  busy: boolean;
  onDecide: (messageId: string, decision: 'confirm' | 'decline') => void;
}) {
  const user = message.role === 'user';
  // Older servers don't say whose a message is: every user message was the viewer's.
  const mine = user && (message.mine ?? true);
  // In the household thread members are named, and so is Rooftap, so a reply reads apart from the chat.
  const author = !showAuthor || mine ? null : user ? message.author : 'Rooftap';
  return (
    <View className={cn(mine ? 'items-end' : 'items-start')}>
      {author && <Text className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">{author}</Text>}
      <View
        className={cn(
          mine
            ? 'max-w-[88%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5'
            : user
              ? 'max-w-[88%] rounded-2xl rounded-bl-md bg-muted/50 px-3.5 py-2.5'
              : 'w-full px-1'
        )}
      >
        <ReplyText text={message.content} />
        {!user && <ProposalCard message={message} busy={busy} onDecide={(d) => onDecide(message.id, d)} />}
      </View>
      <Text className="mt-1 px-1 text-[11px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
        {timeAgo(message.created_at)}
        {message.channel === 'telegram' ? ' · Telegram' : ''}
        {showCost && message.cost_micros != null ? ` · ${formatMicros(message.cost_micros)}` : ''}
      </Text>
    </View>
  );
}

function GhostLine({ index, width, still }: { index: number; width: number; still: boolean }) {
  const grow = useSharedValue(still ? 1 : 0);
  const opacity = useSharedValue(1);
  React.useEffect(() => {
    if (still) return;
    // Hearth §8 "Ghost reply": each line eases out towards its width, a beat
    // after the one before, then shimmers like a skeleton (the one loop Hearth allows).
    const delay = index * GHOST_REPLY_STAGGER_MS;
    grow.value = withDelay(delay, withTiming(1, { duration: GHOST_REPLY_GROW_MS, easing: Easing.bezier(0.16, 1, 0.3, 1) }));
    opacity.value = withDelay(
      delay + GHOST_REPLY_GROW_MS / 3,
      withRepeat(withTiming(0.45, { duration: 2000, easing: Easing.inOut(Easing.ease) }), -1, true)
    );
    return () => {
      cancelAnimation(grow);
      cancelAnimation(opacity);
    };
  }, [index, still, grow, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scaleX: grow.value }] }));
  return (
    <View style={{ width: `${width * 100}%` }}>
      <Animated.View className="h-3 rounded-full bg-muted-foreground/15" style={[{ transformOrigin: 'left' }, style]} />
    </View>
  );
}

/** Rooftap working on a reply: faint lines grow where the answer will sit, shimmering until it lands. */
export function Thinking() {
  const still = useReducedMotion();
  return (
    <View className="w-full gap-2 px-1 py-1.5" accessibilityLabel="Rooftap is thinking" accessibilityRole="progressbar">
      {GHOST_REPLY_LINES.map((width, i) => (
        <GhostLine key={i} index={i} width={width} still={still} />
      ))}
    </View>
  );
}

export function Composer({
  placeholder,
  disabled,
  busy,
  autoFocus,
  onSend,
}: {
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  autoFocus?: boolean;
  onSend: (text: string) => Promise<boolean> | boolean;
}) {
  const [text, setText] = React.useState('');
  const canSend = !disabled && !busy && !!text.trim();

  const submit = async () => {
    const value = text.trim();
    if (!value || disabled || busy) return;
    setText('');
    if (!(await onSend(value))) setText(value);
  };

  return (
    <View className="flex-row items-end gap-2 rounded-3xl border border-border/60 bg-card p-1.5 pl-4">
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        autoFocus={autoFocus}
        editable={!disabled}
        maxLength={4000}
        placeholder={placeholder}
        accessibilityLabel={placeholder}
        className="max-h-40 min-h-10 flex-1 py-2 text-body text-foreground placeholder:text-muted-foreground"
      />
      <Pressable
        onPress={() => void submit()}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send"
        className={cn('size-10 items-center justify-center rounded-full bg-primary', !canSend && 'opacity-40')}
      >
        <ArrowUp size={20} className="text-primary-foreground" />
      </Pressable>
    </View>
  );
}
