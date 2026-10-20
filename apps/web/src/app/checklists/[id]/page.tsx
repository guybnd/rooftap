'use client';

// FLUX-156: Checklists — checklist detail (the cross-section nexus).
//
// Owns: item add/check/uncheck/reorder/delete with per-item attribution; the date
// attribute ↔ linked dashboard to-do; Shopping cost logging into cost_items;
// checklist↔task completion sync; Repeating cadence/renewal settings + client-side
// auto-renewal on load; manual "Start again". All row shapes and rules come from
// @/lib/checklists so every surface agrees on them.

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { use$ } from '@legendapp/state/react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  CalendarDays,
  RotateCcw,
  X,
} from 'lucide-react';
import { useDataCache } from '@/lib/data-cache';
import { checklists$, checklistItems$, todayISO, householdTasks$, costItems$, useReconnectSync, useStoreHelpers, useStoreLoaded, useChecklistItemActions, useChecklistViewPrefs, createUndoBatchTracker, useModules, currencySymbol } from '@homeup/core';
import type { Checklist, ChecklistTaskItem, ChecklistRenewalMode } from '@homeup/core';
import {
  typeMeta,
  completion,
  spendTotals,
  centsToDollars,
  liveItems,
  buildLinkedTask,
  cloneRun,
  isRepeatingDue,
  addDays,
  deterministicId,
  renameChecklistPatch,
  RENEWAL_MODES,
  CHECKLIST_SORT_LABELS,
  availableSortModes,
  sortItems,
  partitionDone,
} from '@homeup/core';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { toastUndoDelete } from '@/lib/undo-toast';
import { PopMenu, MenuItem, MenuLabel, MenuDivider } from '@/app/setup/pop-menu';
import { EditableText } from '@/components/ui/editable-text';
import { LeadingTile } from '@/components/ui/leading-tile';
import { Switch } from '@/components/ui/switch';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { DateScrollField } from '@/components/date-scroll-field';
import { ChecklistItemList } from '@/components/checklist-item-list';
import { cn } from '@/lib/utils';
import { checklistTypeIcon, scheduledDateMeta, SCHEDULED_TONE_CLASS } from '../checklist-ui';

// Hearth §7 (E3): every sub-panel opens with a way back to the property list
// without closing the sheet — same idiom as apps/web/src/app/tasks/task-row.tsx's
// BackRow/PropertyValue (local per-file, no pop-menu.tsx change).
function BackRow({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <MenuItem icon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={onBack}>
      {label}
    </MenuItem>
  );
}

function PropertyValue({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span className="max-w-[9rem] truncate text-xs font-medium">{children}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
    </span>
  );
}

