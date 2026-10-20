// HOUP-80/HOUP-228: native Item Library editor — port of
// apps/web/src/app/groceries/shelf-life/page.tsx's merge model (code defaults
// + per-group overrides + list-derived "extra" rows), mutations (direct
// Supabase upsert/delete on grocery_item_library, no Legend store — matches
// web), sort modes (Section/Name/Last added), a custom-only filter, a hidden
// count, humanized rebuy intervals, and undo after hide/delete. Trims vs.
// web: one edit BottomSheet per row (days + price + hide/reset/delete
// together) replaces the two inline tap-to-edit chips + hover menu — the
// price chip is a fast path into that same sheet, pre-focused on price,
// rather than true inline editing (Hearth M4 — sheets, not modals).
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
// HOUP-318: keyboard-aware scroll container (same swap as Home/Costs) so an
// inline field low on the page scrolls above the on-screen keyboard.
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Clock, Eye, EyeOff, Plus, RotateCcw, Trash2 } from 'lucide-react-native';
import { Text, BottomSheet, Button, Card, GroceryGlyph, Input, ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing, Pill, ScreenBackground, SectionSearchBar, SegmentedControl, cn } from '@homeup/ui';
import { AISLE_ORDER, getAisleMeta, getGroceryEmoji, canonicalizeItemName, formatMoney, formatRebuyInterval, SHELF_LIFE_DEFAULTS } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { createUndoToastPresenter } from '@/lib/undo-toast';
import {
  compareByAdded,
  compareByName,
  matchesFilters,
  parseDaysField,
  parsePriceField,
  type MergedEntry,
} from '@/features/groceries/shelf-life-logic';

interface Override {
  item_name: string;
  shelf_life_days: number | null;
  typical_price_cents: number | null;
  aisle: string | null;
  hidden: boolean | null;
  created_at: string | null;
}

interface ListEntry {
  name: string;
  aisle: string;
}

type SortMode = 'section' | 'name' | 'added';

const canon = canonicalizeItemName;
const hasOverrideValues = (o: Override) =>
  o.shelf_life_days != null || o.typical_price_cents != null || (o.aisle != null && o.aisle !== '');

