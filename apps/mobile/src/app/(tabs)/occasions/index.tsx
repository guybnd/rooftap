// Occasions: birthdays, anniversaries and other days, the gift ideas for
// them, and everyone's wishlists. The lede is the next day coming up (H1);
// under it, the ideas for the occasion in focus, then every occasion, then
// the wishlists. A gift kept from someone never reaches their device (the
// database drops it), so on their own day a member sees only their wishlist.
// Web twin: apps/web/src/app/occasions/page.tsx.
import * as React from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gift, Plus, WifiOff } from 'lucide-react-native';
import {
  Button,
  EmptyState,
  HeroLede,
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ScreenBackground,
  Text,
} from '@homeup/ui';
import {
  MOTION_DURATIONS_MS,
  daysBetweenISO,
  formatMoney,
  ideaStatusLine,
  ideasForOccasion,
  isOwnOccasion,
  keptFromLabel,
  memberFirstName,
  nextOccasionDay,
  occasionSpend,
  occasionSubtitle,
  occasionTitle,
  occasionWhenLabel,
  personName,
  takenBy,
  useModules,
  useOccasions,
  weekdayDayMonthLabel,
  type GiftIdea,
  type Occasion,
  type OccasionsApi,
  type WishlistItem,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { IdeaFormSheet } from '@/features/occasions/idea-form-sheet';
import { OccasionFormSheet } from '@/features/occasions/occasion-form-sheet';
import { WishFormSheet } from '@/features/occasions/wish-form-sheet';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

/**
 * One sheet's mount and open state, kept apart so its exit animation can play
 * before it unmounts (HOUP-191). `show` opens it with a value.
 */
function useSheetState<T>() {
  const [value, setValue] = React.useState<T | null>(null);
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = React.useCallback((next: T) => {
    if (timer.current) clearTimeout(timer.current);
    setValue(next);
    setOpen(true);
  }, []);
  const hide = React.useCallback(() => {
    setOpen(false);
    timer.current = setTimeout(() => setValue(null), MOTION_DURATIONS_MS.exit);
  }, []);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { value, open, show, hide };
}

export default function OccasionsScreen() {
  const insets = useSafeAreaInsets();
  const { group, groupMembers, memberProfiles, currentUserId, isOnline, loading: cacheLoading } = useDataCache();
  const modules = useModules();
  const features = React.useMemo(
    () => ({ costs: modules.feature('occasions.costs'), shopper: modules.feature('occasions.shopper') }),
    [modules],
  );
  const api = useOccasions(group?.id, currentUserId, features);
  const { today } = api;

  const [focusId, setFocusId] = React.useState<string | null>(null);
  const occasionSheet = useSheetState<{ id: string | null }>();
  const ideaSheet = useSheetState<{ id: string | null; occasionId: string | null }>();
  const wishSheet = useSheetState<{ id: string | null }>();

  const next = React.useMemo(() => api.occasions.find((o) => nextOccasionDay(o, today)) ?? null, [api.occasions, today]);
  const othersLists = React.useMemo(() => {
    const byUser = new Map<string, WishlistItem[]>();
    for (const w of api.wishlist) {
      if (w.user_id === currentUserId) continue;
      byUser.set(w.user_id, [...(byUser.get(w.user_id) ?? []), w]);
    }
    return [...byUser.entries()];
  }, [api.wishlist, currentUserId]);

  if (cacheLoading || (!api.loaded && api.occasions.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }
  if (!group || !currentUserId) return <NoGroupScreen />;

  const focus = (focusId ? api.occasionById.get(focusId) : null) ?? next ?? api.occasions[0] ?? null;
  const mine = api.wishlist.filter((w) => w.user_id === currentUserId);
  const nextDay = next ? nextOccasionDay(next, today) : null;
  const days = nextDay ? daysBetweenISO(today, nextDay) : null;
  const lede =
    next && nextDay && days !== null
      ? { value: days === 0 ? 'Today' : days, label: days === 0 ? undefined : days === 1 ? 'day' : 'days', caption: `${occasionTitle(next, currentUserId)} · ${weekdayDayMonthLabel(nextDay)}` }
      : { value: api.occasions.length, label: api.occasions.length === 1 ? 'occasion' : 'occasions', caption: 'Nothing coming up' };

  const editingOccasion = occasionSheet.value?.id ? api.occasionById.get(occasionSheet.value.id) : undefined;
  const editingIdea = ideaSheet.value?.id ? api.ideas.find((i) => i.id === ideaSheet.value?.id) : undefined;
  const ideaOccasion = ideaSheet.value?.occasionId ? api.occasionById.get(ideaSheet.value.occasionId) ?? null : null;
  const editingWish = wishSheet.value?.id ? api.wishlist.find((w) => w.id === wishSheet.value?.id) : undefined;
  const empty = api.occasions.length === 0 && api.wishlist.length === 0;

  return (
    <ScreenBackground>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: 32, gap: 16 }}
      >
        <View className="flex-row items-center justify-between gap-3">
          <Text numberOfLines={1} className="shrink text-micro-label uppercase text-muted-foreground">
            Occasions
          </Text>
          <View className="shrink-0 flex-row items-center gap-1.5">
            {!isOnline && (
              <View className="flex-row items-center gap-1 pr-0.5">
                <WifiOff size={12} className="shrink-0 text-muted-foreground" />
                <Text className="text-xs text-muted-foreground">Offline</Text>
              </View>
            )}
            <Button size="sm" onPress={() => occasionSheet.show({ id: null })}>
              <Plus size={14} className="text-primary-foreground" />
              <Text className="text-sm font-medium text-primary-foreground">Add</Text>
            </Button>
          </View>
        </View>
        <HeroLede value={lede.value} label={lede.label} caption={lede.caption} />

        {empty ? (
          <EmptyState
            icon={Gift}
            title="No occasions yet"
            description="Add birthdays and other days to plan gifts for. A gift idea can be kept from the person it's for, so the surprise holds."
            action={{ label: 'Add an occasion', onPress: () => occasionSheet.show({ id: null }), icon: <Plus size={14} className="text-primary-foreground" /> }}
          />
        ) : (
          <>
            {focus && (
              <FocusBlock
                occasion={focus}
                api={api}
                me={currentUserId}
                profiles={memberProfiles}
                onEditOccasion={() => occasionSheet.show({ id: focus.id })}
                onAddIdea={() => ideaSheet.show({ id: null, occasionId: focus.id })}
                onOpenIdea={(idea) => ideaSheet.show({ id: idea.id, occasionId: idea.occasion_id })}
              />
            )}

            {api.occasions.length > 0 && (
              <View className="gap-1.5">
                <Text className="px-1 text-micro-label uppercase text-muted-foreground">Occasions</Text>
                <ListGroup>
                  {api.occasions.map((o) => (
                    <ListItem
                      key={o.id}
                      onPress={() => setFocusId(o.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: focus?.id === o.id }}
                      className={focus?.id === o.id ? 'bg-muted/40' : undefined}
                    >
                      <LeadingTile sectionId="occasions" Icon={Gift} size="md" />
                      <ListItemContent>
                        <ListItemTitle numberOfLines={1}>{occasionTitle(o, currentUserId)}</ListItemTitle>
                        <ListItemMeta>
                          <Text numberOfLines={1} className="text-caption text-muted-foreground">
                            {occasionSubtitle(o, api.ideas, currentUserId, memberProfiles)}
                          </Text>
                        </ListItemMeta>
                      </ListItemContent>
                      <Text className="shrink-0 text-sm tabular-nums text-muted-foreground">{occasionWhenLabel(o, today)}</Text>
                    </ListItem>
                  ))}
                </ListGroup>
              </View>
            )}

            <View className="gap-1.5">
              <View className="flex-row items-baseline justify-between gap-2 px-1">
                <Text className="text-micro-label uppercase text-muted-foreground">My wishlist</Text>
                <Text className="text-[11px] text-muted-foreground">Everyone can see this</Text>
              </View>
              <ListGroup>
                {mine.map((w) => (
                  <ListItem key={w.id} onPress={() => wishSheet.show({ id: w.id })} accessibilityRole="button">
                    <ListItemContent>
                      <ListItemTitle numberOfLines={1}>{w.title}</ListItemTitle>
                      {!!w.notes && (
                        <ListItemMeta>
                          <Text numberOfLines={1} className="text-caption text-muted-foreground">
                            {w.notes}
                          </Text>
                        </ListItemMeta>
                      )}
                    </ListItemContent>
                    {!!w.price_cents && <Text className="shrink-0 text-sm tabular-nums text-muted-foreground">{formatMoney(w.price_cents)}</Text>}
                  </ListItem>
                ))}
                <ListItem onPress={() => wishSheet.show({ id: null })} accessibilityRole="button">
                  <Plus size={18} className="shrink-0 text-primary" />
                  <ListItemContent>
                    <ListItemTitle className="text-primary">{mine.length ? 'Add to your wishlist' : 'Start your wishlist'}</ListItemTitle>
                  </ListItemContent>
                </ListItem>
              </ListGroup>
            </View>

            {othersLists.map(([userId, items]) => (
              <OtherWishlist key={userId} userId={userId} items={items} api={api} me={currentUserId} profiles={memberProfiles} />
            ))}
          </>
        )}
      </ScrollView>

      {occasionSheet.value && (
        <OccasionFormSheet
          key={occasionSheet.value.id ?? 'new'}
          open={occasionSheet.open}
          onOpenChange={(open) => !open && occasionSheet.hide()}
          occasion={editingOccasion}
          api={api}
          groupId={group.id}
          currentUserId={currentUserId}
          members={groupMembers}
          profiles={memberProfiles}
          onSaved={(o) => setFocusId(o.id)}
        />
      )}

      {ideaSheet.value && (
        <IdeaFormSheet
          key={ideaSheet.value.id ?? 'new'}
          open={ideaSheet.open}
          onOpenChange={(open) => !open && ideaSheet.hide()}
          idea={editingIdea}
          occasion={ideaOccasion}
          api={api}
          groupId={group.id}
          currentUserId={currentUserId}
          members={groupMembers}
          profiles={memberProfiles}
          features={features}
        />
      )}

      {wishSheet.value && (
        <WishFormSheet
          key={wishSheet.value.id ?? 'new'}
          open={wishSheet.open}
          onOpenChange={(open) => !open && wishSheet.hide()}
          item={editingWish}
          api={api}
          groupId={group.id}
          currentUserId={currentUserId}
        />
      )}
    </ScreenBackground>
  );
}

