'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { CostItem, CostCadence, CostCategory, GroupMember } from '@homeup/core';
import { CATEGORY_META, CADENCE_LABEL, formatMoney, isOneOff, nextOccurrence, parseLocalDateOnly, daysUntilISO, useEntityCommentCount, type StepBackResult, currencySymbol } from '@homeup/core';
import { monthLabel, timeAgo, useCostActual, useCostBankLink, useCostCategoryChoices } from '@homeup/core';
import { CATEGORY_ICON, CategoryGlyph } from './category-glyph';
import { costDateLabel, expiryLabel } from './cost-dates';
import { EditableText } from '@/components/ui/editable-text';
import {
  ListItem,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
  ListItemBody,
} from '@/components/ui/list-item';
import { PortalChipRow, type PortalChipDef } from '@/components/ui/portal-chip';
import {
  MessageSquare,
  Paperclip,
  Pencil,
  Trash2,
  CalendarClock,
  Landmark,
  MoreHorizontal,
} from 'lucide-react';
import { AssigneePicker } from '../setup/assignee-picker';
import { PopMenu, MenuItem, MenuLabel, MenuDivider } from '../setup/pop-menu';
import { memberLabel } from '../setup/member-label';
import { useRowContextMenu, withRowMenu } from '@/components/ui/row-context-menu';
import { EntityComments } from '@/components/entity-comments';
import { CostDocuments } from './cost-documents';

import { LinkedDocuments } from '@/components/documents/linked-documents';
import { listCostDocumentPaths, listDocumentsForEntity } from '@/lib/documents';
import { syncCostReminders } from '@homeup/core';
import { findReminderTaskId, reminderKey, useModules } from '@homeup/core';
import { useLongPress as useSharedLongPress, HOLD_FILL_DELAY_MS } from '@/hooks/use-long-press';
import { DragNumberField } from '@/components/ui/drag-number-field';
import { SegmentedControl, type SegmentOption } from '@/components/ui/segmented-control';
import { SearchablePicker, type PickerOption } from '@/components/ui/searchable-picker';

// FLUX-198: elements that own their own pointer interaction never start a hold
// (mirrors groceries' NO_HOLD — buttons/inputs/links/the category+cadence chips).
const NO_HOLD = 'button, input, textarea, select, a, label, [data-no-swipe]';

// FLUX-198: thin wrapper over the shared useLongPress that opens this row's
// overflow menu as a bottom sheet on hold — same pattern as grocery-item-card.tsx.
function useRowLongPress(onFire: () => void) {
  const { handlers: shared, consumeClick, progress } = useSharedLongPress(onFire, true, {
    trackProgress: true,
    fillDelayMs: HOLD_FILL_DELAY_MS,
    moveCancelRatio: 0.1,
  });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return; // desktop: hover-⋯ / right-click instead of hold
    if ((e.target as HTMLElement).closest(NO_HOLD)) return;
    shared.onPointerDown(e);
  }, [shared]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(NO_HOLD)) return;
    e.preventDefault();
    onFire();
  }, [onFire]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (consumeClick()) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [consumeClick]);

  return {
    progress,
    handlers: { onPointerDown, onContextMenu, onClickCapture },
  };
}

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

interface CostCardProps {
  item: CostItem;
  groupId: string;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  /** Leading slot — a select checkbox in bulk mode. */
  leading?: ReactNode;
  selected?: boolean;
  /** FLUX-1563: this month's step-back for an is_estimate item's category — undefined for non-estimate items. */
  estimateStepBack?: StepBackResult;
  /** A hand-made estimate that became its category's target: out of the totals (core costTargets). */
  target?: boolean;
  /** The month the list shows, YYYY-MM: a line linked to the bank says what was paid in it. */
  month?: string;
  onUpdate: (item: CostItem) => void;
  onRequestDelete: (item: CostItem) => void;
  onEdit: (item: CostItem) => void;
}

