"use client";

import { useState, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, MapPin, Plus } from "lucide-react";
import { use$ } from "@legendapp/state/react";
import { useDataCache } from "@/lib/data-cache";
import { calculateScore, apartments$, agents$, apartmentAgents$, apartmentChecklistItems$, apartmentChecklistResponses$, appointments$, apartmentComments$, useReconnectSync, useStoreLoaded } from '@homeup/core';
import type { Agent, Apartment, ApartmentAgent, ApartmentComment, Appointment, ApartmentWithScore, ChecklistItem, ChecklistResponse } from '@homeup/core';
import { ApartmentGrid, SortDropdown, type SortOption } from "@/components/apartment-grid";
import { DashboardStats, type QuickFilter } from "@/components/dashboard-stats";
import { AgentFilter } from "@/components/agent-filter";
import { SavedSearchPicker } from "@/components/saved-search-picker";
import { InvitationBanner } from "@/components/invitation-banner";
import { SectionSearchBar } from "@/components/section-search-bar";
import { HeroLede } from "@/components/ui/hero-lede";
import { ModuleSettingsButton } from "@/components/module-settings-sheet";
import { buttonVariants } from "@/components/ui/button";
import { useDebounce } from "@/hooks/use-debounce";
import { useFuzzySearch } from "@/hooks/use-fuzzy-search";
import { cn } from "@/lib/utils";
import HomeSearchLoading from "./loading";

