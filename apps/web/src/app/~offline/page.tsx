"use client";

import { useLayoutEffect, useState } from "react";
import { use$ } from "@legendapp/state/react";
import { useDataCache } from "@/lib/data-cache";
import { getSectionByPath, apartments$, groceryItems$, householdTasks$, costItems$, setupItems$, groupEvents$, checklists$, recipes$, compareStrings, isSectionEnabled, isTaskOwnerEnabled, syncedGroupId, useModules } from "@homeup/core";
import {
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
} from "@/components/ui/list-item";
import { pickOfflineSummary, type OfflineRow, type OfflineSummary } from "./offline-summary";

function useOfflineSummaries(
  groupId: string | undefined,
  apartments: { id: string; address: string; suburb: string | null }[]
): Record<string, OfflineSummary> {
  // No network calls anywhere below — every read (including the apartments
  // list passed in) is a Legend-State store, IndexedDB-backed and kept warm
  // app-wide by <LegendSyncBootstrap /> in AppSidebar. Reactive selector form
  // per FLUX-149/150 convention.
  // Modules: switched-off modules leave the overview, and a bill or document
  // reminder counts as a task only while its owning module is on.
  const { enabled } = useModules();
  // A switched-off module's store opens with no group id (store-modules.ts), so it isn't synced.
  const syncedGroup = (store$: { collection: string }) => syncedGroupId(store$, groupId, enabled);

  const groceries = use$(() =>
    Object.values(groceryItems$(syncedGroup(groceryItems$)).get() ?? {})
      .filter((i): i is NonNullable<typeof i> => !!i && !i.deleted && i.status === "needed")
      .map((i) => ({ id: i.id, title: i.name, meta: i.aisle }))
  );

  const openTasks = use$(() =>
    Object.values(householdTasks$(syncedGroup(householdTasks$)).get() ?? {}).filter((t): t is NonNullable<typeof t> => !!t && !t.deleted && !t.done)
  );
  const tasks = openTasks
    .filter((t) => isTaskOwnerEnabled(t, enabled))
    .map((t) => ({ id: t.id, title: t.title, meta: t.due_date ?? undefined }));

  const costs = use$(() =>
    Object.values(costItems$(syncedGroup(costItems$)).get() ?? {})
      .filter((c): c is NonNullable<typeof c> => !!c && !c.deleted)
      .map((c) => ({ id: c.id, title: c.name, meta: c.cadence }))
  );

  const setup = use$(() =>
    Object.values(setupItems$(syncedGroup(setupItems$)).get() ?? {})
      .filter((s): s is NonNullable<typeof s> => !!s && !s.deleted && s.status === "needed")
      .map((s) => ({ id: s.id, title: s.name, meta: s.room }))
  );

  const events = use$(() =>
    Object.values(groupEvents$(syncedGroup(groupEvents$)).get() ?? {})
      .filter((e): e is NonNullable<typeof e> => !!e && !e.deleted)
      .sort((a, b) => compareStrings(a.starts_at, b.starts_at))
      .map((e) => ({ id: e.id, title: e.title, meta: new Date(e.starts_at).toLocaleDateString() }))
  );

  const checklistRows = use$(() =>
    Object.values(checklists$(syncedGroup(checklists$)).get() ?? {})
      .filter((c): c is NonNullable<typeof c> => !!c && !c.deleted && !c.completed_at)
      .map((c) => ({ id: c.id, title: c.title, meta: c.type }))
  );

  const recipeRows = use$(() =>
    Object.values(recipes$(syncedGroup(recipes$)).get() ?? {})
      .filter((r): r is NonNullable<typeof r> => !!r && !r.deleted)
      .map((r) => ({ id: r.id, title: r.title }))
  );

  const searchRows = apartments.map((a) => ({ id: a.id, title: a.address, meta: a.suburb ?? undefined }));

  const overviewCounts: OfflineRow[] = [
    { id: "groceries", title: "Groceries", meta: `${groceries.length} needed` },
    { id: "household", title: "Tasks", meta: `${tasks.length} open` },
    { id: "costs", title: "Costs & Budget", meta: `${costs.length} tracked` },
    { id: "setup", title: "Home Setup", meta: `${setup.length} needed` },
    { id: "calendar", title: "Calendar", meta: `${events.length} upcoming` },
    { id: "checklists", title: "Checklists", meta: `${checklistRows.length} active` },
    { id: "recipes", title: "Recipes", meta: `${recipeRows.length} saved` },
    { id: "search", title: "Home Search", meta: `${searchRows.length} listings` },
  ].filter((row) => isSectionEnabled(row.id, enabled));

  return {
    groceries: { label: "Shopping list", rows: groceries, emptyLabel: "Nothing on your list." },
    household: { label: "Tasks", rows: tasks, emptyLabel: "No open tasks." },
    costs: { label: "Recurring costs", rows: costs, emptyLabel: "No cost items synced." },
    setup: { label: "Rooms & Checklist", rows: setup, emptyLabel: "Nothing left to set up." },
    calendar: { label: "Upcoming events", rows: events, emptyLabel: "No events synced." },
    checklists: { label: "Active checklists", rows: checklistRows, emptyLabel: "No checklists synced." },
    recipes: { label: "Recipes", rows: recipeRows, emptyLabel: "No recipes synced." },
    search: { label: "Home Search", rows: searchRows, emptyLabel: "No listings synced." },
    overview: {
      label: "Your household, offline",
      rows: overviewCounts,
      emptyLabel: "No local data synced yet. Connect once to get started.",
    },
  };
}

