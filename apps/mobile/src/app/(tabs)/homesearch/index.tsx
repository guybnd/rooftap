// HOUP-78: native Home Search — apartment discovery/scoring/triage list.
// Faithful-but-focused port of apps/web/src/app/homesearch/page.tsx: loads
// apartments/agents/apartment-agent links/checklist items+responses/
// appointments/comments via Legend-State group stores, derives each
// apartment's checklist `score` through calculateScore() (@homeup/core) plus
// a best-effort preliminary-score average, then renders SavedSearchPicker +
// search/agent/archived/quick-filter controls + ApartmentGrid. Replaces the
// HOUP-81 Phase-2-pending placeholder entirely.
//
// HOUP-208 audit: deliberately NOT migrated to FlashList — see
// @/features/homesearch/apartment-grid.tsx's own header comment (lines
// 21-29): apartment counts are small (dozens, not thousands), and this
// screen's outer ScrollView (wrapping header + filters + grid as one unit)
// means a nested FlatList/VirtualizedList here would trigger RN's
// "VirtualizedLists should never be nested" warning for no benefit.
//
// Deliberate differences from the web original:
// - Reuses @homeup/core's useFuzzySearch verbatim (promoted off web in
//   HOUP-121; apps/mobile's Tasks/Recipes/Documents screens already use it)
//   instead of a plain substring filter — it's fully platform-agnostic.
// - Drops the "Maps" toggle — the native ApartmentGrid/ApartmentCard already
//   dropped `showMap`/a real map surface pending the sibling ticket HOUP-109
//   (see apartment-card.tsx's own header comment). Quick filters now render
//   through DashboardStats (HOUP-174), a 7-tile stat grid matching web's
//   dashboard-stats.tsx instead of the horizontal Pill row this screen
//   originally shipped with under HOUP-78.
// - Agent filter (HOUP-233): caps the row at 5 + a "+N more" expander like
//   web's agent-filter.tsx, and fills the active pill with the agent's own
//   `color` (white text, identity dot hidden) instead of a neutral primary
//   tint — reversing HOUP-174 item 3's "color stays in the dot only" call,
//   since HOUP-233 cites the already-shipped web component as the parity
//   spec for this exact interaction.
// - `agentFilter` itself is applied inside ApartmentGrid (it already filters
//   by `agentFilter` before sorting/rendering — see its own header comment),
//   so this screen only derives search + archived + quick-filter and hands
//   `agentFilter` straight through, matching the web original's own split
//   (its `filteredApartments` also excludes agent filtering, deferring it to
//   the grid-level render).
// - Header actions (+ Add / Bulk) replace the web nav-item/FAB equivalents —
//   packages/core/src/sections.ts's homeSearchNavItems already registers
//   "Add Listing" -> /apartment/new and "Bulk Upload" -> /apartment/bulk;
//   no registry change needed since sections.ts is platform-neutral.
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { use$ } from '@legendapp/state/react';
import {
  Archive,
  Bookmark,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  Eye,
  Plus,
  RotateCcw,
  SkipForward,
  Upload,
} from 'lucide-react-native';
import { Text, Button, HeroLede, Pill, ScreenBackground, SectionSearchBar, cn } from '@homeup/ui';
import {
  agents$,
  apartmentAgents$,
  apartmentChecklistItems$,
  apartmentChecklistResponses$,
  apartmentComments$,
  apartments$,
  appointments$,
  calculateScore,
  createdAtSortValue,
  useReconnectSync,
  useStoreLoaded,
  type Agent,
  type Apartment,
  type ApartmentAgent,
  type ApartmentComment,
  type ApartmentPreliminaryScore,
  type ApartmentWithScore,
  type Appointment,
  type ChecklistItem,
  type ChecklistResponse,
} from '@homeup/core';
import { useDebounce } from '@homeup/core/src/hooks/use-debounce';
import { useFuzzySearch } from '@homeup/core/src/hooks/use-fuzzy-search';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { ApartmentGrid, SortPicker, type SortOption } from '@/features/homesearch/apartment-grid';
import { SavedSearchPicker } from '@/features/homesearch/saved-search-picker';
import { DashboardStats, type DashboardStatTone } from '@/features/homesearch/dashboard-stats';
import { InvitationBanner } from '@/features/settings/panels/invitation-banner';

