'use client';

// FLUX-156: Checklists — New checklist flow.
// Create from scratch (title + type + optional date) or from a group template
// (seeded starters + user-authored). Creating a dated checklist links a dashboard
// to-do. Instantiation is centralised in @/lib/checklists so this and the
// templates manager stay in lockstep.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use$ } from '@legendapp/state/react';
import { ArrowLeft, CalendarDays, ChevronRight, Plus } from 'lucide-react';
import { useDataCache } from '@/lib/data-cache';
import { checklists$, checklistItems$, checklistTemplates$, checklistTemplateItems$, householdTasks$, useReconnectSync, useStoreHelpers, useStoreLoaded, compareStrings, useModules } from '@homeup/core';
import type {
  Checklist,
  ChecklistTemplate,
  ChecklistTemplateItem,
  ChecklistType,
} from '@homeup/core';
import {
  CHECKLIST_TYPES,
  typeMeta,
  typeDescription,
  buildChecklist,
  buildLinkedTask,
  instantiateTemplate,
  seedStarterTemplates,
  liveItems,
} from '@homeup/core';
import { LeadingTile } from '@/components/ui/leading-tile';
import { Switch } from '@/components/ui/switch';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { DateScrollField } from '@/components/date-scroll-field';
import { checklistTypeIcon } from '../checklist-ui';

