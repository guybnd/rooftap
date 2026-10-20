"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsLabel, SettingsPanel } from "@/components/settings-panel";
import {
  AISLE_ORDER,
  GROCERY_DISMISS_SETTING_OPTIONS,
  getAisleMeta,
  groceryDismissSettingValue,
  resolveGroceryDismissAction,
  type GroceryDismissSetting,
} from '@homeup/core';
import type { GroceryCustomAisle } from '@homeup/core';
import { ShoppingCart, RotateCcw, GripVertical } from "lucide-react";
import { GroceryGlyph } from '@/components/grocery-glyph';

const AISLE_ORDER_KEY = "homeup_grocery_aisle_order";
const UNIT_SUGGESTIONS = ["kg", "g", "L", "ml", "pack", "bunch", "dozen", "can", "box", "bottle"];

/**
 * FLUX-65: Groceries aisle settings. Drag the rows to reorder how aisles group on
 * your shopping list (synced via user_settings.grocery_aisle_order), and set a
 * default unit per aisle (user_settings.grocery_aisle_units) that prefills new items.
 */
export function GroceriesSettings() {
  const { userSettings, group, refresh } = useDataCache();

  const [customAisles, setCustomAisles] = useState<GroceryCustomAisle[]>([]);
  const [order, setOrder] = useState<string[]>(AISLE_ORDER as string[]);
  const [units, setUnits] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState(false);
  const orderHydratedRef = useRef(false);
  const unitsHydratedRef = useRef(false);

  // Fetch custom aisles so they appear alongside the built-ins.
  useEffect(() => {
    if (!group?.id) return;
    const supabase = createClient();
    void supabase
      .from("grocery_aisles")
      .select("*")
      .eq("group_id", group.id)
      .order("sort_order", { ascending: true })
      .then(({ data }) => setCustomAisles((data ?? []) as GroceryCustomAisle[]));
  }, [group?.id]);

  // Hydrate units once from synced settings (DB wins).
  useEffect(() => {
    if (unitsHydratedRef.current || !userSettings) return;
    unitsHydratedRef.current = true;
    setUnits(userSettings.grocery_aisle_units ?? {});
  }, [userSettings]);

  // Build the order: DB order on first hydration, preserved thereafter, always
  // re-merged with every built-in + custom aisle so late-loading aisles appear.
  useEffect(() => {
    const known = [...(AISLE_ORDER as string[]), ...customAisles.map((a) => a.name)];
    setOrder((prev) => {
      let base = prev;
      if (!orderHydratedRef.current) {
        const stored = userSettings?.grocery_aisle_order;
        base = Array.isArray(stored) && stored.length ? stored : (AISLE_ORDER as string[]);
        if (userSettings) orderHydratedRef.current = true;
      }
      const merged = [...base.filter((a) => known.includes(a)), ...known.filter((a) => !base.includes(a))];
      // Avoid churn when nothing actually changed.
      return merged.length === prev.length && merged.every((a, i) => a === prev[i]) ? prev : merged;
    });
  }, [userSettings, customAisles]);

  const isCustomOrder =
    Array.isArray(userSettings?.grocery_aisle_order) && userSettings!.grocery_aisle_order!.length > 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persist = useCallback(
    async (payload: {
      grocery_aisle_order?: string[] | null;
      grocery_aisle_units?: Record<string, string>;
      grocery_suggest_dismiss?: string | null;
    }) => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from("user_settings")
        .upsert(
          { user_id: user.id, ...payload, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
      await refresh();
    },
    [refresh],
  );

  const dismissSetting: GroceryDismissSetting =
    resolveGroceryDismissAction(userSettings?.grocery_suggest_dismiss) ?? "ask";
  const changeDismiss = (setting: GroceryDismissSetting) =>
    void persist({ grocery_suggest_dismiss: groceryDismissSettingValue(setting) });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = order.indexOf(String(active.id));
    const newIdx = order.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(order, oldIdx, newIdx);
    setOrder(next);
    try { localStorage.setItem(AISLE_ORDER_KEY, JSON.stringify(next)); } catch { /* noop */ }
    void persist({ grocery_aisle_order: next });
  };

  // Debounce unit edits so typing doesn't hammer the DB.
  const unitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setUnit = (aisle: string, value: string) => {
    setUnits((prev) => {
      const next = { ...prev };
      if (value.trim()) next[aisle] = value.trim();
      else delete next[aisle];
      if (unitTimer.current) clearTimeout(unitTimer.current);
      unitTimer.current = setTimeout(() => void persist({ grocery_aisle_units: next }), 600);
      return next;
    });
  };
  useEffect(() => () => { if (unitTimer.current) clearTimeout(unitTimer.current); }, []);

  const resetOrder = async () => {
    setResetting(true);
    try {
      orderHydratedRef.current = true; // keep DB-null from re-applying a stale order
      setOrder([...(AISLE_ORDER as string[]), ...customAisles.map((a) => a.name)]);
      try { localStorage.removeItem(AISLE_ORDER_KEY); } catch { /* noop */ }
      await persist({ grocery_aisle_order: null });
    } finally {
      setResetting(false);
    }
  };

  return (
    <SettingsPanel icon={ShoppingCart} title="Groceries">
      <div className="space-y-1.5">
        <SettingsLabel>Running-low suggestions</SettingsLabel>
        <p className="px-1 text-xs text-muted-foreground">
          What the X on a suggestion does. Not now hides it until you next buy it. Archive takes it
          off the list and keeps its details in your library.
        </p>
        <SegmentedControl
          ariaLabel="What the X on a running-low suggestion does"
          options={GROCERY_DISMISS_SETTING_OPTIONS}
          value={dismissSetting}
          onChange={changeDismiss}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <SettingsLabel>Aisles</SettingsLabel>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetOrder}
            disabled={!isCustomOrder || resetting}
            className="-my-1 text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {resetting ? "Resetting…" : "Reset order"}
          </Button>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          Drag to set the order aisles take on your list. A unit prefills new items in that aisle.
          Syncs across your devices.
        </p>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {/* H4: one inset fill with hairlines, not a bordered card per aisle. */}
            <ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/30">
              {order.map((aisle) => (
                <AisleRow
                  key={aisle}
                  aisle={aisle}
                  meta={getAisleMeta(aisle, customAisles)}
                  unit={units[aisle] ?? ""}
                  onUnitChange={(v) => setUnit(aisle, v)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </div>

      <datalist id="grocery-unit-suggestions">
        {UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
    </SettingsPanel>
  );
}

function AisleRow({
  aisle,
  meta,
  unit,
  onUnitChange,
}: {
  aisle: string;
  meta: { label: string; icon: string };
  unit: string;
  onUnitChange: (value: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: aisle });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex min-h-[52px] items-center gap-2 bg-transparent py-1.5 pl-1.5 pr-3"
    >
      <span
        {...attributes}
        {...listeners}
        className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
        title="Drag to reorder"
        aria-label={`Reorder ${meta.label}`}
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <GroceryGlyph emoji={meta.icon} size={18} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{meta.label}</span>
      <input
        type="text"
        value={unit}
        onChange={(e) => onUnitChange(e.target.value)}
        list="grocery-unit-suggestions"
        placeholder="Unit"
        aria-label={`Default unit for ${meta.label}`}
        maxLength={12}
        className="h-9 w-20 rounded-lg border border-input bg-background/60 px-2 text-center text-sm placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none"
      />
    </li>
  );
}
