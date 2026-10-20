// HOUP-78: native port of apps/web/src/components/apartment-grid.tsx — the
// sortable/filterable list of `ApartmentCard`s for the Home Search section.
//
// Deliberate differences from the web original:
// - Prop rename `initialApartments` -> `apartments`, and its own Supabase
//   realtime `postgres_changes` subscription is dropped entirely. Web needed
//   both because its page passes server-rendered `initialApartments` as a
//   static snapshot and then has to patch it live itself. Native's parent
//   screen already reads `apartments$` (a Legend-State store kept live via
//   `useReconnectSync`) through a `use$` selector, so whatever it hands down
//   here is already reactive — a second realtime channel would just be a
//   redundant, unsynchronized copy of the same data.
// - Sort picker: web's `SortDropdown` is a DOM popover with a `document`
//   "mousedown" outside-click listener and arrow-key nav. Native has no
//   `document`; per the established convention (see
//   `apartment-picker.tsx`/`saved-search-picker.tsx`'s own rationale
//   comments), the trigger opens a `BottomSheet` instead — its backdrop
//   press + Android hardware-back already give "dismiss without picking"
//   for free — with `ListItem` rows and a check mark on the active option,
//   mirroring `saved-search-picker.tsx`'s exact idiom.
// - Rendering: a plain `.map()` into a `View className="gap-3"`, not a
//   `FlatList`. RN has no CSS grid, and — per
//   apps/mobile/src/app/(tabs)/setup/index.tsx, the screen-composition pattern this
//   will slot into — the eventual `homesearch/index.tsx` route almost
//   certainly wraps header + filters + grid together in ONE `ScrollView` (to
//   scroll them as a unit), so a nested `FlatList`/`VirtualizedList` in here
//   would just trigger RN's "VirtualizedLists should never be nested inside
//   plain ScrollViews" warning for no benefit — apartment counts here are
//   small (dozens, not thousands), so virtualization isn't needed anyway.
// - Drops the web-only "mobile FAB" (a CSS-media-query-gated floating
//   `+` button, `md:hidden`) — that was a workaround for web's single
//   responsive layout serving both desktop and mobile browsers. Native gets
//   its own proper add-apartment entry point from the route's header/nav,
//   not from inside this grid component. The *empty-state* "Add Apartment"
//   button is a different, non-FAB element (shown only when there are zero
//   apartments at all) and is kept, just via `router.push` instead of `Link`.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowUpDown, Check, Plus, Search } from 'lucide-react-native';
import { Text, BottomSheet, EmptyState, ListItem, ListItemContent, ListItemTitle } from '@homeup/ui';
import { createdAtSortValue, type Agent, type ApartmentAgent, type ApartmentComment, type ApartmentWithScore } from '@homeup/core';
import { ApartmentCard } from './apartment-card';

export type SortOption = 'newest' | 'prelim' | 'score' | 'rent-asc' | 'rent-desc';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'prelim', label: 'Prelim score' },
  { value: 'score', label: 'Checklist score' },
  { value: 'rent-asc', label: 'Rent (low → high)' },
  { value: 'rent-desc', label: 'Rent (high → low)' },
];