export default function ChecklistDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const checklistId = params.id;
  const { group, currentUserId, memberProfiles, userSettings, loading: cacheLoading } = useDataCache();
  const modules = useModules();
  // Modules: creating the date's dashboard to-do needs Tasks and Checklists
  // (module-features.ts). Off: the list keeps its own date and no new to-do
  // is written, but one that already exists still follows the list (date,
  // title, done, removal), so it is right when Tasks comes back.
  const syncTask = modules.feature('tasks.checklists');
  // Modules: the "log costs" option needs Costs and Checklists (module-features.ts).
  const logCostsOn = modules.feature('costs.from-checklists');

  const lists$ = checklists$(group?.id);
  const items$ = checklistItems$(group?.id);
  const tasks$ = householdTasks$(group?.id);
  const costs$ = costItems$(logCostsOn ? group?.id : undefined);
  useReconnectSync(lists$);
  useReconnectSync(items$);
  useReconnectSync(tasks$);
  useReconnectSync(costs$);

  const { writeRow: writeList, patchRow: patchList, softDeleteRow: softDeleteList } =
    useStoreHelpers(lists$, currentUserId);
  const { writeRow: writeItem, patchRow: patchItem, softDeleteRow: softDeleteItem } =
    useStoreHelpers(items$, currentUserId);
  const { writeRow: writeTask, patchRow: patchTask, softDeleteRow: softDeleteTask } =
    useStoreHelpers(tasks$, currentUserId);
  const storeLoaded = useStoreLoaded(lists$, items$);

  const checklist = use$(() => {
    const rec = lists$.get() ?? {};
    const c = (rec as Record<string, Checklist>)[checklistId];
    return c && !c.deleted ? c : null;
  });

  // D7: the flat, order-ascending, unpartitioned array. `move()` and every
  // "true order" consumer read THIS, never the sorted/partitioned display
  // array below — sorting or sinking done items to a band is a view, and
  // must never perturb real manual order.
  const orderedItems = use$(() =>
    Object.values(items$.get() ?? {})
      .filter((i): i is ChecklistTaskItem => !!i && !i.deleted && i.checklist_id === checklistId)
      .sort((a, b) => a.order - b.order),
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<'menu' | 'sort'>('menu');
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  // HOUP-328: Rename lives in the menu but edits the header h1 in place —
  // a controlled EditableText so the menu can flip it into edit mode.
  const [titleEditing, setTitleEditing] = useState(false);

  const viewPrefs = useChecklistViewPrefs(checklistId, checklist?.type ?? 'plain', {
    sortMode: userSettings?.checklists_default_sort ?? null,
    completedToBottom: userSettings?.checklists_completed_to_bottom ?? true,
    collapsed: userSettings?.checklists_collapse_completed ?? false,
  });

  // View-only projection (D2): sort never writes `order`. When "Completed to
  // bottom" is on, done rows split into their own band below open rows; when
  // off, the sorted array renders flat (done rows stay wherever the sort put
  // them, still individually muted).
  const sortedItems = useMemo(() => sortItems(orderedItems, viewPrefs.sortMode), [orderedItems, viewPrefs.sortMode]);
  const { open: openItems, done: doneItems } = useMemo(() => partitionDone(sortedItems), [sortedItems]);

  const { done, total, complete } = useMemo(() => completion(orderedItems), [orderedItems]);
  // HOUP-330: running total for shopping lists — rendered as one fragment on
  // the count line (H6), hidden when no item carries a price.
  const { spentCents, totalCents } = useMemo(() => spendTotals(orderedItems), [orderedItems]);

  // ── Item writes ───────────────────────────────────────────────────────────────
  // HOUP-332: the one item-write hook (add/delete/restore/rename/reprice),
  // composing useChecklistToggle internally so the completion sync stays
  // owned in one place — shared with the inline /tasks checklist panel.
  const actions = useChecklistItemActions(checklist, orderedItems, currentUserId);
  const { toggleItem, setItemsDone, syncAfterClear } = actions;

  const checkAll = () => {
    if (openItems.length === 0) return;
    setItemsDone(openItems, true);
    setMenuOpen(false);
  };

  const uncheckAll = () => {
    if (doneItems.length === 0) return;
    setItemsDone(doneItems, false);
    setMenuOpen(false);
  };

  // D7: reads/writes orderedItems (never the sorted/partitioned display), so
  // a swap always picks a true `order` neighbour. Only rendered when
  // sortMode === 'manual' (D2) — the primitive gates this on its own.
  const move = (item: ChecklistTaskItem, dir: -1 | 1) => {
    const idx = orderedItems.findIndex((i) => i.id === item.id);
    const swap = orderedItems[idx + dir];
    if (!swap) return;
    patchItem(item.id, { order: swap.order } as Partial<ChecklistTaskItem>);
    patchItem(swap.id, { order: item.order } as Partial<ChecklistTaskItem>);
  };

  // HOUP-245: undo pill on delete — the soft-delete commits immediately (already
  // filtered everywhere via !item.deleted), so the pill only needs to track what
  // to restore. No tick-off "linger" tracker on this page: checked items already
  // stay in view (strikethrough only, see the items filter above) instead of
  // being hidden, so there's nothing to delay-filter.
  const undoBatchTracker = useMemo(() => createUndoBatchTracker<ChecklistTaskItem>(() => {}), []);

  // HOUP-327: shared by the per-row delete AND Clear completed, so both
  // routes to an emptied list agree (D8) instead of one un-ticking the linked
  // to-do while the other doesn't. Coalesces into ONE undo pill (HOUP-245) —
  // restoreItems fires exactly one completion sync over the whole batch.
  const removeItems = (toRemove: ChecklistTaskItem[]) => {
    if (toRemove.length === 0) return;
    const removedIds = new Set(toRemove.map((i) => i.id));
    toRemove.forEach((item) => {
      softDeleteItem(item.id);
      undoBatchTracker.add(item);
    });
    syncAfterClear(liveItems(orderedItems).filter((i) => !removedIds.has(i.id)));
    toastUndoDelete(undoBatchTracker.count(), () => {
      actions.restoreItems(undoBatchTracker.restoreAll());
    });
  };

  const deleteItem = (item: ChecklistTaskItem) => removeItems([item]);

  const clearCompleted = () => {
    removeItems(doneItems);
    setMenuOpen(false);
  };

  // ── Date attribute ↔ linked dashboard to-do ──────────────────────────────────
  const setScheduledDate = (newDate: string | null) => {
    if (!checklist) return;
    if (newDate) {
      patchList(checklist.id, { scheduled_date: newDate } as Partial<Checklist>);
      if (checklist.linked_task_id) {
        patchTask(checklist.linked_task_id, { due_date: newDate });
      } else if (syncTask) {
        const task = buildLinkedTask({
          checklist: { ...checklist, scheduled_date: newDate },
          createdBy: currentUserId,
        });
        writeTask(task);
        patchList(checklist.id, { linked_task_id: task.id } as Partial<Checklist>);
      }
    } else {
      if (checklist.linked_task_id) softDeleteTask(checklist.linked_task_id);
      patchList(checklist.id, { scheduled_date: null, linked_task_id: null } as Partial<Checklist>);
    }
  };

  // ── Repeating cadence / renewal settings ─────────────────────────────────────
  const setCadence = (days: number | null) =>
    checklist && patchList(checklist.id, { repeat_cadence_days: days } as Partial<Checklist>);
  const setRenewalMode = (mode: ChecklistRenewalMode) =>
    checklist && patchList(checklist.id, { repeat_renewal_mode: mode } as Partial<Checklist>);
  const setLogCosts = (on: boolean) =>
    checklist && patchList(checklist.id, { log_costs: on } as Partial<Checklist>);

  // HOUP-328: title rename — empty submit reverts (renameChecklistPatch
  // returns null). A linked dashboard to-do's title follows, same convention
  // as setScheduledDate keeping the linked task's due_date in sync.
  const renameChecklist = (title: string) => {
    if (!checklist) return;
    const patch = renameChecklistPatch(title);
    if (!patch) return;
    patchList(checklist.id, patch as Partial<Checklist>);
    if (checklist.linked_task_id) patchTask(checklist.linked_task_id, { title: patch.title });
  };

  // ── Manual "Start again": clone into a fresh run, archive this one ────────────
  const startAgain = () => {
    if (!checklist) return;
    const { checklist: fresh, items: freshItems } = cloneRun({
      source: checklist,
      items: orderedItems,
      scheduledDate: checklist.scheduled_date,
      createdBy: currentUserId,
    });
    writeList(fresh);
    freshItems.forEach(writeItem);
    if (syncTask && fresh.scheduled_date) {
      const task = buildLinkedTask({ checklist: fresh, createdBy: currentUserId });
      writeTask(task);
      patchList(fresh.id, { linked_task_id: task.id } as Partial<Checklist>);
    }
    // Retire this run's old dashboard to-do so it doesn't linger orphaned.
    if (checklist.linked_task_id) softDeleteTask(checklist.linked_task_id);
    patchList(checklist.id, { completed_at: new Date().toISOString() } as Partial<Checklist>);
    router.push(`/checklists/${fresh.id}`);
  };

  const deleteChecklist = () => {
    if (!checklist) return;
    // Cascade the linked dashboard to-do; leave any already-logged costs as real spend.
    if (checklist.linked_task_id) softDeleteTask(checklist.linked_task_id);
    softDeleteList(checklist.id);
    router.push('/checklists');
  };

  // D3/E4: Delete list is the lone danger row in the header menu — same
  // window.confirm convention as other destructive MenuItem rows (e.g.
  // apps/web/src/app/documents/page.tsx's folder delete).
  const confirmDeleteList = () => {
    if (!checklist) return;
    if (!window.confirm(`Delete "${checklist.title}"? This removes the whole list.`)) return;
    deleteChecklist();
  };

  // ── Repeating renewal (explicit) ─────────────────────────────────────────────
  // A repeating list is "due" once its cadence date arrives. Renewal is an
  // EXPLICIT action (the banner button below) — never a passive on-load side
  // effect — so a read-only viewer can't silently archive/reset the list, and two
  // members opening it at once don't both fire. Clone-mode uses a deterministic id
  // seed keyed to the cycle date, so even if two members both click renew for the
  // same cycle the writes upsert to ONE fresh run instead of duplicating.
  const renewDue = !!checklist && !checklist.completed_at && isRepeatingDue(checklist, todayISO());

  const renewNow = () => {
    if (!checklist || checklist.completed_at) return;
    const today = todayISO();
    if (!isRepeatingDue(checklist, today)) return;
    const cadence = checklist.repeat_cadence_days ?? 7;
    const nextDate = addDays(checklist.scheduled_date as string, cadence);

    if ((checklist.repeat_renewal_mode ?? 'clone') === 'reset') {
      // Reset in place: un-check every item + roll the date forward. Logged costs
      // stay as real spend; clearing the cost link lets a re-check log the new cycle.
      liveItems(orderedItems).forEach((it) => {
        if (it.is_done || it.linked_cost_item_id) {
          patchItem(it.id, {
            is_done: false,
            checked_by: null,
            checked_at: null,
            linked_cost_item_id: null,
          } as Partial<ChecklistTaskItem>);
        }
      });
      patchList(checklist.id, { scheduled_date: nextDate, completed_at: null } as Partial<Checklist>);
      if (checklist.linked_task_id) {
        patchTask(checklist.linked_task_id, { due_date: nextDate, done: false, completed_at: null });
      }
    } else {
      // Clone: archive this run, spin up a fresh unchecked copy for the next date.
      // Deterministic ids (keyed to the cycle date) make concurrent renewals converge.
      const idSeed = `${checklist.id}:${nextDate}`;
      const { checklist: fresh, items: freshItems } = cloneRun({
        source: checklist,
        items: orderedItems,
        scheduledDate: nextDate,
        createdBy: currentUserId,
        idSeed,
      });
      writeList(fresh);
      freshItems.forEach(writeItem);
      if (syncTask) {
        const task = buildLinkedTask({
          checklist: fresh,
          createdBy: currentUserId,
          id: deterministicId(`task:${idSeed}`),
        });
        writeTask(task);
        patchList(fresh.id, { linked_task_id: task.id } as Partial<Checklist>);
      }
      // Retire this run's old dashboard to-do so it doesn't linger orphaned.
      if (checklist.linked_task_id) softDeleteTask(checklist.linked_task_id);
      patchList(checklist.id, { completed_at: new Date().toISOString() } as Partial<Checklist>);
      router.replace(`/checklists/${fresh.id}`);
    }
  };

  if (cacheLoading || (!storeLoaded && !checklist)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;
  if (!checklist)
    return (
      <div className="p-6 text-muted-foreground">
        Checklist not found.{' '}
        <Link href="/checklists" className="text-primary hover:text-primary/80">
          Back to all checklists
        </Link>
      </div>
    );

  const meta = typeMeta(checklist.type);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const renewalMode = checklist.repeat_renewal_mode ?? 'clone';
  const date = checklist.scheduled_date ? scheduledDateMeta(checklist.scheduled_date, { long: true }) : null;
  const TypeIcon = checklistTypeIcon(checklist.type);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link
          href="/checklists"
          aria-label="Back to checklists"
          className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={navLinkClickHandler('back', router, '/checklists')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {/* v2 (E1): the header wears the same tile the row does, so opening
            a list feels like zooming into it. */}
        <LeadingTile sectionId="checklists" Icon={TypeIcon} size="md" />
        {/* HOUP-328: Rename (menu) flips this into edit mode via the
            controlled `editing` prop — same click-to-edit primitive as
            every other editable field, just entered from the menu instead
            of a direct tap since the title is a rare edit (Decision M1). */}
        <h1 className="min-w-0 flex-1 truncate">
          <EditableText
            value={checklist.title}
            onCommit={renameChecklist}
            editing={titleEditing}
            onEditingChange={setTitleEditing}
            triggerClassName="block min-w-0 truncate text-2xl font-bold text-foreground"
            inputClassName="w-full min-w-0 rounded-lg border border-ring bg-input px-2 py-1 text-2xl font-bold text-foreground focus:outline-none"
          />
        </h1>
        {/* D3: the resting Trash2 moves into the menu's Danger group. */}
        <PopMenu
          trigger={<MoreHorizontal className="h-4 w-4" />}
          triggerClassName="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
          triggerLabel="More"
          mobileSheet
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (open) setMenuView('menu');
          }}
        >
          {(close) =>
            menuView === 'menu' ? (
              <>
                <MenuLabel>List</MenuLabel>
                <MenuItem
                  onClick={() => setMenuView('sort')}
                  trailing={<PropertyValue>{CHECKLIST_SORT_LABELS[viewPrefs.sortMode]}</PropertyValue>}
                >
                  Sort
                </MenuItem>
                {/* D6: web's menu uses MenuItem active rather than a Switch. */}
                <MenuItem onClick={() => viewPrefs.setCompletedToBottom(!viewPrefs.completedToBottom)} active={viewPrefs.completedToBottom}>
                  Completed to bottom
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    setTitleEditing(true);
                  }}
                  trailing={<PropertyValue>{checklist.title}</PropertyValue>}
                >
                  Rename
                </MenuItem>

                <MenuDivider />

                <MenuLabel>Items</MenuLabel>
                {openItems.length > 0 && <MenuItem onClick={checkAll}>Check all</MenuItem>}
                {doneItems.length > 0 && <MenuItem onClick={uncheckAll}>Uncheck all</MenuItem>}
                <MenuItem onClick={clearCompleted} disabled={doneItems.length === 0}>
                  {`Clear completed · ${doneItems.length}`}
                </MenuItem>

                <MenuDivider />

                <MenuLabel>Danger</MenuLabel>
                <MenuItem
                  danger
                  onClick={() => {
                    close();
                    confirmDeleteList();
                  }}
                >
                  Delete list
                </MenuItem>
              </>
            ) : (
              <>
                <BackRow onBack={() => setMenuView('menu')} label="Sort" />
                {availableSortModes(checklist.type).map((mode) => (
                  <MenuItem
                    key={mode}
                    active={viewPrefs.sortMode === mode}
                    onClick={() => {
                      viewPrefs.setSortMode(mode);
                      setMenuView('menu');
                    }}
                  >
                    {CHECKLIST_SORT_LABELS[mode]}
                  </MenuItem>
                ))}
              </>
            )
          }
        </PopMenu>
      </div>

      {/* Repeating: due-to-renew card (explicit renewal, no passive side
          effect). H2: a neutral card with the section tile; its button is the
          screen's one primary action while it shows. */}
      {renewDue && (
        <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-border/60 bg-card px-4 py-3 shadow-[var(--card-shadow)]">
          <LeadingTile sectionId="checklists" Icon={RotateCcw} size="md" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">Due to renew</div>
            <div className="text-xs text-muted-foreground">
              {renewalMode === 'clone' ? 'A fresh copy replaces this run' : 'Every item unchecks'}
            </div>
          </div>
          <button
            type="button"
            onClick={renewNow}
            className="inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            {renewalMode === 'clone' ? 'Start next cycle' : 'Reset for next cycle'}
          </button>
        </div>
      )}

      {/* Meta + progress: one v2 card, hairline dividers between its rows (H4). */}
      <div className="rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {checklist.completed_at ? (
            <span className="font-medium text-success">Completed</span>
          ) : (
            <span>{meta.label}</span>
          )}
          <span className="tabular-nums">
            {done} of {total} done
            {checklist.type === 'shopping' && totalCents > 0 && (
              <>
                {' · '}
                <span className="text-foreground">{currencySymbol()}{centsToDollars(spentCents)}</span>
                {` of $${centsToDollars(totalCents)}`}
              </>
            )}
          </span>
        </div>
        {total > 0 && (
          <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}

        {/* Date property row (E2): shows its value, opens a picker in place,
            the same date sheet mobile uses. */}
        <div className="mt-3 border-t border-border/60 pt-1">
          <PopMenu
            open={dateMenuOpen}
            onOpenChange={setDateMenuOpen}
            mobileSheet
            align="right"
            width="w-72"
            triggerLabel={syncTask ? 'Date on dashboard' : 'Date'}
            triggerClassName="flex min-h-11 w-full items-center gap-3 text-left text-sm"
            trigger={
              <>
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-foreground">{syncTask ? 'Date on dashboard' : 'Date'}</span>
                <span
                  className={cn(
                    'text-xs',
                    date ? SCHEDULED_TONE_CLASS[date.tone] : 'text-muted-foreground',
                    date && date.tone !== 'muted' && 'font-medium',
                  )}
                >
                  {date ? date.label : 'Add date'}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </>
            }
          >
            {(close) => (
              <>
                <MenuLabel>{syncTask ? 'Date on dashboard' : 'Date'}</MenuLabel>
                <div className="px-2 pb-2">
                  <DateScrollField
                    value={checklist.scheduled_date ?? ''}
                    onChange={(v) => setScheduledDate(v || null)}
                    emptyLabel="No date. Spin to pick one"
                  />
                </div>
                {checklist.scheduled_date && (
                  <>
                    <MenuDivider />
                    <MenuItem
                      danger
                      icon={<X className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setScheduledDate(null);
                        close();
                      }}
                    >
                      Remove date
                    </MenuItem>
                  </>
                )}
              </>
            )}
          </PopMenu>
        </div>

        {/* Shopping: cost logging toggle */}
        {checklist.type === 'shopping' && logCostsOn && (
          <div className="flex min-h-11 items-center gap-3 border-t border-border/60 text-sm text-foreground">
            <span className="flex-1">Log checked items in Costs</span>
            <Switch checked={checklist.log_costs} onChange={setLogCosts} label="Log checked items in Costs" />
          </div>
        )}

        {/* Repeating: cadence + renewal mode */}
        {checklist.type === 'repeating' && (
          <div className="space-y-2 border-t border-border/60 pt-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
              <RotateCcw className="h-4 w-4 text-muted-foreground" />
              Repeats every
              <input
                type="number"
                min={1}
                value={checklist.repeat_cadence_days ?? 7}
                onChange={(e) => setCadence(parseInt(e.target.value, 10) || null)}
                aria-label="Repeat every N days"
                className="h-9 w-16 rounded-lg border border-border bg-input px-2 text-sm tabular-nums text-foreground focus:border-primary focus:outline-none"
              />
              days
            </div>
            <SegmentedControl
              options={RENEWAL_MODES.map((m) => ({ value: m, label: m === 'clone' ? 'Clone a fresh copy' : 'Reset in place' }))}
              value={renewalMode}
              onChange={setRenewalMode}
              ariaLabel="Renewal"
            />
            <p className="text-xs text-muted-foreground">
              {renewalMode === 'clone'
                ? 'On the date, this run archives and a fresh copy starts.'
                : 'On the date, every item unchecks.'}
            </p>
          </div>
        )}
      </div>

      {/* Items — HOUP-332: shared ChecklistItemList primitive (also used by
          the /tasks + home-hero inline panel) owns resting rows + the add
          well; the manual-sort move arrows stay detail-only via `onMove`. */}
      <ChecklistItemList
        checklist={checklist}
        orderedItems={orderedItems}
        viewPrefs={viewPrefs}
        variant="detail"
        onToggle={toggleItem}
        onAdd={actions.addItems}
        onRename={actions.renameItem}
        onReprice={actions.repriceItem}
        onDelete={deleteItem}
        onMove={move}
        memberProfiles={memberProfiles}
      />

      {/* Start again (when complete or archived) */}
      {(complete || checklist.completed_at) && (
        <button
          type="button"
          onClick={startAgain}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border bg-muted px-4 text-sm font-medium text-foreground hover:bg-accent"
        >
          <RotateCcw className="h-4 w-4" />
          Start again
        </button>
      )}
    </div>
  );
}
