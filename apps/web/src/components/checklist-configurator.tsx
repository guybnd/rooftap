"use client";

import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChecklistItem } from '@homeup/core';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  PlusIcon,
  GripVerticalIcon,
  TrashIcon,
  PencilIcon,
  ShieldAlertIcon,
  SparklesIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  AlertTriangleIcon,
} from "lucide-react";

interface ItemFormData {
  label: string;
  category: string;
  weight: number;
  is_dealbreaker: boolean;
  is_bonus: boolean;
}

const EMPTY_FORM: ItemFormData = {
  label: "",
  category: "",
  weight: 5,
  is_dealbreaker: false,
  is_bonus: false,
};

export function ChecklistConfigurator({
  initialItems,
  groupId,
}: {
  initialItems: ChecklistItem[];
  groupId: string;
}) {
  const [items, setItems] = useState<ChecklistItem[]>(initialItems);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const supabase = createClient();

  const categories = Array.from(
    new Set(items.map((i) => i.category).filter(Boolean))
  ).sort();

  const groupedItems = (() => {
    if (categories.length === 0) {
      return [{ category: "", items: [...items].sort((a, b) => a.order - b.order) }];
    }
    const groups = categories.map((cat) => ({
      category: cat,
      items: items.filter((i) => i.category === cat).sort((a, b) => a.order - b.order),
    }));
    const uncategorized = items.filter((i) => !i.category);
    if (uncategorized.length > 0) {
      groups.push({ category: "", items: uncategorized.sort((a, b) => a.order - b.order) });
    }
    return groups;
  })();

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
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

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  };

  const handleSave = async () => {
    if (!form.label.trim()) return;
    setSaving(true);

    if (editingId) {
      const { data, error } = await supabase
        .from("checklist_items")
        .update({
          label: form.label.trim(),
          category: form.category.trim(),
          weight: form.weight,
          is_dealbreaker: form.is_dealbreaker,
          is_bonus: form.is_bonus,
        })
        .eq("id", editingId)
        .select()
        .single();

      if (error) {
        showError("Failed to update item. Please try again.");
        setSaving(false);
        return;
      }
      if (data) {
        setItems((prev) => prev.map((i) => (i.id === editingId ? data : i)));
      }
    } else {
      const maxOrder = items.length > 0 ? Math.max(...items.map((i) => i.order)) + 1 : 0;
      const { data, error } = await supabase
        .from("checklist_items")
        .insert({
          label: form.label.trim(),
          category: form.category.trim(),
          weight: form.weight,
          is_dealbreaker: form.is_dealbreaker,
          is_bonus: form.is_bonus,
          order: maxOrder,
          group_id: groupId,
        })
        .select()
        .single();

      if (error) {
        showError("Failed to create item. Please try again.");
        setSaving(false);
        return;
      }
      if (data) {
        setItems((prev) => [...prev, data]);
      }
    }

    setSaving(false);
    setDialogOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm((cur) => (cur === id ? null : cur)), 3000);
      return;
    }
    setDeleteConfirm(null);
    const { error } = await supabase.from("checklist_items").delete().eq("id", id);
    if (error) {
      showError("Failed to delete item. Please try again.");
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const reorder = useCallback(
    async (itemId: string, direction: "up" | "down") => {
      const sorted = [...items].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((i) => i.id === itemId);
      if (idx < 0) return;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= sorted.length) return;

      const a = sorted[idx];
      const b = sorted[swapIdx];
      const newItems = items.map((i) => {
        if (i.id === a.id) return { ...i, order: b.order };
        if (i.id === b.id) return { ...i, order: a.order };
        return i;
      });
      setItems(newItems);

      const results = await Promise.all([
        supabase.from("checklist_items").update({ order: b.order }).eq("id", a.id),
        supabase.from("checklist_items").update({ order: a.order }).eq("id", b.id),
      ]);
      if (results.some((r) => r.error)) {
        showError("Failed to reorder. Please try again.");
      }
    },
    [items, supabase]
  );

  const handleDragStart = (idx: number) => {
    setDragIndex(idx);
  };

  const handleDragOver = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === targetIdx) return;

    const sorted = [...items].sort((a, b) => a.order - b.order);
    const draggedItem = sorted[dragIndex];
    const newSorted = sorted.filter((_, i) => i !== dragIndex);
    newSorted.splice(targetIdx, 0, draggedItem);

    const reordered = newSorted.map((item, i) => ({ ...item, order: i }));
    setItems(reordered);
    setDragIndex(targetIdx);
  };

  const handleDragEnd = async () => {
    setDragIndex(null);
    const results = await Promise.all(
      items.map((item) =>
        supabase.from("checklist_items").update({ order: item.order }).eq("id", item.id)
      )
    );
    if (results.some((r) => r.error)) {
      showError("Failed to save new order. Please try again.");
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangleIcon className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Checklist Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure what matters when evaluating apartments
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (open) openCreate(); setDialogOpen(open); }}>
          <DialogTrigger render={<Button />}>
            <PlusIcon className="h-4 w-4" />
            Add Item
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Checklist Item" : "New Checklist Item"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Label</label>
                <Input
                  placeholder="e.g. Natural light"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Category</label>
                <Input
                  placeholder="e.g. Essentials"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  list="category-suggestions"
                />
                <datalist id="category-suggestions">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Weight: {form.weight}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={form.weight}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, weight: Number(e.target.value) }))
                    }
                    className="flex-1 accent-primary"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={form.weight}
                    onChange={(e) => {
                      const v = Math.min(10, Math.max(1, Number(e.target.value) || 1));
                      setForm((f) => ({ ...f, weight: v }));
                    }}
                    className="w-14 text-center tabular-nums"
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Low (1)</span>
                  <span>High (10)</span>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_dealbreaker}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, is_dealbreaker: e.target.checked, is_bonus: e.target.checked ? false : f.is_bonus }))
                  }
                  className="size-4 rounded accent-destructive"
                />
                <span className="text-sm font-medium">Dealbreaker</span>
                <span className="text-xs text-muted-foreground">
                  (apartment scores 0 if this fails)
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_bonus}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, is_bonus: e.target.checked, is_dealbreaker: e.target.checked ? false : f.is_dealbreaker }))
                  }
                  className="size-4 rounded accent-primary"
                />
                <span className="text-sm font-medium">Bonus</span>
                <span className="text-xs text-muted-foreground">
                  (only boosts score when present, no penalty when missing)
                </span>
              </label>
            </div>
            <DialogFooter>
              <Button onClick={handleSave} disabled={saving || !form.label.trim()}>
                {saving ? "Saving..." : editingId ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No checklist items yet. Add your first item to start scoring apartments.
            </p>
          </CardContent>
        </Card>
      ) : (
        groupedItems.map((group) => (
          <Card key={group.category || "__uncategorized"}>
            <CardHeader>
              <CardTitle className={group.category ? "" : "text-muted-foreground"}>
                {group.category || "Uncategorized"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-2 sm:p-4">
              {group.items.map((item) => {
                const globalIdx = [...items]
                  .sort((a, b) => a.order - b.order)
                  .findIndex((i) => i.id === item.id);

                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => handleDragStart(globalIdx)}
                    onDragOver={(e) => handleDragOver(e, globalIdx)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 rounded-lg border p-2 sm:p-3 transition-colors ${
                      dragIndex === globalIdx
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:bg-muted/50"
                    }`}
                  >
                    <GripVerticalIcon className="size-4 text-muted-foreground cursor-grab shrink-0 hidden sm:block" />

                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        aria-label="Move up"
                        onClick={() => reorder(item.id, "up")}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ChevronUpIcon className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        onClick={() => reorder(item.id, "down")}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDownIcon className="size-3.5" />
                      </button>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{item.label}</span>
                        {item.is_dealbreaker && (
                          <ShieldAlertIcon className="size-3.5 text-destructive shrink-0" />
                        )}
                        {item.is_bonus && (
                          <SparklesIcon className="size-3.5 text-primary shrink-0" />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-muted-foreground tabular-nums w-6 text-right">
                        {item.weight}
                      </span>
                      <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden hidden sm:block">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(item.weight / 10) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => openEdit(item)}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant={deleteConfirm === item.id ? "destructive" : "ghost"}
                        size="icon-xs"
                        onClick={() => handleDelete(item.id)}
                        aria-label={deleteConfirm === item.id ? "Confirm delete" : "Delete"}
                      >
                        <TrashIcon />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
