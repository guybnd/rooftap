"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { use$ } from "@legendapp/state/react";
import { apartmentChecklistItems$, useReconnectSync, useStoreHelpers, useStoreLoaded } from "@homeup/core";
import type { ChecklistItem } from '@homeup/core';
import { compareStrings } from '@homeup/core';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  PlusIcon,
  GripVerticalIcon,
  TrashIcon,
  PencilIcon,
  ChevronDownIcon,
  ShieldAlertIcon,
  SparklesIcon,
  ArrowUpDownIcon,
  CheckSquareIcon,
  WeightIcon,
  ArrowDownAZIcon,
  ListOrderedIcon,
  XIcon,
  InfoIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ItemFormData {
  label: string;
  category: string;
  weight: number;
  is_dealbreaker: boolean;
  is_bonus: boolean;
}

type SortMode = "custom" | "weight" | "alpha";

const EMPTY_FORM: ItemFormData = {
  label: "",
  category: "",
  weight: 5,
  is_dealbreaker: false,
  is_bonus: false,
};

// ─── Main Component ──────────────────────────────────────────────────────────

// FLUX-150 slice 6: reads/writes through Legend (apartmentChecklistItems$)
// instead of useDataCache()'s fetchAll()/direct Supabase calls.
export function ChecklistPanel({ groupId }: { groupId: string }) {
  const items$ = apartmentChecklistItems$(groupId);
  useReconnectSync(items$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(items$, null);
  const storeLoaded = useStoreLoaded(items$);

  const items = use$(() =>
    Object.values(items$.get() ?? {}).filter((i): i is ChecklistItem => !!i && !i.deleted)
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemFormData>(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>("custom");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState<{ weight?: number; category?: string; is_dealbreaker?: boolean; is_bonus?: boolean }>({});
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Live-reordered snapshot while a drag is in progress — the store's `items`
  // (and thus its `order`) is only patched on drop (handleDragEnd), so
  // dragging doesn't fire a write per dragover.
  const [dragItems, setDragItems] = useState<ChecklistItem[] | null>(null);

  const displayItems = dragItems ?? items;

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(),
    [items]
  );

  const sortedItems = useMemo(() => {
    const sorted = [...displayItems];
    switch (sortMode) {
      case "weight":
        return sorted.sort((a, b) => b.weight - a.weight || a.order - b.order);
      case "alpha":
        return sorted.sort((a, b) => compareStrings(a.label, b.label));
      default:
        return sorted.sort((a, b) => a.order - b.order);
    }
  }, [displayItems, sortMode]);

  const groupedItems = useMemo(() => {
    if (categories.length === 0) {
      return [{ category: "", items: sortedItems }];
    }
    const groups = categories.map((cat) => ({
      category: cat,
      items: sortedItems.filter((i) => i.category === cat),
    }));
    const uncategorized = sortedItems.filter((i) => !i.category);
    if (uncategorized.length > 0) {
      groups.push({ category: "", items: uncategorized });
    }
    return groups.filter((g) => g.items.length > 0);
  }, [sortedItems, categories]);

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleBulkItem = (id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllInCategory = (cat: string) => {
    const catItems = items.filter((i) => (cat === "" ? !i.category : i.category === cat));
    setBulkSelected((prev) => {
      const next = new Set(prev);
      const allSelected = catItems.every((i) => next.has(i.id));
      if (allSelected) {
        catItems.forEach((i) => next.delete(i.id));
      } else {
        catItems.forEach((i) => next.add(i.id));
      }
      return next;
    });
  };

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (item: ChecklistItem) => {
    setEditingId(item.id);
    setForm({
      label: item.label,
      category: item.category,
      weight: item.weight,
      is_dealbreaker: item.is_dealbreaker,
      is_bonus: item.is_bonus,
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.label.trim()) return;

    if (editingId) {
      patchRow(editingId, {
        label: form.label.trim(),
        category: form.category.trim(),
        weight: form.weight,
        is_dealbreaker: form.is_dealbreaker,
        is_bonus: form.is_bonus,
      });
    } else {
      const maxOrder = items.length > 0 ? Math.max(...items.map((i) => i.order)) + 1 : 0;
      writeRow({
        id: crypto.randomUUID(),
        group_id: groupId,
        label: form.label.trim(),
        category: form.category.trim(),
        weight: form.weight,
        is_dealbreaker: form.is_dealbreaker,
        is_bonus: form.is_bonus,
        order: maxOrder,
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      } as ChecklistItem);
    }

    setDialogOpen(false);
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm((cur) => (cur === id ? null : cur)), 3000);
      return;
    }
    setDeleteConfirm(null);
    softDeleteRow(id);
    setBulkSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };

  // ─── Bulk Edit ───────────────────────────────────────────────────────────────

  const handleBulkSave = () => {
    if (bulkSelected.size === 0) return;

    const updates: Partial<ChecklistItem> = {};
    if (bulkForm.weight !== undefined) updates.weight = bulkForm.weight;
    if (bulkForm.category !== undefined) updates.category = bulkForm.category;
    if (bulkForm.is_dealbreaker !== undefined) {
      updates.is_dealbreaker = bulkForm.is_dealbreaker;
      if (bulkForm.is_dealbreaker) updates.is_bonus = false;
    }
    if (bulkForm.is_bonus !== undefined) {
      updates.is_bonus = bulkForm.is_bonus;
      if (bulkForm.is_bonus) updates.is_dealbreaker = false;
    }

    if (Object.keys(updates).length === 0) { setBulkDialogOpen(false); return; }

    for (const id of bulkSelected) {
      patchRow(id, updates);
    }
    setBulkDialogOpen(false);
    setBulkForm({});
  };

  const handleBulkDelete = () => {
    if (bulkSelected.size === 0) return;
    for (const id of bulkSelected) {
      softDeleteRow(id);
    }
    setBulkSelected(new Set());
    setBulkMode(false);
  };

  // ─── Drag & Drop ────────────────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    if (sortMode !== "custom") return;
    setDragItems([...items].sort((a, b) => a.order - b.order));
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (sortMode !== "custom" || dragIndex === null || dragIndex === targetIdx || !dragItems) return;

    const draggedItem = dragItems[dragIndex];
    const newSorted = dragItems.filter((_, i) => i !== dragIndex);
    newSorted.splice(targetIdx, 0, draggedItem);

    const reordered = newSorted.map((item, i) => ({ ...item, order: i }));
    setDragItems(reordered);
    setDragIndex(targetIdx);
  };

  const handleDragEnd = () => {
    const finalOrder = dragItems;
    setDragIndex(null);
    setDragItems(null);
    if (sortMode !== "custom" || !finalOrder) return;
    for (const item of finalOrder) {
      const original = items.find((i) => i.id === item.id);
      if (original && original.order !== item.order) {
        patchRow(item.id, { order: item.order });
      }
    }
  };

  // ─── Inline Update ────────────────────────────────────────────────────────────

  const handleInlineUpdate = useCallback((id: string, updates: Partial<Pick<ChecklistItem, "label" | "weight" | "is_dealbreaker" | "is_bonus">>) => {
    patchRow(id, updates);
  }, [patchRow]);

  // ─── Stats ───────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const dealbreakers = items.filter((i) => i.is_dealbreaker).length;
    const bonuses = items.filter((i) => i.is_bonus).length;
    const required = items.length - dealbreakers - bonuses;
    return { total: items.length, dealbreakers, bonuses, required };
  }, [items]);

  // ─── Tutorial dismiss ─────────────────────────────────────────────────────────

  const [showTutorial, setShowTutorial] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("homeup-checklist-tutorial-dismissed") !== "1";
  });

  const dismissTutorial = () => {
    setShowTutorial(false);
    localStorage.setItem("homeup-checklist-tutorial-dismissed", "1");
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (!storeLoaded && items.length === 0) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 rounded-lg bg-muted" />
        <div className="h-4 w-72 rounded bg-muted" />
        <div className="h-64 rounded-xl bg-muted/50" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Tutorial */}
      {showTutorial && <TutorialCard onDismiss={dismissTutorial} />}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Checklist</h1>
          <div className="flex items-center gap-3 mt-1.5">
            <StatPill label="Items" value={stats.total} />
            <StatPill label="Required" value={stats.required} />
            {stats.dealbreakers > 0 && <StatPill label="Dealbreakers" value={stats.dealbreakers} variant="destructive" />}
            {stats.bonuses > 0 && <StatPill label="Bonus" value={stats.bonuses} variant="primary" />}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant={bulkMode ? "secondary" : "outline"}
            size="sm"
            onClick={() => { setBulkMode(!bulkMode); setBulkSelected(new Set()); }}
          >
            <CheckSquareIcon className="size-3.5" />
            {bulkMode ? "Done" : "Select"}
          </Button>
          <SortDropdown value={sortMode} onChange={setSortMode} />
          <Button size="sm" onClick={openCreate}>
            <PlusIcon className="size-3.5" />
            Add
          </Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {bulkMode && bulkSelected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 stagger-fade-in">
          <span className="text-sm font-medium">
            <span className="font-mono tabular-nums">{bulkSelected.size}</span> selected
          </span>
          <div className="flex-1" />
          <Button size="xs" variant="outline" onClick={() => setBulkDialogOpen(true)}>
            <PencilIcon className="size-3" />
            Edit
          </Button>
          <Button size="xs" variant="destructive" onClick={handleBulkDelete}>
            <TrashIcon className="size-3" />
            Delete
          </Button>
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 py-16 text-center">
          <div className="mx-auto mb-3 size-10 rounded-full bg-muted/60 flex items-center justify-center">
            <PlusIcon className="size-5 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground text-sm">No checklist items yet.</p>
          <p className="text-muted-foreground/60 text-xs mt-1">Add your first item to start scoring apartments.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groupedItems.map((group, gi) => (
            <CategorySection
              key={group.category || "__uncategorized"}
              category={group.category}
              items={group.items}
              allItems={displayItems}
              collapsed={collapsedCategories.has(group.category || "__uncategorized")}
              onToggle={() => toggleCategory(group.category || "__uncategorized")}
              bulkMode={bulkMode}
              bulkSelected={bulkSelected}
              onBulkToggle={toggleBulkItem}
              onSelectAll={() => selectAllInCategory(group.category)}
              onEdit={openEdit}
              onDelete={handleDelete}
              onInlineUpdate={handleInlineUpdate}
              deleteConfirm={deleteConfirm}
              sortMode={sortMode}
              dragIndex={dragIndex}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              index={gi}
            />
          ))}
        </div>
      )}

      {/* Item dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Item" : "New Item"}</DialogTitle>
          </DialogHeader>
          <ItemForm form={form} setForm={setForm} categories={categories} />
          <DialogFooter>
            <Button onClick={handleSave} disabled={!form.label.trim()}>
              {editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk edit dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {bulkSelected.size} items</DialogTitle>
          </DialogHeader>
          <BulkEditForm form={bulkForm} setForm={setBulkForm} categories={categories} />
          <DialogFooter>
            <Button onClick={handleBulkSave}>
              Apply Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tutorial Card ───────────────────────────────────────────────────────────

function TutorialCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="relative rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3.5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <InfoIcon className="size-4 text-primary shrink-0" />
            <span className="text-[13px] font-medium">How the checklist works</span>
          </div>
          <button
            onClick={onDismiss}
            className="text-muted-foreground/50 hover:text-foreground transition-colors p-0.5 -m-0.5 rounded"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>

        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Each item you add contributes to an apartment&apos;s score when you evaluate it. Click any field directly to edit it inline.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="flex items-start gap-2 rounded-lg bg-muted/20 border border-border/30 px-2.5 py-2">
            <span className="inline-flex items-center justify-center w-[42px] shrink-0 rounded-md bg-muted/40 border border-border/40 py-[2px]">
              <span className="text-[9px] font-medium text-muted-foreground">Req</span>
            </span>
            <div>
              <p className="text-[11px] font-medium">Required</p>
              <p className="text-[10px] text-muted-foreground/70 leading-snug mt-0.5">Counts toward the score. Answering &quot;no&quot; lowers the percentage.</p>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-destructive/4 border border-destructive/10 px-2.5 py-2">
            <span className="inline-flex items-center justify-center w-[42px] shrink-0 gap-[2px] rounded-md bg-destructive/8 border border-destructive/15 py-[2px]">
              <ShieldAlertIcon className="size-2.5 text-destructive" />
              <span className="text-[8px] font-bold text-destructive">DB</span>
            </span>
            <div>
              <p className="text-[11px] font-medium text-destructive">Dealbreaker</p>
              <p className="text-[10px] text-muted-foreground/70 leading-snug mt-0.5">Apartment instantly scores 0% if this item fails.</p>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-primary/4 border border-primary/10 px-2.5 py-2">
            <span className="inline-flex items-center justify-center w-[42px] shrink-0 gap-[2px] rounded-md bg-primary/8 border border-primary/15 py-[2px]">
              <SparklesIcon className="size-2.5 text-primary" />
              <span className="text-[8px] font-bold text-primary">+</span>
            </span>
            <div>
              <p className="text-[11px] font-medium text-primary">Bonus</p>
              <p className="text-[10px] text-muted-foreground/70 leading-snug mt-0.5">Only boosts the score when present. No penalty when missing.</p>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground/50">
          Click the type badge to cycle between types. Click the weight bar to adjust importance (1-10).
        </p>
      </div>
    </div>
  );
}

// ─── Stat Pill ───────────────────────────────────────────────────────────────

function StatPill({ label, value, variant }: { label: string; value: number; variant?: "destructive" | "primary" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 text-xs tabular-nums",
      variant === "destructive" ? "text-destructive" :
      variant === "primary" ? "text-primary" :
      "text-muted-foreground"
    )}>
      <span className={cn(
        "size-1.5 rounded-full",
        variant === "destructive" ? "bg-destructive" :
        variant === "primary" ? "bg-primary" :
        "bg-muted-foreground/50"
      )} />
      <span className="font-mono font-medium">{value}</span>
      <span className="opacity-70">{label}</span>
    </span>
  );
}

// ─── Sort Dropdown ───────────────────────────────────────────────────────────

function SortDropdown({ value, onChange }: { value: SortMode; onChange: (v: SortMode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const options: { value: SortMode; label: string; icon: React.ReactNode }[] = [
    { value: "custom", label: "Custom Order", icon: <ListOrderedIcon className="size-3.5" /> },
    { value: "weight", label: "Highest Weight", icon: <WeightIcon className="size-3.5" /> },
    { value: "alpha", label: "A to Z", icon: <ArrowDownAZIcon className="size-3.5" /> },
  ];

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
        <ArrowUpDownIcon className="size-3.5" />
        <span className="hidden sm:inline">{options.find((o) => o.value === value)?.label}</span>
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-lg border border-border/80 bg-popover p-1 shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors",
                value === opt.value
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-foreground/80 hover:bg-muted/60"
              )}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Category Section ────────────────────────────────────────────────────────

function CategorySection({
  category,
  items,
  allItems,
  collapsed,
  onToggle,
  bulkMode,
  bulkSelected,
  onBulkToggle,
  onSelectAll,
  onEdit,
  onDelete,
  onInlineUpdate,
  deleteConfirm,
  sortMode,
  dragIndex,
  onDragStart,
  onDragOver,
  onDragEnd,
  index,
}: {
  category: string;
  items: ChecklistItem[];
  allItems: ChecklistItem[];
  collapsed: boolean;
  onToggle: () => void;
  bulkMode: boolean;
  bulkSelected: Set<string>;
  onBulkToggle: (id: string) => void;
  onSelectAll: () => void;
  onEdit: (item: ChecklistItem) => void;
  onDelete: (id: string) => void;
  onInlineUpdate: (id: string, updates: Partial<Pick<ChecklistItem, "label" | "weight" | "is_dealbreaker" | "is_bonus">>) => void;
  deleteConfirm: string | null;
  sortMode: SortMode;
  dragIndex: number | null;
  onDragStart: (e: React.DragEvent, idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDragEnd: () => void;
  index: number;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [items]);

  const allSelected = items.length > 0 && items.every((i) => bulkSelected.has(i.id));
  const categoryLabel = category || "Uncategorized";
  const dealbreakers = items.filter((i) => i.is_dealbreaker).length;
  const bonuses = items.filter((i) => i.is_bonus).length;

  return (
    <div
      className="rounded-xl border border-border/60 bg-card overflow-hidden"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Category header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/20 active:bg-muted/30"
      >
        {bulkMode && (
          <span
            onClick={(e) => { e.stopPropagation(); onSelectAll(); }}
            className={cn(
              "flex size-[15px] items-center justify-center rounded-[4px] border transition-all shrink-0",
              allSelected
                ? "border-primary bg-primary text-primary-foreground scale-105"
                : "border-muted-foreground/30 hover:border-muted-foreground/60"
            )}
          >
            {allSelected && <CheckIcon className="size-2.5" />}
          </span>
        )}
        <ChevronDownIcon
          className={cn(
            "size-3.5 text-muted-foreground transition-transform duration-200 ease-out",
            collapsed && "-rotate-90"
          )}
        />
        <span className="font-medium text-[13px] flex-1 truncate">{categoryLabel}</span>

        {/* Category meta badges */}
        <div className="flex items-center gap-1.5 shrink-0">
          {dealbreakers > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] px-1.5 py-px rounded-md bg-destructive/10 text-destructive border border-destructive/15">
              <ShieldAlertIcon className="size-2.5" />
              <span className="font-mono tabular-nums">{dealbreakers}</span>
            </span>
          )}
          {bonuses > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] px-1.5 py-px rounded-md bg-primary/10 text-primary border border-primary/15">
              <SparklesIcon className="size-2.5" />
              <span className="font-mono tabular-nums">{bonuses}</span>
            </span>
          )}
          <span className="font-mono text-[11px] text-muted-foreground/60 tabular-nums ml-1">{items.length}</span>
        </div>
      </button>

      {/* Items - animated collapse */}
      <div
        ref={contentRef}
        className="transition-[max-height,opacity] duration-250 ease-out overflow-hidden"
        style={{
          maxHeight: collapsed ? 0 : contentHeight ? contentHeight + 8 : "none",
          opacity: collapsed ? 0 : 1,
        }}
      >
        <div className="border-t border-border/30 px-1.5 py-1 space-y-px">
          {items.map((item) => {
            const globalIdx = [...allItems]
              .sort((a, b) => a.order - b.order)
              .findIndex((i) => i.id === item.id);

            return (
              <ItemRow
                key={item.id}
                item={item}
                globalIdx={globalIdx}
                bulkMode={bulkMode}
                selected={bulkSelected.has(item.id)}
                onBulkToggle={() => onBulkToggle(item.id)}
                onEdit={() => onEdit(item)}
                onDelete={() => onDelete(item.id)}
                onInlineUpdate={onInlineUpdate}
                isDeleteConfirm={deleteConfirm === item.id}
                draggable={sortMode === "custom"}
                isDragging={dragIndex === globalIdx}
                onDragStart={(e) => onDragStart(e, globalIdx)}
                onDragOver={(e) => onDragOver(e, globalIdx)}
                onDragEnd={onDragEnd}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Item Row ────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  bulkMode,
  selected,
  onBulkToggle,
  onEdit,
  onDelete,
  onInlineUpdate,
  isDeleteConfirm,
  draggable,
  isDragging,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  item: ChecklistItem;
  globalIdx: number;
  bulkMode: boolean;
  selected: boolean;
  onBulkToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onInlineUpdate: (id: string, updates: Partial<Pick<ChecklistItem, "label" | "weight" | "is_dealbreaker" | "is_bonus">>) => void;
  isDeleteConfirm: boolean;
  draggable: boolean;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(item.label);
  const [showWeightSlider, setShowWeightSlider] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const weightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editingLabel && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [editingLabel]);

  const commitLabel = () => {
    setEditingLabel(false);
    const trimmed = labelDraft.trim();
    if (trimmed && trimmed !== item.label) {
      onInlineUpdate(item.id, { label: trimmed });
    } else {
      setLabelDraft(item.label);
    }
  };

  const cycleType = () => {
    if (item.is_dealbreaker) {
      onInlineUpdate(item.id, { is_dealbreaker: false, is_bonus: true });
    } else if (item.is_bonus) {
      onInlineUpdate(item.id, { is_bonus: false, is_dealbreaker: false });
    } else {
      onInlineUpdate(item.id, { is_dealbreaker: true, is_bonus: false });
    }
  };

  const handleWeightChange = (newWeight: number) => {
    onInlineUpdate(item.id, { weight: newWeight });
    if (weightTimeoutRef.current) clearTimeout(weightTimeoutRef.current);
    weightTimeoutRef.current = setTimeout(() => setShowWeightSlider(false), 2000);
  };

  return (
    <div
      draggable={draggable && !bulkMode && !editingLabel && !showWeightSlider}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={cn(
        "group/row flex items-center gap-2 rounded-lg px-2 py-[7px] transition-all duration-150",
        isDragging && "bg-primary/5 ring-1 ring-primary/20 scale-[0.995]",
        !isDragging && "hover:bg-muted/30",
        selected && "bg-primary/5 ring-1 ring-primary/10"
      )}
    >
      {/* Bulk checkbox */}
      {bulkMode && (
        <button
          onClick={onBulkToggle}
          className={cn(
            "flex size-[15px] items-center justify-center rounded-[4px] border transition-all shrink-0",
            selected
              ? "border-primary bg-primary text-primary-foreground scale-105"
              : "border-muted-foreground/30 hover:border-primary/60"
          )}
        >
          {selected && <CheckIcon className="size-2.5" />}
        </button>
      )}

      {/* Drag handle */}
      {draggable && !bulkMode && (
        <GripVerticalIcon className="size-3 text-muted-foreground/25 group-hover/row:text-muted-foreground/60 cursor-grab shrink-0 transition-colors" />
      )}

      {/* Type badge - click to cycle */}
      <button
        onClick={cycleType}
        className="shrink-0 transition-transform active:scale-90"
        title="Click to cycle: Required → Dealbreaker → Bonus"
      >
        <ItemTypeBadge item={item} />
      </button>

      {/* Label - click to edit inline */}
      {editingLabel ? (
        <input
          ref={labelInputRef}
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitLabel();
            if (e.key === "Escape") { setLabelDraft(item.label); setEditingLabel(false); }
          }}
          className="flex-1 min-w-0 text-[13px] bg-transparent border-b border-primary/40 outline-none py-0 px-0"
        />
      ) : (
        <span
          onClick={() => { setEditingLabel(true); setLabelDraft(item.label); }}
          className="flex-1 min-w-0 text-[13px] truncate cursor-text hover:text-foreground/90 transition-colors"
          title="Click to rename"
        >
          {item.label}
        </span>
      )}

      {/* Weight - click to show slider, or display bar */}
      <div className="flex items-center gap-1.5 shrink-0">
        {showWeightSlider ? (
          <div className="flex items-center gap-1.5">
            <input
              type="range"
              min={1}
              max={10}
              value={item.weight}
              onChange={(e) => handleWeightChange(Number(e.target.value))}
              onBlur={() => setShowWeightSlider(false)}
              className="w-16 h-1 accent-primary cursor-pointer"
              autoFocus
            />
            <span className="font-mono text-[10px] text-foreground tabular-nums w-3 text-right font-semibold">
              {item.weight}
            </span>
          </div>
        ) : (
          <button
            onClick={() => { setShowWeightSlider(true); if (weightTimeoutRef.current) clearTimeout(weightTimeoutRef.current); }}
            className="flex items-center gap-1.5 cursor-pointer group/weight"
            title="Click to adjust weight"
          >
            <div className="w-8 h-[3px] rounded-full bg-muted/60 overflow-hidden group-hover/weight:bg-muted transition-colors">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  item.is_dealbreaker ? "bg-destructive/60 group-hover/weight:bg-destructive" :
                  item.is_bonus ? "bg-primary/60 group-hover/weight:bg-primary" :
                  "bg-foreground/20 group-hover/weight:bg-foreground/40"
                )}
                style={{ width: `${(item.weight / 10) * 100}%` }}
              />
            </div>
            <span className="font-mono text-[10px] text-muted-foreground/60 group-hover/weight:text-muted-foreground tabular-nums w-3 text-right font-medium transition-colors">
              {item.weight}
            </span>
          </button>
        )}
      </div>

      {/* Actions - visible on hover */}
      {!bulkMode && (
        <div className="flex items-center gap-px shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity duration-100">
          <Button variant="ghost" size="icon-xs" onClick={onEdit} title="Edit category & details">
            <PencilIcon />
          </Button>
          <Button
            variant={isDeleteConfirm ? "destructive" : "ghost"}
            size="icon-xs"
            onClick={onDelete}
          >
            <TrashIcon />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Item Type Badge ─────────────────────────────────────────────────────────

function ItemTypeBadge({ item }: { item: ChecklistItem }) {
  if (item.is_dealbreaker) {
    return (
      <span className="inline-flex items-center justify-center w-[52px] gap-[3px] rounded-md bg-destructive/8 border border-destructive/15 py-[2px] hover:bg-destructive/15 transition-colors">
        <ShieldAlertIcon className="size-2.5 text-destructive" />
        <span className="text-[9px] font-bold text-destructive">Deal</span>
      </span>
    );
  }
  if (item.is_bonus) {
    return (
      <span className="inline-flex items-center justify-center w-[52px] gap-[3px] rounded-md bg-primary/8 border border-primary/15 py-[2px] hover:bg-primary/15 transition-colors">
        <SparklesIcon className="size-2.5 text-primary" />
        <span className="text-[9px] font-bold text-primary">Bonus</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-[52px] gap-[3px] rounded-md bg-muted/40 border border-border/40 py-[2px] hover:bg-muted/70 transition-colors">
      <span className="text-[9px] font-medium text-muted-foreground">Req</span>
    </span>
  );
}

// ─── Item Form ───────────────────────────────────────────────────────────────

function ItemForm({
  form,
  setForm,
  categories,
}: {
  form: ItemFormData;
  setForm: React.Dispatch<React.SetStateAction<ItemFormData>>;
  categories: string[];
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-[0.1em]">Label</label>
        <Input
          placeholder="e.g. Natural light"
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-[0.1em]">Category</label>
        <Input
          placeholder="e.g. Essentials"
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          list="category-suggestions-panel"
        />
        <datalist id="category-suggestions-panel">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-[0.1em]">Weight</label>
          <span className="font-mono text-sm font-semibold tabular-nums">{form.weight}</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={10}
            value={form.weight}
            onChange={(e) => setForm((f) => ({ ...f, weight: Number(e.target.value) }))}
            className="flex-1 accent-primary h-1.5"
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground/50">
          <span>Nice to have</span>
          <span>Critical</span>
        </div>
      </div>

      {/* Type selector */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-[0.1em]">Type</label>
        <div className="grid grid-cols-3 gap-1.5">
          <TypeButton
            active={!form.is_dealbreaker && !form.is_bonus}
            onClick={() => setForm((f) => ({ ...f, is_dealbreaker: false, is_bonus: false }))}
            label="Required"
            sublabel="Normal scoring"
          />
          <TypeButton
            active={form.is_dealbreaker}
            onClick={() => setForm((f) => ({ ...f, is_dealbreaker: true, is_bonus: false }))}
            label="Dealbreaker"
            sublabel="0 if missing"
            variant="destructive"
          />
          <TypeButton
            active={form.is_bonus}
            onClick={() => setForm((f) => ({ ...f, is_bonus: true, is_dealbreaker: false }))}
            label="Bonus"
            sublabel="Only adds"
            variant="primary"
          />
        </div>
      </div>
    </div>
  );
}

function TypeButton({
  active,
  onClick,
  label,
  sublabel,
  variant,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sublabel: string;
  variant?: "destructive" | "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-px rounded-lg border px-2 py-2 transition-all active:scale-[0.97]",
        active
          ? variant === "destructive"
            ? "border-destructive/30 bg-destructive/8 text-destructive ring-1 ring-destructive/15"
            : variant === "primary"
              ? "border-primary/30 bg-primary/8 text-primary ring-1 ring-primary/15"
              : "border-foreground/15 bg-foreground/5 text-foreground ring-1 ring-foreground/8"
          : "border-border/60 text-muted-foreground hover:bg-muted/30 hover:border-border"
      )}
    >
      <span className="text-[11px] font-semibold">{label}</span>
      <span className="text-[9px] opacity-60">{sublabel}</span>
    </button>
  );
}

// ─── Bulk Edit Form ──────────────────────────────────────────────────────────

function BulkEditForm({
  form,
  setForm,
  categories,
}: {
  form: { weight?: number; category?: string; is_dealbreaker?: boolean; is_bonus?: boolean };
  setForm: React.Dispatch<React.SetStateAction<typeof form>>;
  categories: string[];
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Only filled fields will be applied.</p>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-[0.1em]">Category</label>
        <Input
          placeholder="Leave blank to skip"
          value={form.category ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value || undefined }))}
          list="bulk-category-suggestions"
        />
        <datalist id="bulk-category-suggestions">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-[0.1em]">Weight</label>
          {form.weight !== undefined && (
            <button onClick={() => setForm((f) => ({ ...f, weight: undefined }))} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={10}
            value={form.weight ?? 5}
            onChange={(e) => setForm((f) => ({ ...f, weight: Number(e.target.value) }))}
            className="flex-1 accent-primary h-1.5"
          />
          <span className="font-mono text-sm font-semibold tabular-nums w-5 text-right">{form.weight ?? "-"}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-[0.1em]">Type</label>
        <div className="grid grid-cols-4 gap-1.5">
          <BulkTypeBtn
            active={form.is_dealbreaker === undefined && form.is_bonus === undefined}
            onClick={() => setForm((f) => ({ ...f, is_dealbreaker: undefined, is_bonus: undefined }))}
            label="Skip"
          />
          <BulkTypeBtn
            active={form.is_dealbreaker === false && form.is_bonus === false}
            onClick={() => setForm((f) => ({ ...f, is_dealbreaker: false, is_bonus: false }))}
            label="Required"
          />
          <BulkTypeBtn
            active={form.is_dealbreaker === true}
            onClick={() => setForm((f) => ({ ...f, is_dealbreaker: true, is_bonus: false }))}
            label="Deal"
            variant="destructive"
          />
          <BulkTypeBtn
            active={form.is_bonus === true}
            onClick={() => setForm((f) => ({ ...f, is_bonus: true, is_dealbreaker: false }))}
            label="Bonus"
            variant="primary"
          />
        </div>
      </div>
    </div>
  );
}

function BulkTypeBtn({
  active,
  onClick,
  label,
  variant,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  variant?: "destructive" | "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1.5 text-[11px] font-medium transition-all active:scale-[0.97]",
        active
          ? variant === "destructive"
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : variant === "primary"
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-foreground/15 bg-foreground/5 text-foreground"
          : "border-border/60 text-muted-foreground hover:bg-muted/30"
      )}
    >
      {label}
    </button>
  );
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className}>
      <path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