const CADENCE_OPTIONS: CostCadence[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly', 'one_off'];

// FLUX-239: the hold menu's Amount/Cadence/Category quick-editors reuse the
// same option shapes as the full edit modal (cost-modal.tsx).
const CADENCE_SEGMENTS: SegmentOption<CostCadence>[] = CADENCE_OPTIONS.map((c) => ({
  value: c,
  label: CADENCE_LABEL[c],
}));

export function CostCard({
  item,
  groupId,
  groupMembers,
  memberProfiles,
  leading,
  selected,
  estimateStepBack,
  target,
  month,
  onUpdate,
  onRequestDelete,
  onEdit,
}: CostCardProps) {
  const [expanded, setExpanded] = useState<'docs' | 'comments' | null>(null);
  const bankLink = useCostBankLink(item.id);
  const categoryChoices = useCostCategoryChoices(item.category);
  const paidInMonth = useCostActual(item.id, month);
  const [holdMenuOpen, setHoldMenuOpen] = useState(false);
  const [docCount, setDocCount] = useState<number | null>(null);
  // FLUX-109: bumped whenever a docs panel mutates, to recompute the eager count.
  const [docsBump, setDocsBump] = useState(0);
  // FLUX-116: the reminder task this cost's expiry generated, to surface "Open reminder".
  const [reminderTaskId, setReminderTaskId] = useState<string | null>(null);
  const router = useRouter();
  const commentCount = useEntityCommentCount(createClient(), {
    table: 'cost_item_comments',
    fkColumn: 'cost_item_id',
    entityId: item.id,
  });
  const modules = useModules();
  // Modules: the "Open reminder" link needs household and costs; the reminder
  // itself is still created and synced (module-features.ts).
  const reminderLinked = modules.feature('tasks.from-cost');
  // Modules: documents-store files linked to this bill need documents and
  // costs (module-features.ts). The bill's own attachments (legacy
  // cost_documents, including mirrored grocery receipts) belong to Costs and
  // always show.
  const docsLinked = modules.feature('documents.costs');

  // FLUX-109: eagerly compute the attachment count so the collapsed badge shows
  // it without expanding. Combines legacy cost_documents + store-linked documents,
  // deduped by storage path (mirrors the LinkedDocuments panel's own dedup) so a
  // dual-written file isn't counted twice.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [legacyPaths, storeDocs] = await Promise.all([
        listCostDocumentPaths(supabase, item.id),
        docsLinked ? listDocumentsForEntity(supabase, 'cost_item', item.id) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      const legacy = new Set(legacyPaths);
      const storeExtra = storeDocs.filter((d) => !legacy.has(d.storage_path)).length;
      setDocCount(legacyPaths.length + storeExtra);
    })();
    return () => { cancelled = true; };
  }, [item.id, docsBump, docsLinked]);

  // FLUX-116: find the reminder task (contract or discount) for this cost.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!reminderLinked || (!item.end_date && !item.discount_end_date)) { setReminderTaskId(null); return; }
      const supabase = createClient();
      const contract = await findReminderTaskId(supabase, item.group_id, reminderKey('cost', item.id, 'contract'));
      const discount = contract ?? await findReminderTaskId(supabase, item.group_id, reminderKey('cost', item.id, 'discount'));
      if (!cancelled) setReminderTaskId(discount);
    })();
    return () => { cancelled = true; };
  }, [item.id, item.group_id, item.end_date, item.discount_end_date, reminderLinked]);

  const patch = (payload: Partial<CostItem>) => {
    const updated = { ...item, ...payload } as CostItem;
    // Offline-safe: route the write through the Legend store (onUpdate →
    // patchRow), which writes to IndexedDB and syncs when online. A direct
    // supabase.update() here throws while offline ("Failed to update cost: {}")
    // and round-trips separately from the local-first store when online.
    onUpdate(updated);
    // Keep the reminder task title/assignee in sync when this cost has expiry
    // dates. Fire-and-forget and offline-tolerant — if it fails offline the
    // reminder reconciles on the next online edit.
    if (updated.end_date || updated.discount_end_date) {
      void syncCostReminders(updated, createClient()).catch(() => {});
    }
  };

  const cat = CATEGORY_META[item.category];

  // FLUX-1563: this month's actuals have covered (or partially covered) the
  // estimate — the headline stopped counting the full forecast for this
  // category, so the "est" chip reflects it (muted "covered", or the
  // remaining not-yet-covered amount) instead of silently going stale.
  const estimateCovered = !!estimateStepBack && estimateStepBack.est > 0 && estimateStepBack.act >= estimateStepBack.est;
  const estimatePartial = !!estimateStepBack && !estimateCovered && estimateStepBack.act > 0;

  // Soonest relevant expiry for the at-a-glance reminder hint.
  const expiry = (() => {
    const candidates: { label: 'Contract' | 'Discount'; date: string }[] = [];
    if (item.end_date) candidates.push({ label: 'Contract', date: item.end_date });
    if (item.discount_end_date) candidates.push({ label: 'Discount', date: item.discount_end_date });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.date.localeCompare(b.date));
    const soonest = candidates[0];
    return { ...soonest, days: daysUntilISO(soonest.date) };
  })();

  const iconBtn =
    'flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex-shrink-0 transition-colors';

  const longPress = useRowLongPress(() => setHoldMenuOpen(true));
  // Hearth §13.7 "Row menu": right-click with a mouse; touch keeps the hold sheet.
  const rowMenu = useRowContextMenu(() => ({
    title: item.name,
    kind: 'Cost',
    actions: [
      !!reminderTaskId && { id: 'reminder', label: 'Open reminder', group: 'open', icon: 'open', run: () => router.push(`/tasks?focus=${reminderTaskId}`) },
      {
        id: 'cadence',
        label: 'Cadence',
        group: 'set',
        icon: 'repeat',
        value: CADENCE_LABEL[item.cadence],
        options: CADENCE_OPTIONS.map((c) => ({ id: c, label: CADENCE_LABEL[c], checked: item.cadence === c, run: () => patch({ cadence: c }) })),
      },
      {
        id: 'category',
        label: 'Category',
        group: 'set',
        icon: 'move',
        value: CATEGORY_META[item.category].label,
        options: categoryChoices.map((c) => ({ id: c, label: CATEGORY_META[c].label, checked: item.category === c, run: () => patch({ category: c }) })),
      },
      {
        id: 'assign',
        label: 'Paid by',
        group: 'set',
        icon: 'assign',
        value: item.assigned_to ? memberLabel(item.assigned_to, memberProfiles) : undefined,
        options: [
          { id: 'none', label: 'Nobody yet', checked: !item.assigned_to, run: () => patch({ assigned_to: null }) },
          ...groupMembers.map((m) => ({
            id: m.user_id,
            label: memberLabel(m.user_id, memberProfiles),
            checked: item.assigned_to === m.user_id,
            run: () => patch({ assigned_to: m.user_id }),
          })),
        ],
      },
      { id: 'files', label: 'Files', group: 'edit', icon: 'note', value: docCount ? String(docCount) : undefined, run: () => setExpanded('docs') },
      {
        id: 'comments',
        label: commentCount.count > 0 ? 'Comments' : 'Add a comment',
        group: 'edit',
        icon: 'comment',
        value: commentCount.count > 0 ? String(commentCount.count) : undefined,
        run: () => setExpanded('comments'),
      },
      { id: 'edit', label: 'Edit details', group: 'edit', icon: 'edit', run: () => onEdit(item) },
      { id: 'delete', label: 'Delete', group: 'danger', icon: 'delete', danger: true, run: () => onRequestDelete(item) },
    ],
  }));

  // FLUX-1560: the date fragment applying to the month in view — a one-off
  // always shows its own start_date; a recurring cost shows the cadence-
  // extrapolated occurrence for the current month. Since FLUX-262,
  // nextOccurrence returns null once the recurring cadence's next occurrence
  // falls after end_date, so the `if (occurrence)` guard below is load-bearing
  // (not dead code) — it falls through to the "added {relative}" branch for
  // an ended recurring cost. Falls back to "added {relative}" from created_at
  // when there's no start_date at all. Both dates are null-guarded — local-first
  // inserts can have created_at null until server sync — so a row with neither
  // renders no fragment.
  const dateLabel = (() => {
    if (item.start_date) {
      const occurrence = isOneOff(item)
        ? parseLocalDateOnly(item.start_date)
        : nextOccurrence(item, new Date(new Date().getFullYear(), new Date().getMonth(), 1));
      if (occurrence) return costDateLabel(occurrence);
    }
    if (item.created_at) {
      const rel = timeAgo(item.created_at);
      if (rel) return `added ${rel}`;
    }
    return null;
  })();

  // Meta grammar (Hearth §6, H6): at most two fragments, so one middle dot.
  // A contract or discount ending within 30 days (or already ended) is the
  // status fragment and takes the date's place, tinted as a word; otherwise
  // the line is when · provider. The full dates live in the editor.
  // A line linked to Up payments says when it was last paid instead of its
  // date (core up-overview.ts), so the row answers "has this gone out yet?".
  const expirySoon = !!expiry && expiry.days <= 30;
  const paidAgo = bankLink?.lastPaidAt ? timeAgo(bankLink.lastPaidAt) : null;
  const metaParts: ReactNode[] = [];
  if (target) {
    // Out of the totals: the vendor lines the bank files carry the spend.
    metaParts.push(
      <span key="target" className="shrink-0">
        Target for the category
      </span>
    );
  } else if (paidInMonth != null && month) {
    metaParts.push(
      <span key="paid" className="shrink-0 tabular-nums text-success">
        Paid {formatMoney(paidInMonth)} in {monthLabel(`${month}-01`)}
      </span>
    );
  } else if (expirySoon) {
    metaParts.push(
      <span key="expiry" className={cn('shrink-0 tabular-nums', expiry.days < 0 ? 'text-destructive' : 'text-warning')}>
        {expiryLabel(expiry.label, expiry.days)}
      </span>
    );
  } else if (paidAgo) {
    metaParts.push(
      <span key="paid" className="shrink-0 tabular-nums text-success">
        Paid {paidAgo.toLowerCase()}
      </span>
    );
  } else if (dateLabel) {
    metaParts.push(
      <span key="date" className="shrink-0 tabular-nums">
        {dateLabel}
      </span>
    );
  }
  if (item.provider) {
    metaParts.push(
      <span key="provider" className="min-w-0 truncate">
        {item.provider}
      </span>
    );
  }

  // Portals (PC1-7): attachments + comments open in place (neutral); the
  // reminder leaves for Tasks (accent). A portal with nothing behind it yet
  // prints nothing on the row (PC7): the hold menu's Files and Comments rows
  // are how the first one gets added (task-row.tsx does the same).
  const portalChips: PortalChipDef[] = [];
  if ((docCount != null && docCount > 0) || expanded === 'docs') {
    portalChips.push({
      key: 'docs',
      icon: <Paperclip className="h-3 w-3" />,
      label: docCount != null && docCount > 0 ? `${docCount} file${docCount === 1 ? '' : 's'}` : 'Files',
      tone: 'neutral',
      onOpen: () => setExpanded((cur) => (cur === 'docs' ? null : 'docs')),
    });
  }
  if (commentCount.count > 0 || expanded === 'comments') {
    portalChips.push({
      key: 'comments',
      icon: <MessageSquare className="h-3 w-3" />,
      label: commentCount.count > 0 ? `${commentCount.count} comment${commentCount.count === 1 ? '' : 's'}` : 'Comments',
      tone: 'neutral',
      onOpen: () => setExpanded((cur) => (cur === 'comments' ? null : 'comments')),
    });
  }
  if (reminderLinked && reminderTaskId) {
    portalChips.push({
      key: 'reminder',
      icon: <CalendarClock className="h-3 w-3" />,
      label: 'Reminder',
      tone: 'accent',
      onOpen: () => router.push(`/tasks?focus=${reminderTaskId}`),
    });
  }

  return (
    <div>
      <ListItem
        expanded={!!expanded}
        holdProgress={longPress.progress}
        {...withRowMenu(longPress.handlers, rowMenu)}
        className={cn(
          'items-center gap-2.5 py-2.5 pr-3 pl-4 transition-colors select-none [-webkit-touch-callout:none]',
          'bg-card hover:bg-accent/50',
          selected && 'ring-1 ring-primary/60'
        )}
      >
        <ListItemLeading className="gap-1">
          {leading}

          {/* Category chip (Hearth §6 cost tenant): the category's glyph in a
              neutral chip, also the quick category menu. */}
          {!leading && (
          <PopMenu
            align="left"
            width="w-44"
            triggerLabel={`Category: ${cat.label}`}
            triggerClassName="flex items-center justify-center rounded-[9px] transition-opacity hover:opacity-80 flex-shrink-0"
            trigger={<CategoryGlyph category={item.category} />}
          >
            {(close) => (
              <>
                <MenuLabel>Category</MenuLabel>
                {categoryChoices.map((c) => {
                  const Icon = CATEGORY_ICON[c];
                  return (
                  <MenuItem
                    key={c}
                    active={item.category === c}
                    icon={<Icon className="h-3.5 w-3.5" />}
                    onClick={() => {
                      if (c !== item.category) patch({ category: c });
                      close();
                    }}
                  >
                    {CATEGORY_META[c].label}
                  </MenuItem>
                  );
                })}
              </>
            )}
          </PopMenu>
          )}
        </ListItemLeading>

        <ListItemContent>
          <ListItemTitle>
            <EditableText
              value={item.name}
              onCommit={(v) => { if (v.trim()) patch({ name: v.trim() }); }}
              hasChanged={(next, prev) => next.trim() !== prev}
              triggerClassName="truncate hover:text-primary transition-colors"
              inputClassName="w-full bg-muted border border-input rounded px-2 py-0.5 text-sm text-foreground"
              triggerTitle="Click to edit"
            >
              {item.name}
            </EditableText>
            {item.bank_source && (
              <span title="From Up" aria-label="From Up" className="flex-shrink-0 text-muted-foreground">
                <Landmark className="h-3 w-3" />
              </span>
            )}
            {item.is_estimate && (
              <span
                className={cn(
                  'text-[10px] uppercase font-medium rounded px-1.5 py-0.5 flex-shrink-0',
                  estimateCovered ? 'text-muted-foreground/60 bg-muted/50' : 'text-muted-foreground bg-muted'
                )}
                title={
                  estimateCovered
                    ? `Covered by ${formatMoney(estimateStepBack!.act)} in actual spend this month`
                    : estimatePartial
                      ? `${formatMoney(estimateStepBack!.act)} spent this month so far`
                      : undefined
                }
              >
                {estimateCovered ? 'covered' : estimatePartial ? `${formatMoney(estimateStepBack!.remaining)} left` : 'est'}
              </span>
            )}
          </ListItemTitle>

          {metaParts.length > 0 && (
            <ListItemMeta className="flex-nowrap">
              {metaParts.flatMap((part, i) =>
                i === 0
                  ? [part]
                  : [
                      <span key={`dot-${i}`} aria-hidden className="shrink-0 text-muted-foreground/40">
                        ·
                      </span>,
                      part,
                    ]
              )}
            </ListItemMeta>
          )}

          {portalChips.length > 0 && <PortalChipRow chips={portalChips} overflowTitle="More" className="mt-1" />}
        </ListItemContent>

        {/* Trailing: max two elements (H2) — amount+cadence reads as the one
            value, the payer avatar as the one identity. Overflow trigger is a
            control, not a third "element". */}
        <ListItemTrailing className="gap-2 text-sm">
          {/* Value: amount over its cadence word, one stacked unit so the row's
              content column keeps its width on a phone. */}
          <span className="flex flex-col items-end flex-shrink-0 leading-tight">
            <EditableText
              value={(item.amount / 100).toString()}
              onCommit={(v) => {
                const cents = Math.round(parseFloat(v || '0') * 100);
                patch({ amount: cents });
              }}
              hasChanged={(next) => Math.round(parseFloat(next || '0') * 100) !== item.amount}
              type="number"
              triggerClassName="font-semibold tabular-nums text-foreground hover:text-primary transition-colors"
              inputClassName="w-20 bg-muted border border-input rounded px-2 py-0.5 text-foreground text-right"
              triggerTitle="Click to edit amount"
            >
              {formatMoney(item.amount)}
            </EditableText>
            <PopMenu
              align="right"
              width="w-36"
              triggerLabel={`Cadence: ${CADENCE_LABEL[item.cadence]}`}
              triggerClassName="text-xs text-muted-foreground hover:text-foreground rounded -mr-1 px-1 hover:bg-muted transition-colors flex-shrink-0"
              trigger={CADENCE_LABEL[item.cadence]}
            >
              {(close) => (
                <>
                  <MenuLabel>Frequency</MenuLabel>
                  {CADENCE_OPTIONS.map((c) => (
                    <MenuItem
                      key={c}
                      active={item.cadence === c}
                      onClick={() => {
                        if (c !== item.cadence) patch({ cadence: c });
                        close();
                      }}
                    >
                      {CADENCE_LABEL[c]}
                    </MenuItem>
                  ))}
                </>
              )}
            </PopMenu>
          </span>

          {/* Assignee (who pays) */}
          <AssigneePicker
            value={item.assigned_to}
            groupMembers={groupMembers}
            memberProfiles={memberProfiles}
            onChange={(uid) => patch({ assigned_to: uid || null })}
          />

          {/* Overflow — quick-edit amount/cadence/category, files, edit / delete.
              Also the hold-to-edit target (FLUX-198): hold opens this same menu
              as a bottom sheet on touch. FLUX-239: enriched with the same
              amount/cadence/category controls as the full edit modal so common
              edits don't need the modal round-trip. */}
          <PopMenu
            align="right"
            width="w-72"
            triggerClassName={iconBtn}
            triggerLabel="More actions"
            trigger={<MoreHorizontal className="h-4 w-4" />}
            open={holdMenuOpen}
            onOpenChange={setHoldMenuOpen}
            mobileSheet
            previewContent={
              <>
                <CategoryGlyph category={item.category} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{item.name}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                  {formatMoney(item.amount)}
                </span>
              </>
            }
          >
            {(close) => (
              <>
                <MenuLabel>Amount</MenuLabel>
                <div className="px-3.5 pb-2.5">
                  <DragNumberField
                    value={item.amount / 100}
                    onChange={(v) => patch({ amount: Math.round((v ?? 0) * 100) })}
                    step={1}
                    min={0}
                    precision={2}
                    prefix={currencySymbol()}
                    placeholder="0.00"
                    ariaLabel="Amount"
                  />
                </div>

                <MenuLabel>Cadence</MenuLabel>
                <div className="px-3.5 pb-2.5">
                  <SegmentedControl
                    options={CADENCE_SEGMENTS}
                    value={item.cadence}
                    onChange={(cadence) => patch({ cadence })}
                    wrap
                    size="sm"
                    ariaLabel="Cadence"
                  />
                </div>

                <MenuLabel>Category</MenuLabel>
                <div className="px-3.5 pb-2.5">
                  <SearchablePicker
                    options={categoryChoices.map((c) => ({ value: c, primary: CATEGORY_META[c].label }))}
                    value={item.category}
                    onChange={(category) => patch({ category: category as CostCategory })}
                    placeholder="Category…"
                    searchPlaceholder="Search…"
                    ariaLabel="Category"
                  />
                </div>

                <MenuDivider />
                <MenuItem
                  icon={<Paperclip className="h-3.5 w-3.5" />}
                  trailing={
                    <span className="text-xs text-muted-foreground">
                      {docCount != null && docCount > 0 ? docCount : 'Add'}
                    </span>
                  }
                  onClick={() => {
                    setExpanded('docs');
                    close();
                  }}
                >
                  Files
                </MenuItem>
                <MenuItem
                  icon={<MessageSquare className="h-3.5 w-3.5" />}
                  trailing={<span className="text-xs text-muted-foreground">{commentCount.count > 0 ? commentCount.count : 'Add'}</span>}
                  onClick={() => {
                    setExpanded('comments');
                    close();
                  }}
                >
                  Comments
                </MenuItem>
                <MenuDivider />
                <MenuItem
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  onClick={() => {
                    onEdit(item);
                    close();
                  }}
                >
                  Edit details
                </MenuItem>
                <MenuDivider />
                <MenuItem
                  danger
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => {
                    onRequestDelete(item);
                    close();
                  }}
                >
                  Delete
                </MenuItem>
              </>
            )}
          </PopMenu>
        </ListItemTrailing>
      </ListItem>
      {rowMenu.menu}

      {/* Expandable: documents or comments */}
      {expanded && (
        <ListItemBody expanded={!!expanded}>
          {expanded === 'docs' ? (
            <div className="space-y-2">
              <CostDocuments costItemId={item.id} groupId={groupId} onCountChange={() => setDocsBump((b) => b + 1)} />
              {/* FLUX-105: documents linked from the central store (coexists with legacy above) */}
              {docsLinked && (
                <LinkedDocuments entityType="cost_item" entityId={item.id} onCountChange={() => setDocsBump((b) => b + 1)} />
              )}
            </div>
          ) : (
            <EntityComments table="cost_item_comments" fkColumn="cost_item_id" entityId={item.id} onChanged={commentCount.refresh} />
          )}
        </ListItemBody>
      )}
    </div>
  );
}
