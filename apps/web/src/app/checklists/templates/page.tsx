'use client';

// FLUX-156: Checklists section — group-shared checklist templates manager.
//
// Lists every group template (seeded starters + user-authored), and lets the
// group create / edit / delete them. Templates are the reusable blueprints the
// rest of the Checklists section instantiates into live runs. Data is local-first
// + group-scoped via the Legend-State stores (offline-durable writes, IndexedDB
// persistence, Supabase sync) — the same proven pattern as /groceries (FLUX-149).

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { use$ } from '@legendapp/state/react';
import { checklistTemplates$, checklistTemplateItems$, useReconnectSync, useStoreHelpers, useModules, currencySymbol } from '@homeup/core';
import { dialog } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import type { ChecklistTemplate, ChecklistTemplateItem, ChecklistType } from '@homeup/core';
import {
  typeMeta,
  typeDescription,
  CHECKLIST_TYPES,
  buildTemplate,
  buildTemplateItem,
  seedStarterTemplates,
  dollarsToCents,
  centsToDollars,
} from '@homeup/core';
import {
  Plus,
  Trash2,
  X,
  ListChecks,
  ChevronUp,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { HeroLede } from '@/components/ui/hero-lede';
import { LeadingTile } from '@/components/ui/leading-tile';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  ListItem,
  ListGroup,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
} from '@/components/ui/list-item';
import { checklistTypeIcon } from '../checklist-ui';

// A local draft row inside the editor. `existingId` is the store row id when the
// item already exists (so save can patch/soft-delete it); null for a fresh item.
interface DraftItem {
  key: string;
  existingId: string | null;
  label: string;
  /** Dollars as typed in the input; converted to integer cents on save. */
  costDollars: string;
}