/** The occasion in focus: its ideas and budget, or on your own day only a note. */
function FocusBlock({
  occasion,
  api,
  me,
  profiles,
  onEditOccasion,
  onAddIdea,
  onOpenIdea,
}: {
  occasion: Occasion;
  api: OccasionsApi;
  me: string;
  profiles: MemberProfiles;
  onEditOccasion: () => void;
  onAddIdea: () => void;
  onOpenIdea: (idea: GiftIdea) => void;
}) {
  const own = isOwnOccasion(occasion, me);
  const ideas = ideasForOccasion(api.ideas, occasion.id);
  const who = personName({ userId: occasion.person_id, name: occasion.person_name }, profiles);
  // "Kept from Tegan" heads the list when every idea is kept from the person it's for.
  const person = occasion.person_id && occasion.person_id !== me ? occasion.person_id : null;
  const allKept = !!person && ideas.length > 0 && ideas.every((i) => i.hidden_from.includes(person));
  const kept = allKept ? keptFromLabel([person], profiles) : null;
  const { spent } = occasionSpend(ideas);
  const budget = occasion.budget_cents
    ? spent
      ? `${formatMoney(spent)} of ${formatMoney(occasion.budget_cents)}`
      : `${formatMoney(occasion.budget_cents)} budget`
    : null;
  const head = [kept, budget].filter(Boolean).join(' · ');

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center justify-between gap-2 px-1">
        <Text numberOfLines={1} className="shrink text-micro-label uppercase text-muted-foreground">
          {own ? occasionTitle(occasion, me) : who ? `Ideas for ${who}` : occasion.title}
        </Text>
        <Pressable onPress={onEditOccasion} accessibilityRole="button" hitSlop={8} className="min-h-9 justify-center">
          <Text className="text-[12.5px] font-medium text-primary">Edit</Text>
        </Pressable>
      </View>
      {own ? (
        <View className="items-center gap-1 rounded-xl bg-muted/30 px-4 py-6">
          <Gift size={20} className="text-muted-foreground" />
          <Text className="text-center text-sm text-muted-foreground">Nothing to see here. Your wishlist is where you can drop hints.</Text>
        </View>
      ) : (
        <ListGroup>
          {!!head && <Text className="px-3.5 py-2 text-xs text-muted-foreground">{head}</Text>}
          {ideas.map((idea) => (
            <ListItem key={idea.id} onPress={() => onOpenIdea(idea)} accessibilityRole="button">
              <ListItemContent>
                <ListItemTitle numberOfLines={1}>{idea.title}</ListItemTitle>
                <ListItemMeta>
                  <Text numberOfLines={1} className="text-caption text-muted-foreground">
                    {[ideaStatusLine(idea, (c) => formatMoney(c)), forLabel(idea, occasion, profiles), allKept ? null : keptFromLabel(idea.hidden_from, profiles)]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </ListItemMeta>
              </ListItemContent>
            </ListItem>
          ))}
          <ListItem onPress={onAddIdea} accessibilityRole="button">
            <Plus size={18} className="shrink-0 text-primary" />
            <ListItemContent>
              <ListItemTitle className="text-primary">Add a gift idea</ListItemTitle>
            </ListItemContent>
          </ListItem>
        </ListGroup>
      )}
    </View>
  );
}

