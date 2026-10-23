// Bin night: which bins go out tonight, and whose turn it is. The Hero is
// the next collection day (H1); under it, tonight's card when it is bin night
// (marking the bins out), the next two weeks as a strip of lid marks, the
// coming collections with whose turn each one is, the council's changes, and
// the bins themselves. "Edit days" opens the setup sheet: typed in, read from
// the council calendar, or from Home Assistant.
// Web twin: apps/web/src/app/bins/page.tsx.
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Pencil, Trash2, Undo2, WifiOff, X } from 'lucide-react-native';
import {
  Button,
  EmptyState,
  HeroLede,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  ScreenBackground,
  Text,
  cn,
  toast,
} from '@homeup/ui';
import {
  MOTION_DURATIONS_MS,
  addDaysISO,
  binCadenceLabel,
  binChangeLabel,
  binCollections,
  binDayLabel,
  binNamesPhrase,
  binShortDate,
  binStripWeeks,
  binTurn,
  dialog,
  todayISO,
  upcomingBinCollections,
  useBins,
  weekdayOfISO,
  type BinCollection,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { BinLidMark, BinLids } from '@/features/bins/bin-lids';
import { BinSetupSheet } from '@/features/bins/setup-sheet';

const DAY_LETTERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

function memberName(userId: string | null, profiles: MemberProfiles): string {
  if (!userId) return 'Nobody';
  const profile = profiles[userId];
  if (!profile) return 'Former member';
  return profile.name || profile.email || 'Member';
}

function MicroLabel({ children }: { children: React.ReactNode }) {
  return <Text className="px-1 text-micro-label uppercase text-muted-foreground">{children}</Text>;
}

export default function BinsScreen() {
  const insets = useSafeAreaInsets();
  const { group, currentUserId, groupMembers, memberProfiles, isOnline, loading: cacheLoading } = useDataCache();
  const bins = useBins(group?.id, currentUserId);
  const today = todayISO();
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [setupMounted, setSetupMounted] = React.useState(false);

  const { streams, changes, plan, night } = bins;
  const upcoming = React.useMemo(() => upcomingBinCollections(streams, changes, today, 6), [streams, changes, today]);
  const stripDays = React.useMemo(() => {
    const weeks = binStripWeeks(today, 2);
    const byDate = new Map(binCollections(streams, changes, today, weeks[1][6]).map((c) => [c.date, c]));
    return weeks.map((week) => week.map((date) => ({ date, collection: byDate.get(date) ?? null })));
  }, [streams, changes, today]);
  const comingChanges = React.useMemo(
    () => changes.filter((c) => (c.moved_to ?? c.on_date) >= today).sort((a, b) => a.on_date.localeCompare(b.on_date)),
    [changes, today],
  );
  const streamName = React.useMemo(() => new Map(streams.map((s) => [s.id, s.name])), [streams]);

  if (cacheLoading || (!bins.loaded && streams.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }
  if (!group) return <NoGroupScreen />;

  const openSetup = () => {
    setSetupMounted(true);
    setSetupOpen(true);
  };
  const closeSetup = (open: boolean) => {
    if (open) return;
    setSetupOpen(false);
    setTimeout(() => setSetupMounted(false), MOTION_DURATIONS_MS.exit);
  };

  const who = (id: string | null) => (id === currentUserId ? 'You' : memberName(id, memberProfiles));
  const turnCaption = (id: string | null) => (id ? (id === currentUserId ? 'your turn' : `${memberName(id, memberProfiles)}'s turn`) : null);

  const collection = night.collection;
  const lede = collection
    ? {
        value: binDayLabel(collection.date, today),
        caption: [
          night.tonight ? `Out tonight: ${binNamesPhrase(collection.streams).toLowerCase()}` : binNamesPhrase(collection.streams),
          turnCaption(night.turn),
        ]
          .filter(Boolean)
          .join(' · '),
      }
    : { value: 'No bins', caption: 'Add your bin days to get a reminder the night before' };

  const markOut = () => {
    if (!collection) return;
    bins.markOut(collection.date);
    toast.message('Bins out', { duration: 4000, action: { label: 'Undo', onPress: () => bins.undoOut() } });
  };

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: 32, gap: 16 }}>
        <View className="flex-row items-center justify-between gap-3">
          <Text numberOfLines={1} className="shrink text-micro-label uppercase text-muted-foreground">
            Bin night
          </Text>
          <View className="shrink-0 flex-row items-center gap-1.5">
            {!isOnline && (
              <View className="flex-row items-center gap-1 pr-0.5">
                <WifiOff size={12} className="shrink-0 text-muted-foreground" />
                <Text className="text-xs text-muted-foreground">Offline</Text>
              </View>
            )}
            {streams.length > 0 && (
              <Button size="sm" variant="secondary" onPress={openSetup}>
                <Pencil size={14} className="text-foreground" />
                <Text className="text-sm font-medium text-foreground">Edit days</Text>
              </Button>
            )}
          </View>
        </View>
        <HeroLede value={lede.value} label={collection ? 'next collection' : undefined} caption={lede.caption} />

        {streams.length === 0 ? (
          <EmptyState
            icon={Trash2}
            title="No bin days yet"
            description="Tell Rooftap which bins go out on which day, or let it read your council's calendar. You get a nudge the night before."
            action={{ label: 'Set up bin night', onPress: openSetup, icon: <Pencil size={14} className="text-primary-foreground" /> }}
          />
        ) : (
          <>
            {collection && night.tonight && (
              <ListGroup>
                <ListItem>
                  <ListItemLeading>
                    <BinLids lids={collection.streams.map((s) => s.lid)} />
                  </ListItemLeading>
                  <ListItemContent>
                    <ListItemTitle numberOfLines={1}>{night.out ? 'Bins are out' : 'Bins out tonight'}</ListItemTitle>
                    <ListItemMeta>
                      <Text numberOfLines={1} className="text-caption text-muted-foreground">
                        {night.out && plan?.out_by ? `${who(plan.out_by)} put them out` : `${binNamesPhrase(collection.streams)}, collected tomorrow`}
                      </Text>
                    </ListItemMeta>
                  </ListItemContent>
                  <ListItemTrailing>
                    {night.out ? (
                      <Button size="sm" variant="ghost" onPress={() => bins.undoOut()}>
                        <Undo2 size={14} className="text-foreground" />
                        <Text className="text-sm font-medium text-foreground">Undo</Text>
                      </Button>
                    ) : (
                      <Button size="sm" onPress={markOut}>
                        <Check size={14} className="text-primary-foreground" />
                        <Text className="text-sm font-medium text-primary-foreground">They're out</Text>
                      </Button>
                    )}
                  </ListItemTrailing>
                </ListItem>
              </ListGroup>
            )}

            <View className="gap-1.5">
              <MicroLabel>Next two weeks</MicroLabel>
              <View className="gap-1 rounded-3xl bg-card p-2">
                {stripDays.map((week, w) => (
                  <View key={w} className="flex-row gap-1">
                    {week.map(({ date, collection: day }) => (
                      <View
                        key={date}
                        accessibilityLabel={day ? `${binShortDate(date)}: ${binNamesPhrase(day.streams)}` : undefined}
                        className={cn('min-h-[54px] flex-1 items-center gap-1 rounded-xl py-1.5', day && 'bg-muted')}
                      >
                        <Text className={cn('text-[11px] text-muted-foreground', day && 'text-foreground', date === today && 'font-semibold text-primary')}>
                          {DAY_LETTERS[weekdayOfISO(date)]}
                        </Text>
                        <Text className="font-mono text-[10px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                          {Number(date.slice(8))}
                        </Text>
                        {day && <BinLids lids={day.streams.map((s) => s.lid)} size="sm" stacked />}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </View>

            <View className="gap-1.5">
              <MicroLabel>Coming up</MicroLabel>
              <ListGroup>
                {upcoming.map((c) => (
                  <CollectionRow key={c.date} collection={c} today={today} turn={binTurn(plan, c.date)} who={who} />
                ))}
              </ListGroup>
            </View>

            {comingChanges.length > 0 && (
              <View className="gap-1.5">
                <MicroLabel>Changes</MicroLabel>
                <ListGroup>
                  {comingChanges.map((c) => (
                    <ListItem key={c.id}>
                      <ListItemContent>
                        <ListItemTitle numberOfLines={1}>
                          {binShortDate(c.on_date)} · {c.stream_id ? streamName.get(c.stream_id) ?? 'Bin' : 'Every bin'}
                        </ListItemTitle>
                        <ListItemMeta>
                          <Text numberOfLines={1} className="text-caption text-muted-foreground">
                            {[binChangeLabel(c), c.note].filter(Boolean).join(' · ')}
                          </Text>
                        </ListItemMeta>
                      </ListItemContent>
                      <ListItemTrailing>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Remove change"
                          hitSlop={8}
                          onPress={async () => {
                            if (await dialog.confirm({ title: 'Remove this change?', message: 'The usual day applies again.', confirmLabel: 'Remove', destructive: true })) bins.removeChange(c.id);
                          }}
                          className="size-9 items-center justify-center rounded-lg"
                        >
                          <X size={16} className="text-muted-foreground" />
                        </Pressable>
                      </ListItemTrailing>
                    </ListItem>
                  ))}
                </ListGroup>
              </View>
            )}

            <View className="gap-1.5">
              <MicroLabel>Your bins</MicroLabel>
              <ListGroup>
                {streams.map((s) => (
                  <ListItem key={s.id} onPress={openSetup} accessibilityRole="button">
                    <ListItemLeading>
                      <BinLidMark lid={s.lid} />
                    </ListItemLeading>
                    <ListItemContent>
                      <ListItemTitle numberOfLines={1}>{s.name}</ListItemTitle>
                      <ListItemMeta>
                        <Text numberOfLines={1} className="text-caption text-muted-foreground">
                          {binCadenceLabel(s)}
                        </Text>
                      </ListItemMeta>
                    </ListItemContent>
                  </ListItem>
                ))}
              </ListGroup>
              {(plan?.rotation.length ?? 0) > 1 && (
                <Text className="px-1 text-xs text-muted-foreground">
                  Taking turns: {plan!.rotation.map((id) => who(id)).join(', then ')}. Reminder at {plan!.remind_at} the night before.
                </Text>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {setupMounted && (
        <BinSetupSheet
          open={setupOpen}
          onOpenChange={closeSetup}
          bins={bins}
          groupMembers={groupMembers}
          memberProfiles={memberProfiles}
          currentUserId={currentUserId}
          today={today}
        />
      )}
    </ScreenBackground>
  );
}

function CollectionRow({ collection, today, turn, who }: { collection: BinCollection; today: string; turn: string | null; who: (id: string | null) => string }) {
  const night = addDaysISO(collection.date, -1);
  const movedFrom = collection.moved[0]?.from ?? null;
  const meta = [turn ? who(turn) : null, movedFrom ? `moved from ${binShortDate(movedFrom)}` : null, collection.notes[0] ?? null]
    .filter(Boolean)
    .join(' · ');
  return (
    <ListItem>
      <ListItemLeading>
        <View className="w-9 items-center">
          <Text className="text-[10px] font-semibold uppercase text-muted-foreground">{DAY_LETTERS[weekdayOfISO(collection.date)]}</Text>
          <Text
            className={cn('font-heading text-base font-bold text-foreground', collection.date === today && 'text-primary')}
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {Number(collection.date.slice(8))}
          </Text>
        </View>
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle numberOfLines={1}>{binNamesPhrase(collection.streams)}</ListItemTitle>
        {meta ? (
          <ListItemMeta>
            <Text numberOfLines={1} className="text-caption text-muted-foreground">
              {meta}
            </Text>
          </ListItemMeta>
        ) : null}
      </ListItemContent>
      <ListItemTrailing>
        <View className="items-end gap-1">
          <Text className="text-xs text-muted-foreground">{night === today ? 'Tonight' : binDayLabel(collection.date, today)}</Text>
          <BinLids lids={collection.streams.map((s) => s.lid)} />
        </View>
      </ListItemTrailing>
    </ListItem>
  );
}