export default function ChecklistTemplatesPage() {
  const { group, currentUserId } = useDataCache();

  const templates$ = checklistTemplates$(group?.id);
  const templateItems$ = checklistTemplateItems$(group?.id);

  // Reactive derived arrays — SELECTOR form of use$ so add/edit/soft-delete
  // re-render (reading the observable directly returns a stable proxy that
  // wouldn't trip a downstream memo — the FLUX-149 offline-write gotcha).
  const templates = use$(() =>
    Object.values(templates$.get() ?? {})
      .filter((t): t is ChecklistTemplate => !!t && !t.deleted)
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')),
  );
  const items = use$(() =>
    Object.values(templateItems$.get() ?? {}).filter(
      (i): i is ChecklistTemplateItem => !!i && !i.deleted,
    ),
  );

  useReconnectSync(templates$);
  useReconnectSync(templateItems$);

  const {
    writeRow: writeTemplate,
    patchRow: patchTemplate,
    softDeleteRow: softDeleteTemplate,
  } = useStoreHelpers(templates$, currentUserId);
  const {
    writeRow: writeTemplateItem,
    patchRow: patchTemplateItem,
    softDeleteRow: softDeleteTemplateItem,
  } = useStoreHelpers(templateItems$, currentUserId);

  // Live items grouped by template for counts + editor hydration.
  const itemsByTemplate = useMemo(() => {
    const map = new Map<string, ChecklistTemplateItem[]>();
    for (const it of items) {
      const list = map.get(it.template_id) ?? [];
      list.push(it);
      map.set(it.template_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [items]);

  // ── Idempotent starter seeding ────────────────────────────────────────────
  // Runs once per group after the store has loaded. seedStarterTemplates only
  // writes starters missing by template_key, so re-running is safe.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!group?.id) return;
    if (seededRef.current === group.id) return;
    seededRef.current = group.id;
    seedStarterTemplates({
      existing: templates,
      groupId: group.id,
      createdBy: currentUserId,
      writeTemplate,
      writeTemplateItem,
    });
    // Intentionally not depending on `templates` — we seed once per group and
    // rely on idempotency-by-template_key rather than re-running on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, currentUserId]);

  // ── Editor state ──────────────────────────────────────────────────────────
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setEditorOpen(true);
  };
  const openEdit = (id: string) => {
    setEditingId(id);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    setEditingId(null);
  };

  const editingTemplate = useMemo(
    () => (editingId ? templates.find((t) => t.id === editingId) ?? null : null),
    [editingId, templates],
  );
  const editingItems = useMemo(
    () => (editingId ? itemsByTemplate.get(editingId) ?? [] : []),
    [editingId, itemsByTemplate],
  );

  const handleDelete = useCallback(
    async (tpl: ChecklistTemplate) => {
      const confirmed = await dialog.confirm({
        title: `Delete template “${tpl.title}”?`,
        message: "This can't be undone.",
        destructive: true,
      });
      if (!confirmed) return;
      (itemsByTemplate.get(tpl.id) ?? []).forEach((it) => softDeleteTemplateItem(it.id));
      softDeleteTemplate(tpl.id);
      setEditorOpen(false);
      setEditingId(null);
    },
    [itemsByTemplate, softDeleteTemplate, softDeleteTemplateItem],
  );

  const handleSave = useCallback(
    (draft: {
      title: string;
      defaultType: ChecklistType;
      cadenceDays: number | null;
      items: DraftItem[];
    }) => {
      if (!group?.id) return;
      const cadence = draft.defaultType === 'repeating' ? draft.cadenceDays : null;

      if (editingTemplate) {
        // Update metadata in place.
        patchTemplate(editingTemplate.id, {
          title: draft.title.trim(),
          default_type: draft.defaultType,
          default_cadence_days: cadence,
        });
        // Diff items: patch survivors, insert new, soft-delete removed.
        const keptIds = new Set(
          draft.items.map((d) => d.existingId).filter((id): id is string => !!id),
        );
        editingItems.forEach((it) => {
          if (!keptIds.has(it.id)) softDeleteTemplateItem(it.id);
        });
        draft.items.forEach((d, idx) => {
          const cost = draft.defaultType === 'shopping' ? dollarsToCents(d.costDollars) : null;
          if (d.existingId) {
            patchTemplateItem(d.existingId, {
              label: d.label.trim(),
              order: idx,
              default_cost_cents: cost,
            });
          } else {
            writeTemplateItem(
              buildTemplateItem({
                templateId: editingTemplate.id,
                groupId: group.id,
                label: d.label.trim(),
                order: idx,
                defaultCostCents: cost,
              }),
            );
          }
        });
      } else {
        // Create a new template + its items.
        const tpl = buildTemplate({
          groupId: group.id,
          title: draft.title.trim(),
          defaultType: draft.defaultType,
          defaultCadenceDays: cadence,
          createdBy: currentUserId,
        });
        writeTemplate(tpl);
        draft.items
          .filter((d) => d.label.trim())
          .forEach((d, idx) =>
            writeTemplateItem(
              buildTemplateItem({
                templateId: tpl.id,
                groupId: group.id,
                label: d.label.trim(),
                order: idx,
                defaultCostCents:
                  draft.defaultType === 'shopping' ? dollarsToCents(d.costDollars) : null,
              }),
            ),
          );
      }
      closeEditor();
    },
    [
      group?.id,
      currentUserId,
      editingTemplate,
      editingItems,
      patchTemplate,
      patchTemplateItem,
      writeTemplate,
      writeTemplateItem,
      softDeleteTemplateItem,
    ],
  );

  // Known (not fixed here): this page renders "No group selected" on the
  // server and the list on the client for a returning visitor, a hydration
  // mismatch rooted in the shared data cache's first render.
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  return (
    <div className="space-y-5 p-4 md:p-6 max-w-3xl mx-auto pb-28">
      {/* Hearth v2 (H1): the template count is the lede; New template sits
          beside it, the screen's one primary action. */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <HeroLede
          value={templates.length}
          label={templates.length === 1 ? 'template' : 'templates'}
          caption="Shared with your group"
        />
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New template
        </button>
      </div>

      {/* Empty state (§11): centered, one headline, one line; the header's
          New template stays the one CTA. */}
      {templates.length === 0 && (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <div className="rounded-2xl bg-primary/10 p-5">
            <ListChecks className="h-7 w-7 text-primary" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">No templates yet</h2>
            <p className="max-w-[280px] text-sm text-muted-foreground">Starters are on their way, or create your own.</p>
          </div>
        </div>
      )}

      {/* Template list: one list card (H4). Tap a row to edit it; Delete
          lives in the editor (E4), not as a resting row icon (§6). */}
      {templates.length > 0 && (
        <ListGroup>
          {templates.map((tpl) => {
            const meta = typeMeta(tpl.default_type ?? 'plain');
            const count = (itemsByTemplate.get(tpl.id) ?? []).length;
            const cadence = tpl.default_type === 'repeating' ? tpl.default_cadence_days : null;
            return (
              <ListItem key={tpl.id} asChild>
                <button type="button" onClick={() => openEdit(tpl.id)} aria-label={`Edit ${tpl.title}`}>
                  <LeadingTile sectionId="checklists" Icon={checklistTypeIcon(tpl.default_type)} size="md" />
                  <ListItemContent>
                    <ListItemTitle>
                      <span className="truncate">{tpl.title}</span>
                    </ListItemTitle>
                    {/* One dot: the type (a repeating one says its cadence
                        instead), then the item count. */}
                    <ListItemMeta>
                      <span className="tabular-nums">
                        {cadence != null ? `Every ${cadence === 1 ? 'day' : `${cadence} days`}` : meta.label} · {count}{' '}
                        {count === 1 ? 'item' : 'items'}
                      </span>
                    </ListItemMeta>
                  </ListItemContent>
                  <ListItemTrailing>
                    <ChevronRight className="h-4 w-4" />
                  </ListItemTrailing>
                </button>
              </ListItem>
            );
          })}
        </ListGroup>
      )}

      {editorOpen && (
        <TemplateEditor
          key={editingId ?? 'new'}
          template={editingTemplate}
          items={editingItems}
          onClose={closeEditor}
          onSave={handleSave}
          onDelete={editingTemplate ? () => handleDelete(editingTemplate) : undefined}
        />
      )}
    </div>
  );
}

// ── Editor modal ──────────────────────────────────────────────────────────────
function TemplateEditor({
  template,
  items,
  onClose,
  onSave,
  onDelete,
}: {
  template: ChecklistTemplate | null;
  items: ChecklistTemplateItem[];
  onClose: () => void;
  onSave: (draft: {
    title: string;
    defaultType: ChecklistType;
    cadenceDays: number | null;
    items: DraftItem[];
  }) => void;
  /** E4: delete sits alone at the end of the editor (existing templates only). */
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(template?.title ?? '');
  const [defaultType, setDefaultType] = useState<ChecklistType>(template?.default_type ?? 'plain');
  // Modules: type descriptions mention the dashboard only with Tasks and
  // Checklists, and logging a purchase only with Costs and Checklists (module-features.ts).
  const modules = useModules();
  const describe = (t: ChecklistType) =>
    typeDescription(t, {
      linkedTask: modules.feature('tasks.checklists'),
      logCosts: modules.feature('costs.from-checklists'),
    });
  const [cadence, setCadence] = useState<string>(
    template?.default_cadence_days != null ? String(template.default_cadence_days) : '7',
  );
  const [draftItems, setDraftItems] = useState<DraftItem[]>(() =>
    items.map((it) => ({
      key: it.id,
      existingId: it.id,
      label: it.label,
      costDollars: centsToDollars(it.default_cost_cents),
    })),
  );

  const field =
    'w-full rounded bg-muted border border-border px-3 py-2 text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:border-ring';
  const labelCls = 'block text-sm font-medium text-foreground';

  const addItem = () =>
    setDraftItems((prev) => [
      ...prev,
      { key: crypto.randomUUID(), existingId: null, label: '', costDollars: '' },
    ]);
  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    setDraftItems((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const removeItem = (key: string) =>
    setDraftItems((prev) => prev.filter((d) => d.key !== key));
  const moveItem = (key: string, dir: -1 | 1) =>
    setDraftItems((prev) => {
      const idx = prev.findIndex((d) => d.key === key);
      const next = idx + dir;
      if (idx === -1 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });

  const canSave = title.trim().length > 0;

  const submit = () => {
    if (!canSave) return;
    const parsedCadence = defaultType === 'repeating' ? Number(cadence) : null;
    onSave({
      title,
      defaultType,
      cadenceDays: parsedCadence != null && Number.isFinite(parsedCadence) && parsedCadence > 0
        ? Math.round(parsedCadence)
        : null,
      items: draftItems.filter((d) => d.label.trim()),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-card ring-1 ring-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/[0.06] bg-card/95 backdrop-blur px-5 py-3.5">
          <h2 className="text-lg font-semibold text-card-foreground">
            {template ? 'Edit template' : 'New template'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Title */}
          <div>
            <label className={labelCls} htmlFor="tpl-title">
              Title
            </label>
            <input
              id="tpl-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekly reset, Trip packing…"
              autoFocus
              maxLength={80}
              className={`mt-1 ${field}`}
            />
          </div>

          {/* Default type */}
          <div>
            <span className={labelCls}>Default type</span>
            <SegmentedControl
              className="mt-1.5"
              options={CHECKLIST_TYPES.map((t) => {
                const Icon = checklistTypeIcon(t);
                return { value: t, label: typeMeta(t).label, icon: <Icon className="h-3.5 w-3.5" /> };
              })}
              value={defaultType}
              onChange={setDefaultType}
              ariaLabel="Default type"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">{describe(defaultType)}</p>
          </div>

          {/* Cadence (repeating only) */}
          {defaultType === 'repeating' && (
            <div>
              <label className={labelCls} htmlFor="tpl-cadence">
                Renews every (days)
              </label>
              <input
                id="tpl-cadence"
                type="number"
                min={1}
                value={cadence}
                onChange={(e) => setCadence(e.target.value)}
                placeholder="7"
                className={`mt-1 w-32 ${field}`}
              />
            </div>
          )}

          {/* Items */}
          <div>
            <div className="flex items-center justify-between">
              <span className={labelCls}>Items</span>
              <span className="text-xs text-muted-foreground">{draftItems.length}</span>
            </div>
            <div className="mt-2 space-y-2">
              {draftItems.map((d, idx) => (
                <div
                  key={d.key}
                  className="flex items-center gap-2 rounded-xl bg-muted/50 px-2 py-1.5"
                >
                  {/* Reorder shows on every width (the phone used to get a
                      grip glyph with no drag behind it); the pair splits the
                      row's height between two targets, matching native. */}
                  <div className="flex shrink-0 flex-col text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => moveItem(d.key, -1)}
                      disabled={idx === 0}
                      className="inline-flex h-5 w-8 items-center justify-center rounded hover:bg-accent hover:text-foreground disabled:opacity-30"
                      title="Move up"
                      aria-label="Move item up"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(d.key, 1)}
                      disabled={idx === draftItems.length - 1}
                      className="inline-flex h-5 w-8 items-center justify-center rounded hover:bg-accent hover:text-foreground disabled:opacity-30"
                      title="Move down"
                      aria-label="Move item down"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={d.label}
                    onChange={(e) => updateItem(d.key, { label: e.target.value })}
                    placeholder="Item label…"
                    className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  {defaultType === 'shopping' && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-muted-foreground text-sm">{currencySymbol()}</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={d.costDollars}
                        onChange={(e) => updateItem(d.key, { costDollars: e.target.value })}
                        placeholder="0.00"
                        className="h-9 w-20 rounded-lg bg-background px-2 text-sm tabular-nums text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(d.key)}
                    className="-mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                    title="Remove item"
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addItem}
              className="mt-1 flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add item
            </button>
          </div>

          {onDelete && (
            <div className="border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={onDelete}
                className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-destructive hover:text-destructive/80"
              >
                <Trash2 className="h-4 w-4" />
                Delete template
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex gap-2 border-t border-white/[0.06] bg-card/95 backdrop-blur px-5 py-3.5">
          <button
            onClick={submit}
            disabled={!canSave}
            className="h-11 flex-1 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {template ? 'Save changes' : 'Create template'}
          </button>
          <button
            onClick={onClose}
            className="h-11 px-4 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