/** Only when the idea is for someone other than the occasion's person (Christmas lists). */
function forLabel(idea: GiftIdea, occasion: Occasion, profiles: MemberProfiles): string | null {
  if (idea.for_user_id && idea.for_user_id === occasion.person_id) return null;
  const name = personName({ userId: idea.for_user_id, name: idea.for_name }, profiles);
  return name ? `for ${name}` : null;
}

/** Another member's wishlist, with "I'll get this" on each wish nobody has taken. */
function OtherWishlist({
  userId,
  items,
  api,
  me,
  profiles,
}: {
  userId: string;
  items: WishlistItem[];
  api: OccasionsApi;
  me: string;
  profiles: MemberProfiles;
}) {
  const name = memberFirstName(userId, profiles);
  return (
    <View className="gap-1.5">
      <Text className="px-1 text-micro-label uppercase text-muted-foreground">{name}&apos;s wishlist</Text>
      <ListGroup>
        {items.map((w) => {
          const taken = takenBy(w, api.ideas);
          const meta = [w.price_cents ? formatMoney(w.price_cents) : null, w.notes].filter(Boolean).join(' · ');
          return (
            <ListItem
              key={w.id}
              onPress={w.url ? () => void Linking.openURL(w.url!) : undefined}
              accessibilityRole={w.url ? 'link' : undefined}
            >
              <ListItemContent>
                <ListItemTitle numberOfLines={1}>{w.title}</ListItemTitle>
                {!!meta && (
                  <ListItemMeta>
                    <Text numberOfLines={1} className="text-caption text-muted-foreground">
                      {meta}
                    </Text>
                  </ListItemMeta>
                )}
              </ListItemContent>
              {taken ? (
                <Text className="shrink-0 text-xs text-muted-foreground">
                  {taken.created_by === me ? "You're getting it" : `${memberFirstName(taken.created_by ?? '', profiles)} is getting it`}
                </Text>
              ) : (
                <Pressable
                  onPress={() => api.takeWish(w)}
                  accessibilityRole="button"
                  hitSlop={4}
                  className="min-h-9 shrink-0 justify-center rounded-full bg-muted px-3"
                >
                  <Text className="text-[12.5px] font-medium text-foreground">I&apos;ll get this</Text>
                </Pressable>
              )}
            </ListItem>
          );
        })}
      </ListGroup>
      <Text className="px-1 text-[11px] text-muted-foreground">{name} won&apos;t see who is getting what.</Text>
    </View>
  );
}
