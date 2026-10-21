'use client';

// FLUX-156: Checklists section — all-checklists list.
// Group-shared, offline-synced list of typed checklists (Plain / Repeating /
// Shopping) led by the section tile with the type's glyph, an optional relative
// date, live completion, and a "Start again" affordance on completed lists. New checklists are created from the
// New flow (/checklists/new). Distinct from the legacy /checklist apartment-scoring
// route (relabelled "Apartment Checklist" in the nav).

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use$ } from '@legendapp/state/react';
import { Plus, ListChecks } from 'lucide-react';
import { useDataCache } from '@/lib/data-cache';
import { checklists$, checklistItems$, householdTasks$, useReconnectSync, useStoreHelpers, useStoreLoaded, useModules } from '@homeup/core';
import type { Checklist, ChecklistTaskItem } from '@homeup/core';
import {
  cloneRun,
  buildLinkedTask,
} from '@homeup/core';
import { HeroLede } from '@/components/ui/hero-lede';
import { ChecklistRow } from './checklist-row';
import { useWideLayout } from '@/lib/desktop-layout';
import { WideList } from '@/components/wide-list';
import { cn } from '@/lib/utils';

export default function ChecklistsPage() {
  const router = useRouter();
  const wide = useWideLayout();
  const { group, currentUserId, loading: cacheLoading } = useDataCache();
  // Modules: "Start again" re-links a dashboard to-do only with Tasks and
  // Checklists on (module-features.ts). Off: no task is read or written.
  const syncTask = useModules().feature('tasks.checklists');

  const lists$ = checklists$(group?.id);
  const items$ = checklistItems$(group?.id);
  const tasks$ = householdTasks$(syncTask ? group?.id : undefined);
  useReconnectSync(lists$);
  useReconnectSync(items$);
  useReconnectSync(tasks$);

  const { writeRow: writeList, patchRow: patchList } = useStoreHelpers(lists$, currentUserId);
  const { writeRow: writeItem } = useStoreHelpers(items$, currentUserId);
  const { writeRow: writeTask } = useStoreHelpers(tasks$, currentUserId);
  const storeLoaded = useStoreLoaded(lists$, items$);

  const lists = use$(() =>
    Object.values(lists$.get() ?? {})
      .filter((c): c is Checklist => !!c && !c.deleted)
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
  );
  const allItems = use$(() =>
    Object.values(items$.get() ?? {}).filter((i): i is ChecklistTaskItem => !!i && !i.deleted),
  );

  // completion map keyed by checklist id
  const itemsByList = useMemo(() => {
    const m = new Map<string, ChecklistTaskItem[]>();
    for (const it of allItems) {
      const arr = m.get(it.checklist_id) ?? [];
      arr.push(it);
      m.set(it.checklist_id, arr);
    }
    return m;
  }, [allItems]);

  const active = lists.filter((l) => !l.completed_at);
  const completed = lists.filter((l) => l.completed_at);

  // "Start again": clone a completed list into a fresh unchecked run, archive the
  // source, re-link a dashboard to-do if it had one, and open the new run.
  const startAgain = (source: Checklist) => {
    const items = itemsByList.get(source.id) ?? [];
    const { checklist, items: freshItems } = cloneRun({
      source,
      items,
      scheduledDate: source.scheduled_date,
      createdBy: currentUserId,
    });
    writeList(checklist);
    freshItems.forEach(writeItem);
    if (syncTask && checklist.scheduled_date) {
      const task = buildLinkedTask({ checklist, createdBy: currentUserId });
      writeTask(task);
      patchList(checklist.id, { linked_task_id: task.id } as Partial<Checklist>);
    }
    patchList(source.id, { completed_at: new Date().toISOString() } as Partial<Checklist>);
    router.push(`/checklists/${checklist.id}`);
  };

  if (cacheLoading || (!storeLoaded && lists.length === 0)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  return (
    <div className={cn('mx-auto space-y-4 p-4 md:p-6 pb-24', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-3xl')}>
      {/* Hearth v2 (Pulse, H1): the active count is the page's Hero lede;
          New checklist sits beside it. Mirrors mobile's grammar. */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <HeroLede
          value={active.length}
          label="active"
          caption={completed.length > 0 ? `${completed.length} done` : undefined}
        />
        <Link
          href="/checklists/new"
          className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New checklist
        </Link>
      </div>

      {lists.length === 0 ? (
        // Hearth §11 empty state: centered, one headline, one line, one CTA
        // (the header's New checklist stays the path; no second button here).
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <div className="rounded-2xl bg-primary/10 p-5">
            <ListChecks className="h-7 w-7 text-primary" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">No checklists yet</h2>
            <p className="max-w-[280px] text-sm text-muted-foreground">Create one from scratch or a template.</p>
          </div>
        </div>
      ) : (
        <>
          <WideList>
            {active.map((l) => (
              <ChecklistRow key={l.id} list={l} items={itemsByList.get(l.id) ?? []} />
            ))}
          </WideList>

          {completed.length > 0 && (
            <div className="pt-2">
              <h2 className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Completed
              </h2>
              <WideList>
                {completed.map((l) => (
                  <ChecklistRow
                    key={l.id}
                    list={l}
                    items={itemsByList.get(l.id) ?? []}
                    onStartAgain={() => startAgain(l)}
                  />
                ))}
              </WideList>
            </div>
          )}
        </>
      )}
    </div>
  );
}
