// HOUP-443: the pieces of an Assistant conversation on native: reply text
// (core's parseReply subset), a message bubble, the proposal card and the
// composer. The proposal card's "Do it" is the one primary action on it (PC);
// its rows follow the three-slot line item (H6).
// Web twin: apps/web/src/app/assistant/assistant-parts.tsx.
import * as React from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useRouter, type Href } from 'expo-router';
import { ArrowUp, AtSign, Camera, Check, ChevronRight, ImageOff, ImagePlus, Images, Sparkles, X } from 'lucide-react-native';
import {
  BottomSheet,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  Text,
  LeadingTile,
  cn,
  haptics,
  toast,
  useRowMenuSheet,
  useStillMotion,
} from '@homeup/ui';
import {
  GHOST_REPLY_GROW_MS,
  GHOST_REPLY_LINES,
  GHOST_REPLY_STAGGER_MS,
  formatMicros,
  insertMention,
  mentionAt,
  parseReply,
  suggestMentions,
  type MentionOption,
  MAX_ASSISTANT_PHOTOS,
  useComposerPhotos,
  useProposalPicks,
  useReplyItems,
  type ReplyItemRow,
  type RowMenu,
  type AssistantPhoto,
  type OutgoingPhoto,
  type PickedPhoto,
  timeAgo,
  type AssistantDraft,
  type AssistantMessage,
  type ProposalPick,
  type ProposalState,
  type ReplySpan,
} from '@homeup/core';
import { sectionIconFor } from '@/lib/section-icons';
import { useDataCache } from '@/lib/data-cache';
import { getBoundSupabaseClient } from '@/lib/supabase-client';
import { assistantApi } from './assistant-api';