export default function ItemLibraryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group, loading: cacheLoading } = useDataCache();

  const [overrides, setOverrides] = React.useState<Override[]>([]);
  const [listItems, setListItems] = React.useState<ListEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [showHidden, setShowHidden] = React.useState(false);
  const [customOnly, setCustomOnly] = React.useState(false);
  const [sortMode, setSortMode] = React.useState<SortMode>('section');
  const [aisleFilter, setAisleFilter] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<MergedEntry | null>(null);
  const [focusField, setFocusField] = React.useState<'price' | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newDays, setNewDays] = React.useState('');
  const [newPrice, setNewPrice] = React.useState('');

  const fetchData = React.useCallback(async () => {
    if (!group?.id) return;
    const supabase = getCurrentSupabaseClient();
    const [overridesRes, itemsRes] = await Promise.all([
      supabase
        .from('grocery_item_library')
        .select('item_name, shelf_life_days, typical_price_cents, aisle, hidden, created_at')
        .eq('group_id', group.id),
      supabase.from('grocery_items').select('name, aisle').eq('group_id', group.id),
    ]);
    setOverrides((overridesRes.data ?? []) as Override[]);
    setListItems((itemsRes.data ?? []) as ListEntry[]);
    setLoading(false);
  }, [group]);

  React.useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const merged = React.useMemo<MergedEntry[]>(() => {
    const overrideMap = new Map(overrides.map((o) => [canon(o.item_name), o]));
    const defaultNames = new Set(SHELF_LIFE_DEFAULTS.map((d) => canon(d.name)));
    const listAisleByName = new Map<string, string>();
    for (const it of listItems) {
      const k = canon(it.name);
      if (!listAisleByName.has(k)) listAisleByName.set(k, it.aisle);
    }
    const aisleFromList = (name: string, fallback: string): string => {
      const l = canon(name);
      if (listAisleByName.has(l)) return listAisleByName.get(l)!;
      for (const [k, a] of listAisleByName) if (l === k || l.includes(k) || k.includes(l)) return a;
      return fallback;
    };

    const out: MergedEntry[] = [
      ...SHELF_LIFE_DEFAULTS.map((d) => {
        const ov = overrideMap.get(canon(d.name));
        const defaultPriceCents = d.price != null ? Math.round(d.price * 100) : null;
        return {
          name: d.name,
          aisle: (ov?.aisle && ov.aisle !== '' ? ov.aisle : d.aisle) ?? 'other',
          effectiveDays: ov?.shelf_life_days ?? d.days,
          effectivePriceCents: ov?.typical_price_cents ?? defaultPriceCents,
          isOverridden: !!ov && hasOverrideValues(ov),
          isCustom: false,
          hidden: ov?.hidden ?? false,
          created_at: ov?.created_at ?? null,
        };
      }),
      ...overrides
        .filter((o) => !defaultNames.has(canon(o.item_name)))
        .map((o) => ({
          name: o.item_name,
          aisle: o.aisle && o.aisle !== '' ? o.aisle : aisleFromList(o.item_name, 'other'),
          effectiveDays: o.shelf_life_days,
          effectivePriceCents: o.typical_price_cents,
          isOverridden: false,
          isCustom: true,
          hidden: o.hidden ?? false,
          created_at: o.created_at,
        })),
    ];

    const covered = new Set(out.map((e) => canon(e.name)));
    const seenExtra = new Set<string>();
    for (const it of listItems) {
      const l = canon(it.name);
      if (covered.has(l) || seenExtra.has(l)) continue;
      seenExtra.add(l);
      out.push({ name: it.name, aisle: it.aisle, effectiveDays: null, effectivePriceCents: null, isOverridden: false, isCustom: false, hidden: false, created_at: null });
    }
    return out;
  }, [overrides, listItems]);

  const visible = React.useMemo(
    () => merged.filter((e) => matchesFilters(e, { search, showHidden, customOnly, aisleFilter })),
    [merged, search, showHidden, customOnly, aisleFilter]
  );

  const grouped = React.useMemo(() => {
    const map = new Map<string, MergedEntry[]>();
    for (const e of visible) {
      if (!map.has(e.aisle)) map.set(e.aisle, []);
      map.get(e.aisle)!.push(e);
    }
    for (const list of map.values()) list.sort(compareByName);
    return map;
  }, [visible]);

  // `name`/`added` flat modes — no aisle headers, no per-aisle subtotal.
  // Section mode renders `grouped` instead and never reads this, so skip the
  // sort rather than throwing away a full-library sort on every keystroke.
  const flatSorted = React.useMemo(() => {
    if (sortMode === 'section') return [];
    if (sortMode === 'name') return [...visible].sort(compareByName);
    return [...visible].sort(compareByAdded);
  }, [visible, sortMode]);

  // Whole-library counts (not `visible`) so they hold steady as filters change.
  const hiddenCount = React.useMemo(() => merged.filter((e) => e.hidden).length, [merged]);
  const customisedCount = React.useMemo(() => merged.filter((e) => e.isOverridden || e.isCustom).length, [merged]);

  const orderedAisles = React.useMemo(() => {
    const present = new Set(grouped.keys());
    return [...AISLE_ORDER.filter((a) => present.has(a)), ...[...present].filter((a) => !(AISLE_ORDER as string[]).includes(a)).sort()];
  }, [grouped]);

  // Aisle filter chips: built from the full merged set (not `visible`) so the
  // category picker itself never shrinks as filters narrow the list.
  const allAisles = React.useMemo(() => {
    const present = new Set(merged.map((e) => e.aisle));
    return [...AISLE_ORDER.filter((a) => present.has(a)), ...[...present].filter((a) => !(AISLE_ORDER as string[]).includes(a)).sort()];
  }, [merged]);

  const upsert = async (name: string, patch: Partial<Omit<Override, 'item_name'>>) => {
    if (!group?.id) return;
    const supabase = getCurrentSupabaseClient();
    await supabase.from('grocery_item_library').upsert({ group_id: group.id, item_name: name, ...patch }, { onConflict: 'group_id,item_name' });
    setOverrides((prev) => {
      const i = prev.findIndex((o) => canon(o.item_name) === canon(name));
      if (i >= 0) {
        const u = [...prev];
        u[i] = { ...u[i], ...patch };
        return u;
      }
      // Mirrors the column default (`created_at timestamptz not null default
      // now()`) — the row this just wrote IS timestamped. `...patch` still
      // wins when a caller (delete-undo's restore) carries an explicit one.
      return [...prev, { item_name: name, shelf_life_days: null, typical_price_cents: null, aisle: null, hidden: false, created_at: new Date().toISOString(), ...patch }];
    });
  };

  const removeOverride = async (name: string) => {
    if (!group?.id) return;
    const supabase = getCurrentSupabaseClient();
    await supabase.from('grocery_item_library').delete().eq('group_id', group.id).eq('item_name', name);
    setOverrides((prev) => prev.filter((o) => canon(o.item_name) !== canon(name)));
  };

  const addCustom = async () => {
    if (!group?.id || !newName.trim()) return;
    const days = newDays ? parseInt(newDays, 10) : NaN;
    const priceDollars = newPrice ? parseFloat(newPrice) : NaN;
    if (Number.isNaN(days) && Number.isNaN(priceDollars)) return;
    await upsert(newName.trim(), {
      shelf_life_days: Number.isNaN(days) ? null : days,
      typical_price_cents: Number.isNaN(priceDollars) ? null : Math.round(priceDollars * 100),
    });
    setNewName('');
    setNewDays('');
    setNewPrice('');
    setAddOpen(false);
  };

  // `upsert` is re-created every render; the presenters below are created
  // once (`useMemo(…, [])`) but call it later, from Undo — read it through a
  // ref, matching `groceries/index.tsx`'s `patchRowRef` precedent.
  const upsertRef = React.useRef(upsert);
  upsertRef.current = upsert;

  // Two presenters, one per action — they need different restores. Hide's
  // restore is deliberately `{ hidden: false }` and nothing else: a generic
  // payload would also re-upsert days/price/aisle onto a built-in that had
  // no override row, flipping it to "Customised" when it never was one.
  const hideUndo = React.useMemo(
    () =>
      createUndoToastPresenter<MergedEntry>({
        message: (count) => (count === 1 ? 'Item hidden' : `${count} items hidden`),
        restore: (e) => upsertRef.current(e.name, { hidden: false }),
      }),
    []
  );
  // Carrying `created_at` (when present) is load-bearing: `removeOverride`
  // drops the row from `overrides`, so this restore takes `upsert`'s insert
  // branch, and this screen never refetches after a mutation — without it
  // the restored row would mis-sort to "now" in Last added. The conditional
  // spread is required, not stylistic: the column is `not null` while
  // `MergedEntry.created_at` is nullable, so an unconditional value could
  // send `null` and fail the insert; when absent, the seed above supplies
  // `now()`.
  const deleteUndo = React.useMemo(
    () =>
      createUndoToastPresenter<MergedEntry>({
        message: (count) => (count === 1 ? 'Item deleted' : `${count} items deleted`),
        restore: (e) =>
          upsertRef.current(e.name, {
            shelf_life_days: e.effectiveDays,
            typical_price_cents: e.effectivePriceCents,
            aisle: e.aisle,
            ...(e.created_at ? { created_at: e.created_at } : {}),
          }),
      }),
    []
  );

  // Shared row renderer for both the section-grouped and flat (name/added)
  // layouts. The price chip is its own tap target — a fast path into the
  // sheet, pre-focused on price — separate from the row's own onPress.
  const renderEntry = (e: MergedEntry) => (
    <ListItem key={e.name} onPress={() => { setFocusField(null); setEditing(e); }}>
      <ListItemLeading className="h-7 w-7 items-center justify-center">
        <GroceryGlyph emoji={getGroceryEmoji(e.name, e.aisle)} size={20} />
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle className={cn(e.hidden && 'text-muted-foreground')}>
          {e.name}
        </ListItemTitle>
        <ListItemMeta>
          {e.isCustom && <Pill variant="muted">Custom</Pill>}
          {e.isOverridden && <Pill variant="muted">Customised</Pill>}
          {e.hidden && <Pill variant="muted">Hidden</Pill>}
        </ListItemMeta>
      </ListItemContent>
      <ListItemTrailing>
        <Pill variant="outline" size="sm" className="gap-1">
          <Clock size={10} className="text-muted-foreground" />
          <Text
            className="font-mono text-[11.5px] font-medium text-muted-foreground"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {formatRebuyInterval(e.effectiveDays) ?? '–'}
          </Text>
        </Pill>
        <Pressable
          onPress={() => { setFocusField('price'); setEditing(e); }}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel={`Edit typical price for ${e.name}`}
        >
          {e.effectivePriceCents != null ? (
            <Pill variant="outline" size="sm">
              <Text
                className="font-mono text-[11.5px] font-medium text-foreground"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {formatMoney(e.effectivePriceCents)}
              </Text>
            </Pill>
          ) : (
            <Pill variant="outline" size="sm" className="border-dashed">
              <Text className="text-[11.5px] font-medium text-muted-foreground">Set price</Text>
            </Pill>
          )}
        </Pressable>
      </ListItemTrailing>
    </ListItem>
  );

  if (cacheLoading || loading) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
      >
        <View className="flex-row items-center gap-2">
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" className="rounded p-1">
            <ArrowLeft size={18} className="text-foreground" />
          </Pressable>
          <Text className="font-heading text-title font-semibold text-foreground">Item library</Text>
        </View>

        {/* H1: the one display-weight lede on this screen; the tagline below
            is caption weight. */}
        <View className="gap-0.5 px-1">
          <Text className="text-display font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {visible.length} item{visible.length === 1 ? '' : 's'}
            <Text className="text-muted-foreground">
              {' '}
              · {orderedAisles.length} categor{orderedAisles.length === 1 ? 'y' : 'ies'}
            </Text>
          </Text>
          <Text className="text-caption text-muted-foreground">
            Aisle, typical price and how often to rebuy. New items fill in from here.
          </Text>
        </View>

        <SectionSearchBar value={search} onChange={setSearch} placeholder="Search items…" />

        {allAisles.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="flex-row items-center gap-1.5 px-1"
          >
            <Pressable
              onPress={() => setAisleFilter(null)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityState={{ selected: !aisleFilter }}
              className={cn('rounded-full border px-3 py-1', !aisleFilter ? 'border-primary bg-primary/15' : 'border-border bg-muted')}
            >
              <Text className={cn('text-xs font-medium', !aisleFilter ? 'text-primary' : 'text-muted-foreground')}>All</Text>
            </Pressable>
            {allAisles.map((aisle) => {
              const meta = getAisleMeta(aisle);
              const active = aisleFilter === aisle;
              return (
                <Pressable
                  key={aisle}
                  onPress={() => setAisleFilter(active ? null : aisle)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={cn('rounded-full border px-3 py-1', active ? 'border-primary bg-primary/15' : 'border-border bg-muted')}
                >
                  <Text className={cn('text-xs font-medium', active ? 'text-primary' : 'text-muted-foreground')}>{meta.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <View className="flex-row flex-wrap items-center gap-2 px-1">
          <SegmentedControl
            options={[
              { value: 'section', label: 'Section' },
              { value: 'name', label: 'Name' },
              { value: 'added', label: 'Last added' },
            ]}
            value={sortMode}
            onChange={setSortMode}
            accessibilityLabel="Item library sort order"
            fitContent
          />
          <Pressable
            onPress={() => setCustomOnly((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: customOnly }}
            className={cn(
              'rounded-full border px-3 py-1',
              customOnly ? 'border-primary/30 bg-primary/15' : 'border-border bg-muted'
            )}
          >
            <Text className={cn('text-xs font-medium', customOnly ? 'text-primary' : 'text-muted-foreground')}>
              Custom only
            </Text>
          </Pressable>
          {hiddenCount > 0 && (
            <Pressable
              onPress={() => setShowHidden((v) => !v)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ selected: showHidden }}
              className={cn(
                'flex-row items-center gap-1.5 rounded-full border px-3 py-1',
                showHidden ? 'border-primary/30 bg-primary/15' : 'border-border bg-muted'
              )}
            >
              {showHidden ? <Eye size={13} className="text-primary" /> : <EyeOff size={13} className="text-muted-foreground" />}
              <Text className={cn('text-xs font-medium', showHidden ? 'text-primary' : 'text-muted-foreground')}>
                {showHidden ? `Showing hidden ${hiddenCount}` : `Show hidden ${hiddenCount}`}
              </Text>
            </Pressable>
          )}
        </View>

        {visible.length === 0 ? (
          <Text className="px-1 py-8 text-center text-sm text-muted-foreground">
            No items match your search
            {[aisleFilter && 'in this category', customOnly && 'among your custom items']
              .filter(Boolean)
              .map((part) => ` ${part}`)
              .join('')}
            .
          </Text>
        ) : sortMode === 'section' ? (
          <View className="gap-4">
            {orderedAisles.map((aisle) => {
              const entries = grouped.get(aisle) ?? [];
              const meta = getAisleMeta(aisle);
              const aisleTotalCents = entries.reduce((sum, e) => sum + (e.effectivePriceCents ?? 0), 0);
              return (
                <View key={aisle} className="gap-2">
                  <View className="flex-row items-baseline gap-1.5 px-1">
                    <Text className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                      {meta.label}
                    </Text>
                    <Text className="text-xs text-muted-foreground/70" style={{ fontVariant: ['tabular-nums'] }}>
                      {entries.length}
                    </Text>
                    <View className="flex-1" />
                    {aisleTotalCents > 0 && (
                      <Text className="text-xs font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                        {formatMoney(aisleTotalCents)}
                      </Text>
                    )}
                  </View>
                  <ListGroup>{entries.map(renderEntry)}</ListGroup>
                </View>
              );
            })}
          </View>
        ) : (
          <ListGroup>{flatSorted.map(renderEntry)}</ListGroup>
        )}

        {addOpen ? (
          <Card className="gap-2 rounded-3xl px-3 py-3">
            <Input autoFocus value={newName} onChangeText={setNewName} placeholder="Item name" />
            <View className="flex-row gap-2">
              <Input value={newDays} onChangeText={setNewDays} placeholder="Buy again every N days" keyboardType="number-pad" className="flex-1" />
              <Input value={newPrice} onChangeText={setNewPrice} placeholder="Typical price" keyboardType="decimal-pad" className="flex-1" />
            </View>
            <View className="flex-row justify-end gap-2">
              <Button size="sm" variant="ghost" onPress={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onPress={addCustom}>
                Add
              </Button>
            </View>
          </Card>
        ) : (
          <Pressable
            onPress={() => setAddOpen(true)}
            className="flex-row items-center gap-1.5 self-start rounded-lg border border-dashed border-border px-3 py-1.5"
          >
            <Plus size={14} className="text-muted-foreground" />
            <Text className="text-sm text-muted-foreground">Add custom item</Text>
          </Pressable>
        )}

        <Text className="px-1 text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {customisedCount} customised · {SHELF_LIFE_DEFAULTS.length} built-in items
        </Text>
      </KeyboardAwareScrollView>

      <ItemLibraryEntrySheet
        key={editing?.name ?? 'none'}
        entry={editing}
        focusField={focusField}
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setFocusField(null);
          }
        }}
        onSave={async (days, priceCents) => {
          if (!editing) return;
          await upsert(editing.name, { shelf_life_days: days, typical_price_cents: priceCents });
          setEditing(null);
        }}
        onToggleHidden={async () => {
          if (!editing) return;
          const entry = editing;
          const next = !entry.hidden;
          await upsert(entry.name, { hidden: next });
          if (next) hideUndo.addAndShow(entry);
          setEditing(null);
        }}
        onReset={async () => {
          if (!editing) return;
          await removeOverride(editing.name);
          setEditing(null);
        }}
        onDelete={async () => {
          if (!editing) return;
          const entry = editing;
          await removeOverride(entry.name);
          deleteUndo.addAndShow(entry);
          setEditing(null);
        }}
      />
    </ScreenBackground>
  );
}

function ItemLibraryEntrySheet({
  entry,
  focusField,
  open,
  onOpenChange,
  onSave,
  onToggleHidden,
  onReset,
  onDelete,
}: {
  entry: MergedEntry | null;
  focusField: 'price' | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (days: number | null, priceCents: number | null) => void;
  onToggleHidden: () => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const [days, setDays] = React.useState(entry?.effectiveDays != null ? String(entry.effectiveDays) : '');
  const [price, setPrice] = React.useState(entry?.effectivePriceCents != null ? String(entry.effectivePriceCents / 100) : '');
  const priceInputRef = React.useRef<TextInput>(null);

  // `autoFocus` doesn't reliably raise the keyboard inside a BottomSheet —
  // focus via a ref in an effect instead. The sheet remounts per open
  // (`key={editing?.name ?? 'none'}` at the call site), so `focusField` is
  // enough state; no reset-on-close needed here. Deferred a tick (matching
  // `editable-text.tsx`'s precedent) since the sheet is a Modal — a separate
  // native window on Android — and may not be laid out yet on the same
  // commit that mounts it.
  React.useEffect(() => {
    if (focusField !== 'price') return;
    const t = setTimeout(() => priceInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [focusField]);

  if (!entry) return null;

  const daysParsed = parseDaysField(days);
  const priceParsed = parsePriceField(price);
  const daysHumanized = daysParsed.valid ? formatRebuyInterval(daysParsed.value) : null;
  const canSave = daysParsed.valid && priceParsed.valid;

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="pb-2">
      <View className="gap-3 px-4 pb-2 pt-1">
        <View className="flex-row items-center gap-2">
          <GroceryGlyph emoji={getGroceryEmoji(entry.name, entry.aisle)} size={24} />
          <Text className="min-w-0 flex-1 font-heading text-title font-medium text-foreground">{entry.name}</Text>
        </View>
        <View className="flex-row gap-2">
          <View className="flex-1 gap-1.5">
            <View className="flex-row items-center gap-1.5">
              <Text className="text-caption font-medium text-muted-foreground">Buy again every (days)</Text>
              {daysHumanized && <Text className="text-caption text-muted-foreground">≈ {daysHumanized}</Text>}
            </View>
            <Input value={days} onChangeText={setDays} keyboardType="number-pad" placeholder="–" />
          </View>
          <View className="flex-1 gap-1.5">
            <Text className="text-caption font-medium text-muted-foreground">Typical price</Text>
            <Input ref={priceInputRef} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="–" />
          </View>
        </View>
        <Button disabled={!canSave} onPress={() => onSave(daysParsed.value, priceParsed.value)}>
          Save
        </Button>
        <View className="flex-row gap-2">
          <Button variant="outline" size="sm" className="flex-1" onPress={onToggleHidden}>
            {entry.hidden ? <Eye size={14} className="text-foreground" /> : <EyeOff size={14} className="text-foreground" />}
            {entry.hidden ? 'Unhide' : 'Hide'}
          </Button>
          {entry.isOverridden && (
            <Button variant="outline" size="sm" className="flex-1" onPress={onReset}>
              <RotateCcw size={14} className="text-foreground" />
              Reset
            </Button>
          )}
          {entry.isCustom && (
            <Button variant="destructive" size="sm" className="flex-1" onPress={onDelete}>
              <Trash2 size={14} className="text-destructive" />
              Delete
            </Button>
          )}
        </View>
      </View>
    </BottomSheet>
  );
}