export default function HomeSearchPage() {
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

  // Mirrors data-cache.tsx's former loadFromOfflineStore/fetchAll `counts`/
  // `latest[...]` reducers: total count + most-recent-first top 3, per apartment.
  const { commentCounts, latestComments } = useMemo(() => {
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
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 3)
        .map((c) => ({ content: c.content, user_id: c.user_id, created_at: c.created_at }));
    }
    return { commentCounts: counts, latestComments: latest };
  }, [commentRows]);

  const storeLoaded = useStoreLoaded(apts$, agentsStore$, apartmentAgentsStore$, checklistItemsStore$, checklistResponsesStore$, appointmentsStore$, commentsStore$);
  const loading = cacheLoading || (!storeLoaded && rawApartments.length === 0);

  // Derive score/preliminary fields the same way data-cache.tsx used to —
  // preliminaryScores still comes from useDataCache (preliminary-score
  // migration is a separate slice); checklistItems/responses now come from
  // the Legend apartmentChecklist* stores (FLUX-150 slice 8 prep).
  const apartments = useMemo<ApartmentWithScore[]>(() => {
    const responsesByApartment = new Map<string, Record<string, boolean | null>>();
    for (const r of responses) {
      if (!responsesByApartment.has(r.apartment_id)) responsesByApartment.set(r.apartment_id, {});
      responsesByApartment.get(r.apartment_id)![r.checklist_item_id] = r.value;
    }
    const prelimByApartment = new Map<string, typeof preliminaryScores>();
    for (const ps of preliminaryScores) {
      const list = prelimByApartment.get(ps.apartment_id) ?? [];
      list.push(ps);
      prelimByApartment.set(ps.apartment_id, list);
    }
    return rawApartments.map((apt) => {
      const resp = responsesByApartment.get(apt.id) ?? {};
      const hasResponses = Object.keys(resp).length > 0;
      const aptPrelimScores = prelimByApartment.get(apt.id) ?? [];
      const prelimAvg = aptPrelimScores.length > 0
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

  const searchParams = useSearchParams();
  const router = useRouter();

  const agentFilterParam = searchParams.get("agents");
  const [agentFilter, setAgentFilter] = useState<string[]>(
    agentFilterParam ? agentFilterParam.split(",").filter(Boolean) : []
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showMaps, setShowMaps] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const debouncedSearch = useDebounce(searchQuery, 300);

  const handleAgentFilterChange = (ids: string[]) => {
    setAgentFilter(ids);
    const params = new URLSearchParams(searchParams.toString());
    if (ids.length > 0) {
      params.set("agents", ids.join(","));
    } else {
      params.delete("agents");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const appointmentsByApartment = useMemo(() => {
    const map = new Map<string, typeof appointments>();
    for (const a of appointments) {
      const list = map.get(a.apartment_id) ?? [];
      list.push(a);
      map.set(a.apartment_id, list);
    }
    return map;
  }, [appointments]);

  // Hide archived only when not searching and the archived toggle is off — a
  // search is a superset and should reach archived apartments too (FLUX-110).
  const baseApartments = useMemo(
    () =>
      debouncedSearch.trim() || showArchived
        ? apartments
        : apartments.filter((a) => !a.archived),
    [apartments, debouncedSearch, showArchived]
  );

  // Fuzzy search (FLUX-110) — returns baseApartments unchanged when query empty.
  const searchedApartments = useFuzzySearch(baseApartments, searchQuery, [
    "address",
    "suburb",
    "notes",
    "main_location",
  ]);

  const filteredApartments = useMemo(() => {
    let list = searchedApartments;

    if (quickFilter === "has-appointment") {
      list = list.filter((a) => {
        const appts = appointmentsByApartment.get(a.id);
        return appts?.some((ap) => ap.status === "scheduled");
      });
    } else if (quickFilter === "to-book") {
      list = list.filter((a) => a.disposition === "to_book");
    } else if (quickFilter === "viewed") {
      list = list.filter((a) => {
        const appts = appointmentsByApartment.get(a.id);
        return appts?.some((ap) => ap.status === "viewed");
      });
    } else if (quickFilter === "skipped") {
      list = list.filter((a) => a.disposition === "skipped");
    } else if (quickFilter === "rebook") {
      list = list.filter((a) => a.disposition === "rebook");
    } else if (quickFilter === "needs-score") {
      list = list.filter((a) => {
        const myScore = preliminaryScores.find((s) => s.apartment_id === a.id && s.user_id === currentUserId);
        return !myScore;
      });
    }

    return list;
  }, [searchedApartments, quickFilter, appointmentsByApartment, preliminaryScores, currentUserId]);

  const archivedCount = useMemo(
    () => apartments.filter((a) => a.archived).length,
    [apartments]
  );

  // Hearth v2 (Pulse, H1): the Hero counts the listings still in play, i.e.
  // not archived and not skipped. The quick-filter tiles below carry no
  // Total/All tile (it restated this number whenever nothing was skipped),
  // and the list's own count line only shows while a filter narrows it.
  // Mirrors apps/mobile/src/app/(tabs)/homesearch/index.tsx.
  const lede = useMemo(() => {
    const active = apartments.filter((a) => !a.archived);
    return {
      inPlay: active.filter((a) => a.disposition !== "skipped").length,
      toBook: active.filter((a) => a.disposition === "to_book").length,
      rebook: active.filter((a) => a.disposition === "rebook").length,
    };
  }, [apartments]);

  if (loading) return <HomeSearchLoading />;

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <InvitationBanner />
      {/* Header: title + tagline removed (FLUX-187/190); nav names the section.
          The Hero lede leads; saved searches and Add sit beside it (they
          wrap under it on a phone). Add replaces the old floating "+" (M1:
          no FABs; it sat on top of the tab bar). Mirrors native's head row. */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-3 gap-y-4">
        <HeroLede
          value={lede.inPlay}
          label="in play"
          caption={
            lede.rebook > 0 || lede.toBook > 0 ? (
              <>
                {lede.rebook > 0 && <span className="font-medium text-warning">{lede.rebook} to rebook</span>}
                {lede.rebook > 0 && lede.toBook > 0 && " · "}
                {lede.toBook > 0 && `${lede.toBook} to book`}
              </>
            ) : undefined
          }
        />
        <div className="flex items-center gap-2">
          <ModuleSettingsButton moduleId="search" className="h-10 w-10" />
          <SavedSearchPicker />
          <Link href="/apartment/new" className={cn(buttonVariants(), "h-10 gap-1.5 rounded-xl px-3.5")}>
            <Plus className="h-4 w-4" />
            Add
          </Link>
        </div>
      </div>

      {/* Quick filters (no Total tile: the Hero above already counts) */}
      {apartments.length > 0 && (
        <DashboardStats
          apartments={apartments.filter((a) => !a.archived)}
          appointments={appointments}
          activeFilter={quickFilter}
          onFilterChange={setQuickFilter}
        />
      )}

      {/* Controls bar */}
      <div className="flex flex-col gap-3 mb-6">
        {/* Search + toggles row */}
        <div className="flex items-center gap-2">
          <SectionSearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search apartments..."
          />

          {/* Toggle pills */}
          <button
            type="button"
            onClick={() => setShowMaps(!showMaps)}
            aria-pressed={showMaps}
            aria-label="Show maps"
            className={cn(
              "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors duration-150 shrink-0",
              showMaps
                ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
                : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            <MapPin className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Maps</span>
          </button>

          {archivedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              aria-pressed={showArchived}
              aria-label="Show archived"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors duration-150 shrink-0",
                showArchived
                  ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
                  : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              <Archive className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Archived</span>
              <span className="tabular-nums">{archivedCount}</span>
            </button>
          )}

          <div className="ml-auto shrink-0">
            <SortDropdown value={sortBy} onChange={setSortBy} />
          </div>
        </div>

        {/* Agent filter */}
        {agents.length > 0 && (
          <AgentFilter agents={agents} apartmentAgents={apartmentAgents} value={agentFilter} onChange={handleAgentFilterChange} />
        )}
      </div>

      {/* Grid */}
      <ApartmentGrid
        initialApartments={filteredApartments}
        agents={agents}
        apartmentAgents={apartmentAgents}
        commentCounts={commentCounts}
        latestComments={latestComments}
        rentMin={userSettings?.rent_min}
        rentMax={userSettings?.rent_max}
        showMaps={showMaps}
        agentFilter={agentFilter}
        isFiltered={!!debouncedSearch.trim() || quickFilter !== "all" || (!showArchived && archivedCount > 0)}
        narrowed={!!debouncedSearch.trim() || quickFilter !== "all" || agentFilter.length > 0}
        sortBy={sortBy}
        onClearFilters={() => { setSearchQuery(""); setShowArchived(true); setQuickFilter("all"); }}
      />
    </main>
  );
}