function Spans({ spans }: { spans: ReplySpan[] }) {
  const router = useRouter();
  return (
    <>
      {spans.map((s, i) => {
        if (s.href) {
          const href = s.href;
          // An app route (a Scout run the assistant started) opens in the app.
          const open = () => (href.startsWith('/') ? router.push(href as Href) : void Linking.openURL(href));
          return (
            <Text key={i} className="text-primary underline" onPress={open}>
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

// Selectable, so a long press copies a reply (or part of one) with the
// system's own text menu: no clipboard module, so no new app build.
export function ReplyText({ text }: { text: string }) {
  return (
    <View className="gap-1.5">
      {parseReply(text).map((b, i) =>
        b.type === 'paragraph' ? (
          <Text key={i} selectable className="text-body leading-relaxed text-foreground">
            <Spans spans={b.spans} />
          </Text>
        ) : (
          <View key={i} className="flex-row gap-2 pl-1">
            <Text className="text-body text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {b.type === 'bullet' ? '•' : `${b.n}.`}
            </Text>
            <Text selectable className="min-w-0 flex-1 text-body leading-relaxed text-foreground">
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
  onDecide: (decision: 'confirm' | 'decline', picks?: ProposalPick[]) => void;
}) {
  const proposal = message.proposal;
  const pick = useProposalPicks(proposal);
  if (!proposal || proposal.items.length === 0) return null;
  const pending = proposal.state === 'pending';
  const { choices, ticks, keptCount } = pick;
  return (
    <View className="mt-2 overflow-hidden rounded-2xl bg-muted/40">
      {pending
        ? choices.map((c, i) => {
            const off = pick.isLeft(c.key);
            // An entry's change is named once, above its first entry.
            const caption = c.group !== null && c.group !== choices[i - 1]?.group;
            return (
              <React.Fragment key={c.key}>
                {caption && (
                  <View className={cn('flex-row items-center gap-3 px-3 pt-2.5', i > 0 && 'border-t border-border/60')}>
                    <LeadingTile sectionId={c.module} Icon={sectionIconFor(c.module)} size="sm" />
                    <Text className="min-w-0 flex-1 text-sm text-muted-foreground">{c.group}</Text>
                  </View>
                )}
                <Pressable
                  disabled={busy || !ticks}
                  onPress={() => pick.toggle(c.key)}
                  accessibilityRole={ticks ? 'checkbox' : undefined}
                  accessibilityState={ticks ? { checked: !off } : undefined}
                  className={cn(
                    'min-h-[48px] flex-row items-center gap-3 px-3 py-2',
                    i > 0 && !caption && c.group === null && 'border-t border-border/60'
                  )}
                >
                  {c.group === null ? (
                    <LeadingTile sectionId={c.module} Icon={sectionIconFor(c.module)} size="sm" />
                  ) : (
                    <View style={{ width: 28 }} />
                  )}
                  {c.text !== null ? (
                    <TextInput
                      value={pick.textFor(c.key, c.text)}
                      onChangeText={(t) => pick.setText(c.key, t)}
                      editable={!busy && !off}
                      accessibilityLabel="Name"
                      className={cn('min-w-0 flex-1 py-0 text-sm text-foreground', off && 'text-muted-foreground line-through')}
                    />
                  ) : (
                    <Text className={cn('min-w-0 flex-1 text-sm text-foreground', off && 'text-muted-foreground line-through')}>
                      {c.label}
                    </Text>
                  )}
                  {ticks && (
                    <View
                      className={cn(
                        'h-6 w-6 items-center justify-center rounded-full border',
                        off ? 'border-border' : 'border-primary bg-primary'
                      )}
                    >
                      {!off && <Check size={14} className="text-primary-foreground" />}
                    </View>
                  )}
                </Pressable>
              </React.Fragment>
            );
          })
        : proposal.items.map((item, i) => (
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
              disabled={busy || keptCount === 0}
              onPress={() => onDecide('confirm', pick.picks())}
              accessibilityRole="button"
              className={cn(
                'h-11 flex-row items-center gap-1.5 rounded-xl bg-primary px-3.5 active:bg-primary/80',
                (busy || keptCount === 0) && 'opacity-50'
              )}
            >
              <Check size={16} className="text-primary-foreground" />
              <Text className="text-sm font-medium text-primary-foreground">{pick.label}</Text>
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
  onDecide: (messageId: string, decision: 'confirm' | 'decline', picks?: ProposalPick[]) => void;
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
        {message.photos?.length ? <MessagePhotos photos={message.photos} spaced={!!message.content} /> : null}
        {message.content ? <ReplyText text={message.content} /> : null}
        {!user && message.content ? <ReplyItems text={message.content} /> : null}
        {!user && <ProposalCard message={message} busy={busy} onDecide={(d, picks) => onDecide(message.id, d, picks)} />}
      </View>
      <Text className="mt-1 px-1 text-[11px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
        {timeAgo(message.created_at)}
        {message.channel === 'telegram' ? ' · Telegram' : ''}
        {showCost && message.cost_micros != null ? ` · ${formatMicros(message.cost_micros)}` : ''}
      </Text>
    </View>
  );
}

/** Photos sent with a message: each opens full size; one past the keep time says so. */
function MessagePhotos({ photos, spaced }: { photos: AssistantPhoto[]; spaced: boolean }) {
  return (
    <View className={cn('flex-row flex-wrap justify-end gap-1.5', spaced && 'mb-2')}>
      {photos.map((p, i) =>
        p.url ? (
          <Pressable
            key={i}
            onPress={() => p.url?.startsWith('http') && void Linking.openURL(p.url)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Photo ${i + 1}`}
            className="overflow-hidden rounded-xl"
          >
            <Image source={{ uri: p.url }} style={{ width: 144, height: 144 }} resizeMode="cover" />
          </Pressable>
        ) : (
          <View key={i} className="h-20 w-28 items-center justify-center gap-1 rounded-xl bg-background/60">
            <ImageOff size={16} className="text-muted-foreground" />
            <Text className="text-[11px] text-muted-foreground">No longer kept</Text>
          </View>
        )
      )}
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
export function Thinking({ draft }: { draft?: AssistantDraft | null }) {
  const still = useStillMotion();
  const text = draft?.text.trimStart() ?? '';
  // HOUP-509 (Hearth §8 "Streamed reply"): the answer replaces the lines as it is written.
  if (text) {
    return (
      <View className="w-full px-1" accessibilityLiveRegion="polite">
        <ReplyText text={text} />
        {draft?.status ? <Text className="mt-1.5 text-[13px] text-muted-foreground">{draft.status}</Text> : null}
      </View>
    );
  }
  return (
    <View className="w-full gap-2 px-1 py-1.5" accessibilityLabel="Rooftap is thinking" accessibilityRole="progressbar">
      {GHOST_REPLY_LINES.map((width, i) => (
        <GhostLine key={i} index={i} width={width} still={still} />
      ))}
      {draft?.status ? <Text className="pt-1 text-[13px] text-muted-foreground">{draft.status}</Text> : null}
    </View>
  );
}

/** Picks photos with the system picker; empty when cancelled. Throws a line to show when access is refused. */
async function pickPhotos(source: 'camera' | 'library', room: number): Promise<PickedPhoto[]> {
  const perm =
    source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error(source === 'camera' ? 'Rooftap needs the camera to take a photo. Allow it in your phone settings.' : 'Rooftap needs your photos to attach one. Allow it in your phone settings.');
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: room > 1, selectionLimit: room });
  if (result.canceled) return [];
  return (result.assets ?? []).map((asset) => ({
    preview: asset.uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
    size: asset.fileSize ?? null,
    read: async () => decode(await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 })),
  }));
}

/** Where a photo comes from: the camera or the photo library. */
function PhotoSourceSheet({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (source: 'camera' | 'library') => void }) {
  const choose = (source: 'camera' | 'library') => {
    onOpenChange(false);
    onPick(source);
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="pb-6">
      <View className="gap-3 px-4">
        <Text className="text-micro-label uppercase text-muted-foreground">Add a photo</Text>
        <ListGroup>
          <ListItem className="items-center gap-3" onPress={() => choose('camera')} accessibilityRole="button" accessibilityLabel="Take a photo">
            <Camera size={20} className="text-muted-foreground" />
            <ListItemContent>
              <ListItemTitle>Take a photo</ListItemTitle>
            </ListItemContent>
          </ListItem>
          <ListItem className="items-center gap-3" onPress={() => choose('library')} accessibilityRole="button" accessibilityLabel="Choose from your photos">
            <Images size={20} className="text-muted-foreground" />
            <ListItemContent>
              <ListItemTitle>Choose from your photos</ListItemTitle>
            </ListItemContent>
          </ListItem>
        </ListGroup>
      </View>
    </BottomSheet>
  );
}

const ITEM_KIND_LABEL: Record<ReplyItemRow['kind'], string> = {
  recipe: 'Recipe',
  checklist: 'Checklist',
  watch: 'Watch',
  scout: 'Scout',
  listing: 'Listing',
};

/**
 * The items a reply links to, as line-item rows under it (H6), read live from
 * the household's stores: a ticked list item or a recipe kept from To try
 * shows here too. Tap opens the item; hold gives its row menu (§13.7) when it
 * has more than Open. Web twin: ReplyItems in apps/web assistant-parts.tsx.
 */
function ReplyItems({ text }: { text: string }) {
  const router = useRouter();
  const { group, currentUserId } = useDataCache();
  const { rows, toggleToTry } = useReplyItems(group?.id, text, currentUserId);
  const rowMenu = useRowMenuSheet();
  if (!rows.length) return null;
  const menuFor = (row: ReplyItemRow): RowMenu | null => {
    if (row.kind !== 'recipe' || !toggleToTry) return null;
    return {
      title: row.title,
      kind: ITEM_KIND_LABEL[row.kind],
      actions: [
        { id: 'open', label: 'Open', group: 'open', icon: 'open', run: () => router.push(row.href as Href) },
        { id: 'to-try', label: row.toTry ? 'Keep in recipes' : 'Move to To try', group: 'edit', icon: 'move', run: () => toggleToTry(row.id) },
      ],
    };
  };
  return (
    <>
      <ListGroup className="mt-2.5">
        {rows.map((row) => {
          const menu = menuFor(row);
          return (
            <ListItem
              key={row.key}
              className="items-center gap-3"
              onPress={() => router.push(row.href as Href)}
              onLongPress={menu ? () => rowMenu.open(menu) : undefined}
              accessibilityRole="link"
              accessibilityLabel={row.meta ? `${row.title}, ${row.meta}` : row.title}
            >
              <LeadingTile sectionId={row.module} Icon={sectionIconFor(row.module)} size="md" />
              <ListItemContent>
                <ListItemTitle numberOfLines={1}>{row.title}</ListItemTitle>
                {row.meta ? (
                  <ListItemMeta>
                    <Text className={cn('text-caption tabular-nums', row.good ? 'text-success' : 'text-muted-foreground')}>{row.meta}</Text>
                  </ListItemMeta>
                ) : null}
              </ListItemContent>
              <ListItemTrailing className="mt-0">
                <ChevronRight size={16} className="text-muted-foreground" />
              </ListItemTrailing>
            </ListItem>
          );
        })}
      </ListGroup>
      {rowMenu.sheet}
    </>
  );
}

/** The `@` suggestions over the composer: tap one to put the tag in. */
function MentionChips({ options, onPick }: { options: MentionOption[]; onPick: (option: MentionOption) => void }) {
  return (
    <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-1 pb-1.5 pt-0.5">
      {options.map((o) => (
        <Pressable
          key={o.userId ?? o.name}
          onPress={() => onPick(o)}
          accessibilityRole="button"
          accessibilityLabel={o.kind === 'rooftap' ? 'Tag Rooftap to ask it' : `Tag ${o.name}`}
          hitSlop={{ top: 8, bottom: 8 }}
          className="h-9 flex-row items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 active:bg-muted"
        >
          {o.kind === 'rooftap' ? <Sparkles size={14} className="text-foreground" /> : <AtSign size={14} className="text-muted-foreground" />}
          <Text className="text-sm font-medium text-foreground">{o.name}</Text>
          {o.kind === 'rooftap' && <Text className="text-xs text-muted-foreground">ask it</Text>}
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function Composer({
  placeholder,
  disabled,
  busy,
  autoFocus,
  maxLength = 4000,
  photos: allowPhotos = false,
  mentions,
  onSend,
}: {
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  /** Offer to attach photos, when the household's model can look at them. */
  photos?: boolean;
  /** Who `@` offers to tag (the household thread): Rooftap and the other members. */
  mentions?: MentionOption[];
  onSend: (text: string, photos: OutgoingPhoto[]) => Promise<boolean> | boolean;
}) {
  const [text, setText] = React.useState('');
  // Where the caret is, for the `@` suggestions; `place` moves it once after a pick.
  const [caret, setCaret] = React.useState(0);
  const [place, setPlace] = React.useState<{ start: number; end: number } | undefined>();
  const draft = mentions ? mentionAt(text, caret) : null;
  const suggestions = draft && mentions ? suggestMentions(mentions, draft.query) : [];
  const pickMention = (option: MentionOption) => {
    if (!draft) return;
    haptics.select();
    const next = insertMention(text, draft, caret, option);
    setText(next.text);
    setCaret(next.caret);
    setPlace({ start: next.caret, end: next.caret });
  };
  const [choosing, setChoosing] = React.useState(false);
  const tray = useComposerPhotos({
    api: assistantApi,
    supabase: allowPhotos ? getBoundSupabaseClient() ?? null : null,
    onError: (m) => toast.error(m),
  });
  const canSend = !disabled && !busy && !tray.uploading && (!!text.trim() || tray.outgoing.length > 0);

  const submit = async () => {
    const value = text.trim();
    if (!canSend) return;
    const outgoing = tray.outgoing;
    const taken = tray.take();
    setText('');
    if (!(await onSend(value, outgoing))) {
      setText(value);
      tray.restore(taken);
    }
  };

  const pick = async (source: 'camera' | 'library') => {
    try {
      const picked = await pickPhotos(source, MAX_ASSISTANT_PHOTOS - tray.photos.length);
      if (picked.length) tray.add(picked);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open the photos.');
    }
  };

  return (
    <View className={cn('rounded-3xl border border-border/60 bg-card p-1.5', !allowPhotos && 'pl-4')}>
      {tray.photos.length > 0 && (
        <View className="flex-row gap-2 px-2.5 pb-1.5 pt-1">
          {tray.photos.map((p) => (
            <View key={p.key}>
              <Image source={{ uri: p.preview }} style={{ width: 64, height: 64, borderRadius: 12, opacity: !p.path || p.failed ? 0.5 : 1 }} />
              {!p.path && !p.failed && <ActivityIndicator style={{ position: 'absolute', top: 22, left: 22 }} />}
              <Pressable
                onPress={() => tray.remove(p.key)}
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
                hitSlop={8}
                className="absolute -right-1.5 -top-1.5 size-6 items-center justify-center rounded-full bg-foreground"
              >
                <X size={14} className="text-background" />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {suggestions.length > 0 && <MentionChips options={suggestions} onPick={pickMention} />}
      <View className="flex-row items-end gap-2">
        {allowPhotos && (
          <Pressable
            onPress={() => setChoosing(true)}
            disabled={disabled || tray.full}
            accessibilityRole="button"
            accessibilityLabel="Attach a photo"
            className={cn('size-10 items-center justify-center rounded-full', (disabled || tray.full) && 'opacity-40')}
          >
            <ImagePlus size={20} className="text-muted-foreground" />
          </Pressable>
        )}
        <TextInput
          value={text}
          onChangeText={(next) => {
            setText(next);
            // Typing moves the caret with the text; the selection event lands after.
            if (next.length > text.length && caret === text.length) setCaret(next.length);
          }}
          selection={place}
          onSelectionChange={(e) => {
            setCaret(e.nativeEvent.selection.end);
            if (place) setPlace(undefined);
          }}
          multiline
          autoFocus={autoFocus}
          editable={!disabled}
          maxLength={maxLength}
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
      {allowPhotos && <PhotoSourceSheet open={choosing} onOpenChange={setChoosing} onPick={(source) => void pick(source)} />}
    </View>
  );
}