export function SortPicker({ value, onChange }: { value: SortOption; onChange: (v: SortOption) => void }) {
  const [open, setOpen] = React.useState(false);
  const current = SORT_OPTIONS.find((o) => o.value === value)!;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${current.label}`}
        className="h-9 shrink-0 flex-row items-center gap-1.5 rounded-lg bg-muted/40 px-3 active:bg-muted/60"
      >
        <ArrowUpDown size={14} className="text-muted-foreground" />
        <Text numberOfLines={1} className="text-sm font-medium text-muted-foreground">{current.label}</Text>
      </Pressable>

      <BottomSheet open={open} onOpenChange={setOpen}>
        <View className="px-2 pb-2">
          <Text className="px-2 py-1 text-micro-label uppercase text-muted-foreground">Sort by</Text>
          {SORT_OPTIONS.map((opt) => (
            <ListItem
              key={opt.value}
              onPress={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <ListItemContent>
                <ListItemTitle className={opt.value === value ? 'text-primary' : undefined}>{opt.label}</ListItemTitle>
              </ListItemContent>
              {opt.value === value && <Check size={16} className="text-primary" />}
            </ListItem>
          ))}
        </View>
      </BottomSheet>
    </>
  );
}

export interface ApartmentGridProps {
  apartments: ApartmentWithScore[];
  agents?: Agent[];
  apartmentAgents?: ApartmentAgent[];
  commentCounts?: Record<string, number>;
  latestComments?: Record<string, Pick<ApartmentComment, 'content' | 'user_id' | 'created_at'>[]>;
  rentMin?: number | null;
  rentMax?: number | null;
  agentFilter?: string[];
  isFiltered?: boolean;
  /** A search / quick filter / agent filter narrows the list: show "N shown". */
  narrowed?: boolean;
  /** Controlled sort: the screen renders `SortPicker` in its search row (H5). */
  sortBy?: SortOption;
  onClearFilters?: () => void;
}

export function ApartmentGrid({
  apartments,
  agents,
  apartmentAgents,
  commentCounts,
  latestComments,
  rentMin,
  rentMax,
  agentFilter,
  isFiltered,
  narrowed,
  sortBy: controlledSort,
  onClearFilters,
}: ApartmentGridProps) {
  const router = useRouter();
  const [localSort, setLocalSort] = React.useState<SortOption>('newest');
  const sortBy = controlledSort ?? localSort;

  const agentMap = React.useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const apartmentAgentMap = React.useMemo(() => {
    const map = new Map<string, Agent[]>();
    for (const aa of apartmentAgents ?? []) {
      const a = agentMap.get(aa.agent_id);
      if (!a) continue;
      const list = map.get(aa.apartment_id) ?? [];
      list.push(a);
      map.set(aa.apartment_id, list);
    }
    return map;
  }, [apartmentAgents, agentMap]);

  const sorted = React.useMemo(() => {
    let list = [...apartments];
    if (agentFilter?.length) {
      list = list.filter((apt) => {
        const aptAgents = apartmentAgentMap.get(apt.id);
        return aptAgents?.some((a) => agentFilter.includes(a.id));
      });
    }
    switch (sortBy) {
      case 'newest':
        return list.sort((a, b) => createdAtSortValue(b.created_at) - createdAtSortValue(a.created_at));
      case 'prelim':
        return list.sort((a, b) => (b.preliminaryAvg ?? -1) - (a.preliminaryAvg ?? -1));
      case 'score':
        return list.sort((a, b) => (b.score?.percentage ?? -1) - (a.score?.percentage ?? -1));
      case 'rent-asc':
        return list.sort((a, b) => (a.rent_per_week ?? Infinity) - (b.rent_per_week ?? Infinity));
      case 'rent-desc':
        return list.sort((a, b) => (b.rent_per_week ?? 0) - (a.rent_per_week ?? 0));
      default:
        return list;
    }
  }, [apartments, sortBy, agentFilter, apartmentAgentMap]);

  if (apartments.length === 0) {
    if (isFiltered) {
      return (
        <EmptyState
          icon={Search}
          title="No results found"
          description="Try adjusting your search or filters to find what you're looking for."
          action={onClearFilters ? { label: 'Clear filters', onPress: onClearFilters } : undefined}
        />
      );
    }
    return (
      <EmptyState
        icon={Plus}
        title="No apartments yet"
        description="Add your first apartment to start scoring and comparing options."
        action={{
          label: 'Add apartment',
          onPress: () => router.push('/apartment/new'),
          icon: <Plus size={14} className="text-primary-foreground" />,
        }}
      />
    );
  }

  // H1: no standing "N apartments" line (unfiltered it restated the Hero's
  // in-play count); a count only shows while a filter narrows the list.
  return (
    <View className="gap-3">
      {(narrowed || !controlledSort) && (
        <View className="flex-row items-center justify-between">
          {narrowed ? (
            <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {sorted.length} shown
            </Text>
          ) : (
            <View />
          )}
          {!controlledSort && <SortPicker value={sortBy} onChange={setLocalSort} />}
        </View>
      )}

      <View className="gap-3">
        {sorted.map((apartment) => (
          <ApartmentCard
            key={apartment.id}
            apartment={apartment}
            agent={apartment.agent_id ? agentMap.get(apartment.agent_id) : null}
            agents={apartmentAgentMap.get(apartment.id)}
            commentCount={commentCounts?.[apartment.id]}
            latestComments={latestComments?.[apartment.id]}
            rentMin={rentMin}
            rentMax={rentMax}
          />
        ))}
      </View>
    </View>
  );
}
