// Occasions: birthdays, anniversaries and other days, the gift ideas for
// them, and everyone's wishlists. The lede is the next day coming up (H1);
// under it, the ideas for the occasion in focus, then every occasion, then
// the wishlists. A gift kept from someone never reaches their device (the
// database drops it), so on their own day a member sees only their wishlist.
// Web twin: apps/web/src/app/occasions/page.tsx.
import * as React from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, Gift, Plus, WifiOff } from 'lucide-react-native';
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
  useRowMenuSheet,
} from '@homeup/ui';
import {
  MOTION_DURATIONS_MS,
  OCCASIONS_PREVIEW,
  confirmRemoveIdea,
  formatMoney,
  giftIdeaRowMenu,
  ideaRowMeta,
  memberFirstName,
  occasionFocusView,
  occasionSubtitle,
  occasionTitle,
  occasionWhenLabel,
  setIdeaStatus,
  takenBy,
  useListPreviews,
  useModules,
  useOccasions,
  useOccasionsScreen,
  wishMeta,
  wishTakenLabel,
  type GiftIdea,
  type Occasion,
  type OccasionsApi,
  type WishlistItem,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { IdeaCard } from '@/features/occasions/idea-card';
import { IdeaFormSheet } from '@/features/occasions/idea-form-sheet';
import { OccasionFormSheet } from '@/features/occasions/occasion-form-sheet';
import { WishFormSheet } from '@/features/occasions/wish-form-sheet';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;
type Previews = ReturnType<typeof useListPreviews>;

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
  const { today, focus, setFocusId, mine, othersLists, lede, empty } = useOccasionsScreen(api, currentUserId);

  const occasionSheet = useSheetState<{ id: string | null }>();
  const ideaSheet = useSheetState<{ id: string | null; occasionId: string | null }>();
  const wishSheet = useSheetState<{ id: string | null }>();
  const ideaCard = useSheetState<{ id: string }>();
  const rowMenu = useRowMenuSheet();
  const previews = useListPreviews();

  if (cacheLoading || (!api.loaded && api.occasions.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }
  if (!group || !currentUserId) return <NoGroupScreen />;

  const editingOccasion = occasionSheet.value?.id ? api.occasionById.get(occasionSheet.value.id) : undefined;
  const editingIdea = ideaSheet.value?.id ? api.ideas.find((i) => i.id === ideaSheet.value?.id) : undefined;
  const ideaOccasion = ideaSheet.value?.occasionId ? api.occasionById.get(ideaSheet.value.occasionId) ?? null : null;
  const occasionRows = previews.rows('occasions', api.occasions, OCCASIONS_PREVIEW.occasions);
  const mineRows = previews.rows('mine', mine, OCCASIONS_PREVIEW.wishes);
  const editingWish = wishSheet.value?.id ? api.wishlist.find((w) => w.id === wishSheet.value?.id) : undefined;

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
                onOpenIdea={(idea) => ideaCard.show({ id: idea.id })}
                onHoldIdea={(idea) =>
                  rowMenu.open(
                    giftIdeaRowMenu(idea, {
                      onOpen: () => ideaCard.show({ id: idea.id }),
                      onOpenLink: (url) => void Linking.openURL(url),
                      onStatus: (status) => setIdeaStatus(api, idea, status),
                      onEdit: () => ideaSheet.show({ id: idea.id, occasionId: idea.occasion_id }),
                      onRemove: () => void confirmRemoveIdea(api, idea),
                    }),
                  )
                }
                previews={previews}
              />
            )}

            {api.occasions.length > 0 && (
              <View className="gap-1.5">
                <Text className="px-1 text-micro-label uppercase text-muted-foreground">Occasions</Text>
                <ListGroup>
                  {occasionRows.shown.map((o) => (
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
                  <ShowAllRow rows={occasionRows} onToggle={() => previews.toggle('occasions')} />
                </ListGroup>
              </View>
            )}

            <View className="gap-1.5">
              <View className="flex-row items-baseline justify-between gap-2 px-1">
                <Text className="text-micro-label uppercase text-muted-foreground">My wishlist</Text>
                <Text className="text-[11px] text-muted-foreground">Everyone can see this</Text>
              </View>
              <ListGroup>
                {mineRows.shown.map((w) => (
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
                <ShowAllRow rows={mineRows} onToggle={() => previews.toggle('mine')} />
                <ListItem onPress={() => wishSheet.show({ id: null })} accessibilityRole="button">
                  <Plus size={18} className="shrink-0 text-primary" />
                  <ListItemContent>
                    <ListItemTitle className="text-primary">{mine.length ? 'Add to your wishlist' : 'Start your wishlist'}</ListItemTitle>
                  </ListItemContent>
                </ListItem>
              </ListGroup>
            </View>

            {othersLists.map(([userId, items]) => (
              <OtherWishlist key={userId} userId={userId} items={items} api={api} me={currentUserId} profiles={memberProfiles} previews={previews} />
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
          calendar={modules.feature('calendar.occasions') && modules.server('occasions.calendar')}
        />
      )}

      {ideaCard.value && (
        <IdeaCard
          key={ideaCard.value.id}
          ideaId={ideaCard.value.id}
          open={ideaCard.open}
          onOpenChange={(open) => !open && ideaCard.hide()}
          onEditAll={(idea) => {
            ideaCard.hide();
            ideaSheet.show({ id: idea.id, occasionId: idea.occasion_id });
          }}
          api={api}
          currentUserId={currentUserId}
          members={groupMembers}
          profiles={memberProfiles}
          features={features}
        />
      )}

      {rowMenu.sheet}

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
  onHoldIdea,
  previews,
}: {
  occasion: Occasion;
  api: OccasionsApi;
  me: string;
  profiles: MemberProfiles;
  onEditOccasion: () => void;
  onAddIdea: () => void;
  onOpenIdea: (idea: GiftIdea) => void;
  /** A long press: the row menu, with Edit. */
  onHoldIdea: (idea: GiftIdea) => void;
  previews: Previews;
}) {
  const { own, ideas, allKept, heading, head } = occasionFocusView(occasion, api.ideas, me, profiles);
  const ideaRows = previews.rows(`ideas:${occasion.id}`, ideas, OCCASIONS_PREVIEW.ideas);

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center justify-between gap-2 px-1">
        <Text numberOfLines={1} className="shrink text-micro-label uppercase text-muted-foreground">
          {heading}
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
          {ideaRows.shown.map((idea) => (
            <ListItem key={idea.id} onPress={() => onOpenIdea(idea)} onLongPress={() => onHoldIdea(idea)} accessibilityRole="button">
              <ListItemContent>
                <ListItemTitle numberOfLines={1}>{idea.title}</ListItemTitle>
                <ListItemMeta>
                  <Text numberOfLines={1} className="text-caption text-muted-foreground">
                    {ideaRowMeta(idea, occasion, profiles, allKept)}
                  </Text>
                </ListItemMeta>
              </ListItemContent>
            </ListItem>
          ))}
          <ShowAllRow rows={ideaRows} onToggle={() => previews.toggle(`ideas:${occasion.id}`)} />
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

/** The fold under a long list: "Show 3 more", then "Show less". */
function ShowAllRow({ rows, onToggle }: { rows: { more: number; open: boolean; foldable: boolean }; onToggle: () => void }) {
  if (!rows.foldable) return null;
  return (
    <ListItem onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: rows.open }}>
      <ChevronDown size={18} className="shrink-0 text-primary" style={rows.open ? { transform: [{ rotate: '180deg' }] } : undefined} />
      <ListItemContent>
        <ListItemTitle className="text-primary">{rows.open ? 'Show less' : `Show ${rows.more} more`}</ListItemTitle>
      </ListItemContent>
    </ListItem>
  );
}

/** Another member's wishlist, with "I'll get this" on each wish nobody has taken. */
function OtherWishlist({
  userId,
  items,
  api,
  me,
  profiles,
  previews,
}: {
  userId: string;
  items: WishlistItem[];
  api: OccasionsApi;
  me: string;
  profiles: MemberProfiles;
  previews: Previews;
}) {
  const name = memberFirstName(userId, profiles);
  const rows = previews.rows(`wishes:${userId}`, items, OCCASIONS_PREVIEW.wishes);
  return (
    <View className="gap-1.5">
      <Text className="px-1 text-micro-label uppercase text-muted-foreground">{name}&apos;s wishlist</Text>
      <ListGroup>
        {rows.shown.map((w) => {
          const taken = takenBy(w, api.ideas);
          const meta = wishMeta(w);
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
                  {wishTakenLabel(taken, me, profiles)}
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
        <ShowAllRow rows={rows} onToggle={() => previews.toggle(`wishes:${userId}`)} />
      </ListGroup>
      <Text className="px-1 text-[11px] text-muted-foreground">{name} won&apos;t see who is getting what.</Text>
    </View>
  );
}