export default function OfflineShellPage() {
  // This document is precached and served by Serwist's `fallbacks` for ANY
  // failed navigation, so the browser's address bar holds the page the user
  // actually asked for (e.g. /groceries) — but that's a different URL than
  // this shell was generated for, so Next's own usePathname()/router state
  // reflects the flight data baked into THIS static page, not the real one.
  // Read the true URL straight from the browser instead. Resolved post-mount
  // (matching data-cache.tsx's SSR-mismatch pattern: same value on the server
  // and the first client render, then flip before paint) so hydration never
  // has to reconcile two different renders of this section-dependent tree.
  const [pathname, setPathname] = useState<string | null>(null);
  useLayoutEffect(() => {
    setPathname(window.location.pathname);
  }, []);

  const { group, loading } = useDataCache();
  const { enabled, isSectionEnabled: sectionOn } = useModules();
  const apts$ = apartments$(syncedGroupId(apartments$, group?.id, enabled));
  const apartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is NonNullable<typeof a> => !!a && !a.deleted)
  );
  const found = pathname ? getSectionByPath(pathname) : null;
  // Modules: a switched-off module's URL falls back to the overview, as online.
  const section = found && sectionOn(found.id) ? found : null;
  const summaries = useOfflineSummaries(group?.id, apartments);
  const summary = section ? pickOfflineSummary(section.id, summaries) : summaries.overview;

  return (
    <div className="space-y-5 p-4 md:p-6 max-w-3xl mx-auto pb-28">
      <div className="space-y-1">
        <p className="font-heading text-[21px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
          {summary.label}
        </p>
        <p className="text-xs text-muted-foreground">
          {group ? `${group.name} · showing your last synced data` : "Connect to the internet once to load your household"}
        </p>
      </div>

      {loading && !group ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-10 text-center">
          <p className="text-muted-foreground">Loading your local data…</p>
        </div>
      ) : summary.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-10 text-center">
          <p className="text-muted-foreground">{summary.emptyLabel}</p>
        </div>
      ) : (
        <ListGroup>
          {summary.rows.map((row) => (
            <ListItem key={row.id}>
              <ListItemContent>
                <ListItemTitle>{row.title}</ListItemTitle>
                {row.meta && <ListItemMeta>{row.meta}</ListItemMeta>}
              </ListItemContent>
            </ListItem>
          ))}
        </ListGroup>
      )}
    </div>
  );
}
