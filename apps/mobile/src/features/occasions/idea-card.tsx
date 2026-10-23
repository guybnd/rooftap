// Occasions: a gift idea's card, opened by tapping its row (Guy, 2026-10-23:
// "a proper card instead of a clumsy edit menu"; a long press keeps the
// menu). Look A with C's budget meter: the name and price on top, where it's
// at, the occasion's gift budget, then the best price, the budget line, the
// link and notes, and who it's kept from. Every part is edited right where it
// is and saves as it changes (core useGiftIdeaCard); "All details" opens the
// full form for who it's for and the occasion.
// Web twin: apps/web/src/app/occasions/idea-card.tsx.
import * as React from 'react';
import { Linking, Pressable, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUpRight, Gift } from 'lucide-react-native';
import {
  BottomSheet,
  BottomSheetScrollView,
  Button,
  LeadingTile,
  SegmentedControl,
  Switch,
  Text,
  cn,
  useKeyboardOffset,
} from '@homeup/ui';
import {
  GIFT_IDEA_STATUSES,
  JOINT_ACCOUNT_GIFT_WARNING,
  confirmRemoveIdea,
  memberFirstName,
  useGiftIdeaCard,
  type GiftIdea,
  type GroupMember,
  type OccasionsApi,
} from '@homeup/core';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export function IdeaCard({
  ideaId,
  open,
  onOpenChange,
  onEditAll,
  api,
  currentUserId,
  members,
  profiles,
  features,
}: {
  ideaId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The full form, for who it's for and the occasion. */
  onEditAll: (idea: GiftIdea) => void;
  api: OccasionsApi;
  currentUserId: string | null;
  members: GroupMember[];
  profiles: MemberProfiles;
  features: { costs: boolean; shopper: boolean };
}) {
  const card = useGiftIdeaCard({ ideaId, api, currentUserId, memberIds: members.map((m) => m.user_id), profiles, features });
  const { idea, view } = card;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const keyboardOffset = useKeyboardOffset(insets.bottom);
  const bodyStyle = useAnimatedStyle(() => ({ maxHeight: Math.max(240, height * 0.8 - keyboardOffset.value) }));

  // Removed (here or on another device): the card goes too.
  React.useEffect(() => {
    if (!idea && open) onOpenChange(false);
  }, [idea, open, onOpenChange]);
  if (!idea || !view) return null;

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="max-h-[88%]">
      <Animated.View style={bodyStyle}>
        <BottomSheetScrollView
          contentContainerClassName="gap-5 px-5 pb-6 pt-1"
          contentContainerStyle={{ paddingBottom: Math.max(24, insets.bottom + 8) }}
          keyboardShouldPersistTaps="handled"
        >
          {/* E1: the item leads with its section tile; name and price edit in place. */}
          <View className="flex-row items-start gap-3">
            <LeadingTile sectionId="occasions" Icon={Gift} size="lg" />
            <View className="min-w-0 flex-1 gap-0.5">
              <InlineText
                value={idea.title}
                onCommit={card.setTitle}
                accessibilityLabel="Idea"
                className="font-heading text-xl font-semibold"
              />
              {!!view.context && <Text className="px-1 text-[13px] text-muted-foreground">{view.context}</Text>}
            </View>
            <InlineText
              value={idea.price_cents ? String(idea.price_cents / 100) : ''}
              display={view.price ?? undefined}
              onCommit={card.setPrice}
              placeholder="Price"
              accessibilityLabel="Price"
              keyboardType="decimal-pad"
              className="w-24 text-right font-heading text-xl font-semibold tabular-nums"
            />
          </View>

          <SegmentedControl options={[...GIFT_IDEA_STATUSES]} value={idea.status} onChange={card.setStatus} accessibilityLabel="Where it's at" />

          {view.meter && (
            <View className="gap-2 rounded-2xl bg-muted/50 p-3.5">
              <View className="flex-row items-baseline justify-between">
                <Text className="text-[13px] font-semibold text-foreground">Gift budget</Text>
                <Text className={cn('text-[13px] tabular-nums', view.meter.over ? 'text-destructive' : 'text-muted-foreground')}>{view.meter.label}</Text>
              </View>
              <View className="h-2 flex-row overflow-hidden rounded-full bg-muted">
                <View className="bg-foreground" style={{ width: `${view.meter.boughtShare * 100}%` }} />
                <View className="bg-foreground/40" style={{ width: `${view.meter.ideaShare * 100}%` }} />
              </View>
              {view.meter.legend.length > 0 && (
                <View className="flex-row gap-3.5">
                  {view.meter.legend.map((l) => (
                    <View key={l.part} className="flex-row items-center gap-1.5">
                      <View className={cn('size-2 rounded-[2px]', l.part === 'bought' ? 'bg-foreground' : 'bg-foreground/40')} />
                      <Text className="text-xs tabular-nums text-muted-foreground">{l.label}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          <View className="border-t border-border">
            {card.hasWant ? (
              <Row label="Best price">
                <View className="items-end">
                  <Text className="text-sm tabular-nums text-foreground">{view.bestPrice}</Text>
                  {!!view.bestHint && <Text className="text-xs text-muted-foreground">{view.bestHint}</Text>}
                </View>
              </Row>
            ) : (
              features.shopper && (
                <Row label="Watch the price" hint="Adds it to Shopper, kept from the same people.">
                  <Button variant="outline" size="sm" onPress={card.watchPrice}>
                    <Text className="text-sm font-medium text-foreground">Watch</Text>
                  </Button>
                </Row>
              )
            )}
            {features.costs && (
              <Row
                label="In the budget"
                hint={!idea.price_cents ? 'Add a price to put it in the budget.' : idea.hidden_from.length ? JOINT_ACCOUNT_GIFT_WARNING : 'A one-off purchase in Costs.'}
              >
                <Switch checked={card.inBudget} onChange={card.setInBudget} label="In the budget" disabled={!idea.price_cents} />
              </Row>
            )}
            <Row label="Link">
              <View className="min-w-0 flex-1 flex-row items-center justify-end gap-1">
                <View className="min-w-0 flex-1">
                  <InlineText
                    value={idea.url ?? ''}
                    onCommit={card.setUrl}
                    placeholder="Add a link"
                    accessibilityLabel="Link"
                    keyboardType="url"
                    className="text-right text-sm"
                  />
                </View>
                {!!idea.url && (
                  <Pressable
                    onPress={() => void Linking.openURL(idea.url!)}
                    accessibilityRole="link"
                    accessibilityLabel="Open link"
                    hitSlop={6}
                    className="size-9 items-center justify-center rounded-lg"
                  >
                    <ArrowUpRight size={18} className="text-primary" />
                  </Pressable>
                )}
              </View>
            </Row>
            {!!view.fromWishlist && (
              <View className="border-b border-border py-3">
                <Text className="text-sm text-muted-foreground">{view.fromWishlist}</Text>
              </View>
            )}
            <View className="gap-1 border-b border-border py-3">
              <Text className="text-sm text-muted-foreground">Notes</Text>
              <InlineText
                multiline
                value={idea.notes ?? ''}
                onCommit={card.setNotes}
                placeholder="Size, colour, where to get it"
                accessibilityLabel="Notes"
                className="text-sm"
              />
            </View>
          </View>

          {card.others.length > 0 && (
            <View className="gap-2">
              <Text className="text-micro-label uppercase text-muted-foreground">Keep it from</Text>
              {card.others.map((userId) => {
                const name = memberFirstName(userId, profiles);
                return (
                  <View key={userId} className="min-h-9 flex-row items-center gap-3">
                    <Text className="min-w-0 flex-1 text-sm text-foreground">Keep it from {name}</Text>
                    <Switch checked={idea.hidden_from.includes(userId)} onChange={(on) => card.keepFrom(userId, on)} label={`Keep it from ${name}`} />
                  </View>
                );
              })}
              {card.hints.map((h) => (
                <Text key={h} className="text-xs text-muted-foreground">
                  {h}
                </Text>
              ))}
            </View>
          )}

          <View className="flex-row items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onPress={() => void confirmRemoveIdea(api, idea)}>
              <Text className="text-sm font-medium text-destructive">Remove idea</Text>
            </Button>
            <Button variant="outline" size="sm" onPress={() => onEditAll(idea)}>
              <Text className="text-sm font-medium text-foreground">All details</Text>
            </Button>
          </View>
        </BottomSheetScrollView>
      </Animated.View>
    </BottomSheet>
  );
}

/** One line of the card: a label on the left, its control on the right, an optional note under. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View className="gap-1 border-b border-border py-3">
      <View className="min-h-9 flex-row items-center gap-3">
        <Text className="shrink-0 text-sm text-muted-foreground">{label}</Text>
        <View className="min-w-0 flex-1 flex-row items-center justify-end">{children}</View>
      </View>
      {!!hint && <Text className="text-xs text-muted-foreground">{hint}</Text>}
    </View>
  );
}

/**
 * Text that edits in place: it reads as plain text, a tap turns it into a
 * field, and it saves when you're done. `onCommit` may return false to keep
 * it open (a price it can't read).
 */
function InlineText({
  value,
  display,
  onCommit,
  placeholder,
  accessibilityLabel,
  className,
  multiline,
  keyboardType,
}: {
  value: string;
  display?: string;
  onCommit: (text: string) => boolean | void;
  placeholder?: string;
  accessibilityLabel: string;
  className?: string;
  multiline?: boolean;
  keyboardType?: 'decimal-pad' | 'url';
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const [bad, setBad] = React.useState(false);
  const shown = draft !== null ? draft : display !== undefined && value ? display : value;

  const commit = () => {
    if (draft === null) return;
    if (onCommit(draft) === false) {
      setBad(true);
      return;
    }
    setBad(false);
    setDraft(null);
  };

  return (
    <TextInput
      accessibilityLabel={accessibilityLabel}
      value={shown}
      placeholder={placeholder}
      multiline={multiline}
      keyboardType={keyboardType}
      autoCapitalize={keyboardType ? 'none' : 'sentences'}
      autoCorrect={!keyboardType}
      blurOnSubmit={!multiline}
      returnKeyType={multiline ? 'default' : 'done'}
      maxLength={multiline ? 300 : keyboardType === 'url' ? 500 : 120}
      onFocus={() => setDraft(value)}
      onChangeText={setDraft}
      onBlur={commit}
      className={cn(
        'min-h-9 rounded-lg px-1 py-1 text-foreground placeholder:text-muted-foreground focus:bg-muted/60',
        bad && 'border border-destructive',
        className,
      )}
    />
  );
}