type QuickFilter = 'all' | 'has-appointment' | 'to-book' | 'viewed' | 'needs-score' | 'skipped' | 'rebook';

// Hearth v2 pass (H1/H2): no All tile (the Hero counts the listings in play;
// "all" is the unfiltered list, reached by tapping the active tile again).
// Coral marks only the active tile; Rebook's value is the one status tint.
// Mirrors apps/web/src/components/dashboard-stats.tsx.
const QUICK_FILTERS: { key: Exclude<QuickFilter, 'all'>; label: string; icon: typeof Bookmark; tone?: DashboardStatTone }[] = [
  { key: 'to-book', label: 'To book', icon: Bookmark },
  { key: 'has-appointment', label: 'Booked', icon: CalendarDays },
  { key: 'viewed', label: 'Visited', icon: Eye },
  { key: 'rebook', label: 'Rebook', icon: RotateCcw, tone: 'warning' },
  { key: 'needs-score', label: 'To score', icon: ClipboardCheck },
  { key: 'skipped', label: 'Skipped', icon: SkipForward },
];

export default function HomeSearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group, preliminaryScores, currentUserId, userSettings, loading: cacheLoading } = useDataCache();

  const apts$ = apartments$(group?.id);
  const agentsStore$ = agents$(group?.id);
  const apartmentAgentsStore$ = apartmentAgents$(group?.id);
  const checklistItemsStore$ = apartmentChecklistItems$(group?.id);
  const checklistResponsesStore$ = apartmentChecklistResponses$(group?.id);
  const appointmentsStore$ = appointments$(group?.id);
  const commentsStore$ = apartmentComments$(group?.id);
  useReconnectSync(apts$);
  useReconnectSync(agentsStore$);
  useReconnectSync(apartmentAgentsStore$);
  useReconnectSync(checklistItemsStore$);
  useReconnectSync(checklistResponsesStore$);
  useReconnectSync(appointmentsStore$);
  useReconnectSync(commentsStore$);

  const rawApartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );
  const apartmentAgents = use$(() =>
    Object.values(apartmentAgentsStore$.get() ?? {}).filter((aa): aa is ApartmentAgent => !!aa && !aa.deleted)
  );
  const checklistItems = use$(() =>
    Object.values(checklistItemsStore$.get() ?? {}).filter((i): i is ChecklistItem => !!i && !i.deleted)
  );
  const responses = use$(() =>
    Object.values(checklistResponsesStore$.get() ?? {}).filter((r): r is ChecklistResponse => !!r && !r.deleted)
  );
  const appointments = use$(() =>
    Object.values(appointmentsStore$.get() ?? {}).filter((a): a is Appointment => !!a && !a.deleted)
  );
  const commentRows = use$(() =>
    Object.values(commentsStore$.get() ?? {}).filter((c): c is ApartmentComment => !!c && !c.deleted)
  );

  const storeLoaded = useStoreLoaded(
    apts$,
    agentsStore$,
    apartmentAgentsStore$,
    checklistItemsStore$,
    checklistResponsesStore$,
    appointmentsStore$,
    commentsStore$
  );
  const loading = cacheLoading || (!storeLoaded && rawApartments.length === 0);

  // Mirrors data-cache.tsx's former loadFromOfflineStore/fetchAll `counts`/
  // `latest[...]` reducers: total count + most-recent-first top 3, per apartment.
  const { commentCounts, latestComments } = React.useMemo(() => {
    const counts: Record<string, number> = {};
    const byApartment = new Map<string, ApartmentComment[]>();
    for (const c of commentRows) {
      counts[c.apartment_id] = (counts[c.apartment_id] ?? 0) + 1;
      const list = byApartment.get(c.apartment_id) ?? [];
      list.push(c);
      byApartment.set(c.apartment_id, list);
    }
    const latest: Record<string, { content: string; user_id: string; created_at: string }[]> = {};
    for (const [apartmentId, list] of byApartment) {
      latest[apartmentId] = list
        .slice()
        .sort((a, b) => createdAtSortValue(b.created_at) - createdAtSortValue(a.created_at))
        .slice(0, 3)
        .map((c) => ({ content: c.content, user_id: c.user_id, created_at: c.created_at }));
    }
    return { commentCounts: counts, latestComments: latest };
  }, [commentRows]);

  // Derive score/preliminary fields the same way the web original does.
  const apartments = React.useMemo<ApartmentWithScore[]>(() => {
    const responsesByApartment = new Map<string, Record<string, boolean | null>>();
    for (const r of responses) {
      if (!responsesByApartment.has(r.apartment_id)) responsesByApartment.set(r.apartment_id, {});
      responsesByApartment.get(r.apartment_id)![r.checklist_item_id] = r.value;
    }
    const prelimByApartment = new Map<string, ApartmentPreliminaryScore[]>();
    for (const ps of preliminaryScores) {
      const list = prelimByApartment.get(ps.apartment_id) ?? [];
      list.push(ps);
      prelimByApartment.set(ps.apartment_id, list);
    }
    return rawApartments.map((apt) => {
      const resp = responsesByApartment.get(apt.id) ?? {};
      const hasResponses = Object.keys(resp).length > 0;
      const aptPrelimScores = prelimByApartment.get(apt.id) ?? [];
      const prelimAvg =
        aptPrelimScores.length > 0
          ? aptPrelimScores.reduce((sum, s) => sum + s.score, 0) / aptPrelimScores.length
          : null;
      return {
        ...apt,
        score: hasResponses ? calculateScore(checklistItems, resp) : null,
        preliminaryScores: aptPrelimScores,
        preliminaryAvg: prelimAvg,
      };
    });
  }, [rawApartments, checklistItems, responses, preliminaryScores]);

  const [search, setSearch] = React.useState('');
  const [agentFilter, setAgentFilter] = React.useState<string[]>([]);
  const [agentsExpanded, setAgentsExpanded] = React.useState(false);
  const [showArchived, setShowArchived] = React.useState(false);
  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>('all');
  const debouncedSearch = useDebounce(search, 300);

  const appointmentsByApartment = React.useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const list = map.get(a.apartment_id) ?? [];
      list.push(a);
      map.set(a.apartment_id, list);
    }
    return map;
  }, [appointments]);

  // Hide archived only when not searching and the archived toggle is off — a
  // search is a superset and should reach archived apartments too. Gated on
  // the debounced value (matches web page.tsx:129) so toggling this doesn't
  // thrash on every keystroke; the fuzzy search below still runs on the raw
  // `search` value for immediate results-as-you-type.
  const baseApartments = React.useMemo(
    () => (debouncedSearch.trim() || showArchived ? apartments : apartments.filter((a) => !a.archived)),
    [apartments, debouncedSearch, showArchived]
  );

  const searchedApartments = useFuzzySearch(baseApartments, search, ['address', 'suburb', 'notes', 'main_location']);

  const filteredApartments = React.useMemo(() => {
    let list = searchedApartments;
    if (quickFilter === 'has-appointment') {
      list = list.filter((a) => appointmentsByApartment.get(a.id)?.some((ap) => ap.status === 'scheduled'));
    } else if (quickFilter === 'to-book') {
      list = list.filter((a) => a.disposition === 'to_book');
    } else if (quickFilter === 'viewed') {
      list = list.filter((a) => appointmentsByApartment.get(a.id)?.some((ap) => ap.status === 'viewed'));
    } else if (quickFilter === 'skipped') {
      list = list.filter((a) => a.disposition === 'skipped');
    } else if (quickFilter === 'rebook') {
      list = list.filter((a) => a.disposition === 'rebook');
    } else if (quickFilter === 'needs-score') {
      list = list.filter((a) => !preliminaryScores.some((s) => s.apartment_id === a.id && s.user_id === currentUserId));
    }
    return list;
  }, [searchedApartments, quickFilter, appointmentsByApartment, preliminaryScores, currentUserId]);

  const archivedCount = React.useMemo(() => apartments.filter((a) => a.archived).length, [apartments]);

  // Quick-filter chip counts, computed off non-archived apartments — mirrors
  // the web original's DashboardStats (fed `apartments.filter(a => !a.archived)`).
  const statsBase = React.useMemo(() => apartments.filter((a) => !a.archived), [apartments]);
  const quickFilterCounts = React.useMemo<Record<QuickFilter, number>>(
    () => ({
      all: statsBase.length,
      'to-book': statsBase.filter((a) => a.disposition === 'to_book').length,
      'has-appointment': appointments.filter((a) => a.status === 'scheduled').length,
      viewed: appointments.filter((a) => a.status === 'viewed').length,
      skipped: statsBase.filter((a) => a.disposition === 'skipped').length,
      rebook: statsBase.filter((a) => a.disposition === 'rebook').length,
      'needs-score': statsBase.filter((a) => a.score === null && a.preliminaryAvg == null).length,
    }),
    [statsBase, appointments]
  );

  // Hearth v2 (Pulse, H1): the Hero counts the listings still in play, i.e.
  // not archived and not skipped. The quick-filter tiles carry no All tile
  // (it restated this number whenever nothing was skipped), and the grid's
  // count line only shows while a filter narrows the list. Mirrors
  // apps/web/src/app/homesearch/page.tsx.
  const inPlayCount = quickFilterCounts.all - quickFilterCounts.skipped;
  const toBookCount = quickFilterCounts['to-book'];
  const rebookCount = quickFilterCounts.rebook;

  const dashboardStats = React.useMemo(
    () =>
      QUICK_FILTERS.map((f) => ({
        key: f.key,
        icon: f.icon,
        label: f.label,
        value: quickFilterCounts[f.key],
        tone: f.tone,
      })),
    [quickFilterCounts]
  );

  const handleQuickFilterSelect = (key: QuickFilter) => {
    setQuickFilter((prev) => (prev === key ? 'all' : key));
  };

  const [sortBy, setSortBy] = React.useState<SortOption>('newest');

  const sortedAgents = React.useMemo(() => {
    const countMap: Record<string, number> = {};
    for (const aa of apartmentAgents) countMap[aa.agent_id] = (countMap[aa.agent_id] ?? 0) + 1;
    return [...agents].map((a) => ({ ...a, count: countMap[a.id] ?? 0 })).sort((a, b) => b.count - a.count);
  }, [agents, apartmentAgents]);

  const toggleAgent = (id: string) => {
    setAgentFilter((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };

  const isFiltered =
    !!debouncedSearch.trim() || quickFilter !== 'all' || agentFilter.length > 0 || (!showArchived && archivedCount > 0);

  const clearFilters = () => {
    setSearch('');
    setShowArchived(true);
    setQuickFilter('all');
    setAgentFilter([]);
  };

  if (loading) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  return (
    <ScreenBackground>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }}
      >
        <InvitationBanner />
  
        {/* H1: one lede. Hearth v2 (Pulse): the listings in play as a Hero
            number; the screen's name and its actions sit on the label row
            above it. Bulk / Add replace web's Add Listing / Bulk Upload nav
            items (packages/core/src/sections.ts homeSearchNavItems). */}
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-micro-label uppercase text-muted-foreground">Home search</Text>
          <View className="flex-row items-center gap-2">
            <Button variant="outline" size="sm" onPress={() => router.push('/apartment/bulk')}>
              <Upload size={14} className="text-foreground" />
              <Text className="text-sm font-medium text-foreground">Bulk</Text>
            </Button>
            <Button size="sm" onPress={() => router.push('/apartment/new')}>
              <Plus size={14} className="text-primary-foreground" />
              <Text className="text-sm font-medium text-primary-foreground">Add</Text>
            </Button>
          </View>
        </View>
        <HeroLede
          value={inPlayCount}
          label="in play"
          caption={
            rebookCount > 0 || toBookCount > 0 ? (
              <>
                {rebookCount > 0 && <Text className="text-caption text-warning">{rebookCount} to rebook</Text>}
                {rebookCount > 0 && toBookCount > 0 && ' · '}
                {toBookCount > 0 && `${toBookCount} to book`}
              </>
            ) : undefined
          }
        />
        {/* Saved searches sit under the lede: the label row has no room for
            them beside Bulk / Add on a phone (web sets them beside the Hero). */}
        <View className="items-start">
          <SavedSearchPicker />
        </View>

        {apartments.length > 0 && (
          <View className="gap-3">
            {/* HOUP-174 (item 4): Archived moved into the search row as a
                trailing pill instead of its own stacked row below the quick
                filters. */}
            {/* Quick filters sit right under the lede (web order); the
                search row then carries Archived and the sort picker (H5:
                list controls live together, as on web). */}
            <DashboardStats stats={dashboardStats} activeKey={quickFilter} onSelect={handleQuickFilterSelect} />

            <View className="flex-row items-center gap-2">
              <SectionSearchBar value={search} onChange={setSearch} placeholder="Search apartments…" className="flex-1" />
              {archivedCount > 0 && (
                <Pressable
                  onPress={() => setShowArchived((v) => !v)}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={`Show archived, ${archivedCount}`}
                  accessibilityState={{ selected: showArchived }}
                  className={cn(
                    'h-9 flex-row items-center gap-1.5 rounded-lg border px-2.5',
                    showArchived ? 'border-primary/30 bg-primary/10' : 'border-transparent bg-muted/40'
                  )}
                >
                  <Archive size={14} className={showArchived ? 'text-primary' : 'text-muted-foreground'} />
                  <Text
                    className={cn('text-xs font-medium tabular-nums', showArchived ? 'text-primary' : 'text-muted-foreground')}
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {archivedCount}
                  </Text>
                </Pressable>
              )}
              <SortPicker value={sortBy} onChange={setSortBy} />
            </View>

            {sortedAgents.length > 0 && (() => {
              const hiddenAgentCount = sortedAgents.length - 5;
              const visibleAgents = agentsExpanded ? sortedAgents : sortedAgents.slice(0, 5);

              const pills = (
                <>
                  {visibleAgents.map((agent) => {
                    const active = agentFilter.includes(agent.id);
                    return (
                      // HOUP-233: active pill fills with the agent's own
                      // `color` (white text, identity dot hidden) instead of
                      // a neutral primary tint — parity with web's
                      // agent-filter.tsx:48-104, which this ticket cites as
                      // the spec. Intentionally reverses HOUP-174 item 3.
                      <Pressable key={agent.id} onPress={() => toggleAgent(agent.id)} hitSlop={8}>
                        <Pill
                          variant="muted"
                          className="h-9 gap-1.5 rounded-lg px-3"
                          style={active ? { backgroundColor: agent.color, borderColor: 'transparent' } : undefined}
                        >
                          <View
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: agent.color, opacity: active ? 0 : 1 }}
                          />
                          <Text className={cn('text-xs font-medium', active ? 'text-white' : 'text-muted-foreground')}>
                            {agent.name}
                          </Text>
                          {agent.count > 0 && (
                            <Text
                              className={cn('text-xs tabular-nums', active ? 'text-white/70' : 'text-muted-foreground/60')}
                              style={{ fontVariant: ['tabular-nums'] }}
                            >
                              {agent.count}
                            </Text>
                          )}
                        </Pill>
                      </Pressable>
                    );
                  })}
                  {!agentsExpanded && hiddenAgentCount > 0 && (
                    <Pressable onPress={() => setAgentsExpanded(true)} hitSlop={8}>
                      <Pill variant="muted" className="h-9 gap-1 rounded-lg px-2.5">
                        <Text className="text-xs font-medium text-muted-foreground">+{hiddenAgentCount} more</Text>
                        <ChevronDown size={12} className="text-muted-foreground" />
                      </Pill>
                    </Pressable>
                  )}
                  {agentFilter.length > 0 && (
                    <Pressable onPress={() => setAgentFilter([])} hitSlop={8} className="h-9 justify-center px-2">
                      <Text className="text-xs font-medium text-muted-foreground">Clear</Text>
                    </Pressable>
                  )}
                </>
              );

              // Expanded state wraps in a plain View (flex-wrap) instead of a
              // ScrollView — nesting a same-axis ScrollView inside the
              // screen's outer vertical ScrollView fights it for the scroll
              // gesture.
              return agentsExpanded ? (
                <View className="flex-row flex-wrap items-center gap-1.5">{pills}</View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="items-center gap-1.5 pr-4">
                  {pills}
                </ScrollView>
              );
            })()}
          </View>
        )}
  
        <ApartmentGrid
          apartments={filteredApartments}
          agents={agents}
          apartmentAgents={apartmentAgents}
          commentCounts={commentCounts}
          latestComments={latestComments}
          rentMin={userSettings?.rent_min}
          rentMax={userSettings?.rent_max}
          agentFilter={agentFilter}
          isFiltered={isFiltered}
          narrowed={!!debouncedSearch.trim() || quickFilter !== 'all' || agentFilter.length > 0}
          sortBy={sortBy}
          onClearFilters={clearFilters}
        />
      </ScrollView>
    </ScreenBackground>
  );
}