export default function NewChecklistPage() {
  const router = useRouter();
  const { group, currentUserId, loading: cacheLoading } = useDataCache();
  const modules = useModules();
  // Modules: a dated checklist writes its linked dashboard to-do only with
  // Tasks and Checklists on (module-features.ts). Off: the date stays on the list.
  const syncTask = modules.feature('tasks.checklists');
  // Modules: the Shopping type's "log a purchase" line needs Costs and Checklists (module-features.ts).
  const logCostsOn = modules.feature('costs.from-checklists');

  const lists$ = checklists$(group?.id);
  const items$ = checklistItems$(group?.id);
  const templates$ = checklistTemplates$(group?.id);
  const templateItems$ = checklistTemplateItems$(group?.id);
  const tasks$ = householdTasks$(syncTask ? group?.id : undefined);
  useReconnectSync(lists$);
  useReconnectSync(templates$);
  useReconnectSync(templateItems$);
  useReconnectSync(tasks$);

  const { writeRow: writeList, patchRow: patchList } = useStoreHelpers(lists$, currentUserId);
  const { writeRow: writeItem } = useStoreHelpers(items$, currentUserId);
  const { writeRow: writeTask } = useStoreHelpers(tasks$, currentUserId);
  const { writeRow: writeTemplate } = useStoreHelpers(templates$, currentUserId);
  const { writeRow: writeTemplateItem } = useStoreHelpers(templateItems$, currentUserId);
  const storeLoaded = useStoreLoaded(templates$);

  const templates = use$(() =>
    Object.values(templates$.get() ?? {})
      .filter((t): t is ChecklistTemplate => !!t && !t.deleted)
      .sort((a, b) => compareStrings(a.title, b.title)),
  );
  const templateItems = use$(() =>
    Object.values(templateItems$.get() ?? {}).filter(
      (i): i is ChecklistTemplateItem => !!i && !i.deleted,
    ),
  );

  // Seed starter templates once (idempotent) so they're offered here even before
  // the templates manager has been visited.
  useEffect(() => {
    if (!group?.id) return;
    seedStarterTemplates({
      existing: templates,
      groupId: group.id,
      createdBy: currentUserId,
      writeTemplate,
      writeTemplateItem,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, templates.length]);

  // ── from-scratch form state ──────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ChecklistType>('plain');
  const [dated, setDated] = useState(false);
  const [date, setDate] = useState('');

  const linkTaskIfDated = (checklist: Checklist) => {
    if (!syncTask || !checklist.scheduled_date) return;
    const task = buildLinkedTask({ checklist, createdBy: currentUserId });
    writeTask(task);
    patchList(checklist.id, { linked_task_id: task.id } as Partial<Checklist>);
  };

  const createFromScratch = () => {
    if (!group?.id || !title.trim()) return;
    const checklist = buildChecklist({
      groupId: group.id,
      title,
      type,
      scheduledDate: dated && date ? date : null,
      createdBy: currentUserId,
    });
    writeList(checklist);
    linkTaskIfDated(checklist);
    router.push(`/checklists/${checklist.id}`);
  };

  const createFromTemplate = (template: ChecklistTemplate) => {
    if (!group?.id) return;
    const tItems = liveItems(templateItems).filter((i) => i.template_id === template.id);
    const { checklist, items } = instantiateTemplate({
      template,
      items: tItems,
      scheduledDate: dated && date ? date : null,
      createdBy: currentUserId,
    });
    writeList(checklist);
    items.forEach(writeItem);
    linkTaskIfDated(checklist);
    router.push(`/checklists/${checklist.id}`);
  };

  const templateItemCount = (id: string) =>
    liveItems(templateItems).filter((i) => i.template_id === id).length;

  if (cacheLoading || (!storeLoaded && templates.length === 0)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6 pb-24">
      <div className="flex items-center gap-2">
        <Link
          href="/checklists"
          aria-label="Back to checklists"
          className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold text-foreground">New checklist</h1>
      </div>

      {/* ── From scratch ── */}
      <section className="space-y-4 rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
        <h2 className="text-base font-semibold text-foreground">Start from scratch</h2>

        <div>
          <label htmlFor="checklist-title" className="mb-1 block text-xs font-medium text-muted-foreground">
            Title
          </label>
          <input
            id="checklist-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Weekend camping trip"
            className="h-11 w-full rounded-lg border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        {/* Type: one segmented control (Lucide glyphs, not emoji) with the
            picked type's description under it, instead of three cramped cards. */}
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">Type</span>
          <SegmentedControl
            options={CHECKLIST_TYPES.map((t) => {
              const Icon = checklistTypeIcon(t);
              return { value: t, label: typeMeta(t).label, icon: <Icon className="h-3.5 w-3.5" /> };
            })}
            value={type}
            onChange={setType}
            ariaLabel="Checklist type"
          />
          <p className="text-xs text-muted-foreground">
            {typeDescription(type, { linkedTask: syncTask, logCosts: logCostsOn })}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex min-h-11 items-center gap-3">
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-foreground">Add a date</div>
              {syncTask && <div className="text-xs text-muted-foreground">Shows on Home</div>}
            </div>
            <Switch checked={dated} onChange={setDated} label="Add a date" />
          </div>
          {dated && (
            <div className="rounded-2xl bg-muted/40 py-2">
              <DateScrollField value={date} onChange={setDate} emptyLabel="No date. Spin to pick one" />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={createFromScratch}
          disabled={!title.trim() || (dated && !date)}
          className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          Create checklist
        </button>
      </section>

      {/* ── From a template ── one list card, hairline rows (H4: no card in card). */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Start from a template
          </h2>
          <Link
            href="/checklists/templates"
            className="inline-flex min-h-11 items-center gap-0.5 text-xs font-medium text-primary hover:text-primary/80"
          >
            Manage templates
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {templates.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">No templates yet.</p>
        ) : (
          <div className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]">
            {templates.map((tpl) => {
              const meta = typeMeta(tpl.default_type ?? 'plain');
              const count = templateItemCount(tpl.id);
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => createFromTemplate(tpl)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                >
                  <LeadingTile sectionId="checklists" Icon={checklistTypeIcon(tpl.default_type)} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{tpl.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {meta.label} · <span className="tabular-nums">{count}</span> {count === 1 ? 'item' : 'items'}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        )}
        <p className="px-1 text-xs text-muted-foreground">
          A template copies its items, type and cadence.{syncTask && ' Turn on a date above to show it on Home.'}
        </p>
      </section>
    </div>
  );
}
