'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useDataCache } from '@/lib/data-cache';
import { SHELF_LIFE_DEFAULTS, canonicalizeItemName, compareStrings, formatRebuyInterval, currencySymbol } from '@homeup/core';
import { getGroceryEmoji } from '@homeup/core';
import { GroceryGlyph } from '@/components/grocery-glyph';
import { AISLE_META, AISLE_ORDER, getAisleColor } from '@homeup/core';
import { formatMoney } from '@homeup/core';
import {
  ArrowLeft, Search, Check, X, Plus, Trash2, RotateCcw, Repeat, DollarSign,
  MoreVertical, EyeOff, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SegmentedControl } from '@/components/ui/segmented-control';

interface Override {
  item_name: string;
  shelf_life_days: number | null;
  typical_price_cents: number | null;
  aisle: string | null;
  hidden: boolean | null;
  created_at: string | null;
}

interface ListItem {
  name: string;
  aisle: string;
}

type MergedEntry = {
  name: string;
  aisle: string;
  defaultDays: number | null;
  defaultPriceCents: number | null;
  effectiveDays: number | null;
  effectivePriceCents: number | null;
  isOverridden: boolean; // a default with a per-group value override
  isCustom: boolean;     // an added item (override with no matching default)
  hidden: boolean;       // built-in hidden via tombstone override
  createdAt: string | null;
};

type EditField = 'days' | 'price';
type SortMode = 'section' | 'name' | 'added';

const canon = (s: string) => canonicalizeItemName(s);
/** An override carries real user data (not just a hidden tombstone). */
const hasOverrideValues = (o: Override) =>
  o.shelf_life_days != null || o.typical_price_cents != null || (o.aisle != null && o.aisle !== '');

export default function ItemLibraryPage() {
  const router = useRouter();
  const { group, loading: groupLoading } = useDataCache();
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('section');
  const [customOnly, setCustomOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<{ name: string; field: EditField } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ label: string; run: () => void | Promise<void> } | null>(null);

  // New custom item form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDays, setNewDays] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!group?.id) return;
    const supabase = createClient();
    const [overridesRes, itemsRes] = await Promise.all([
      supabase
        .from('grocery_item_library')
        .select('item_name, shelf_life_days, typical_price_cents, aisle, hidden, created_at')
        .eq('group_id', group.id),
      supabase
        .from('grocery_items')
        .select('name, aisle')
        .eq('group_id', group.id),
    ]);
    setOverrides((overridesRes.data ?? []) as Override[]);
    setListItems((itemsRes.data ?? []) as ListItem[]);
    setLoading(false);
  }, [group?.id]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // ── Build merged list (canonical keys so potato/potatoes collapse) ──────────
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

  const merged: MergedEntry[] = [
    // Defaults (possibly overridden and/or hidden)
    ...SHELF_LIFE_DEFAULTS.map((d) => {
      const ov = overrideMap.get(canon(d.name));
      const defaultPriceCents = d.price != null ? Math.round(d.price * 100) : null;
      return {
        name: d.name,
        aisle: (ov?.aisle && ov.aisle !== '' ? ov.aisle : d.aisle) ?? 'other',
        defaultDays: d.days,
        defaultPriceCents,
        effectiveDays: ov?.shelf_life_days ?? d.days,
        effectivePriceCents: ov?.typical_price_cents ?? defaultPriceCents,
        isOverridden: !!ov && hasOverrideValues(ov),
        isCustom: false,
        hidden: ov?.hidden ?? false,
        createdAt: ov?.created_at ?? null,
      };
    }),
    // Added items (override rows not matching any default)
    ...overrides
      .filter((o) => !defaultNames.has(canon(o.item_name)))
      .map((o) => ({
        name: o.item_name,
        aisle: (o.aisle && o.aisle !== '' ? o.aisle : aisleFromList(o.item_name, 'other')),
        defaultDays: null,
        defaultPriceCents: null,
        effectiveDays: o.shelf_life_days,
        effectivePriceCents: o.typical_price_cents,
        isOverridden: false,
        isCustom: true,
        hidden: o.hidden ?? false,
        createdAt: o.created_at ?? null,
      })),
  ];

  // List items not represented in defaults or overrides — surface as settable rows.
  const covered = new Set(merged.map((e) => canon(e.name)));
  const seenExtra = new Set<string>();
  for (const it of listItems) {
    const l = canon(it.name);
    if (covered.has(l) || seenExtra.has(l)) continue;
    seenExtra.add(l);
    merged.push({
      name: it.name,
      aisle: it.aisle,
      defaultDays: null,
      defaultPriceCents: null,
      effectiveDays: null,
      effectivePriceCents: null,
      isOverridden: false,
      isCustom: false,
      hidden: false,
      createdAt: null,
    });
  }

  // ── Filter + sort ───────────────────────────────────────────────────────────
  const matchesSearch = (e: MergedEntry) =>
    !search.trim() || e.name.toLowerCase().includes(search.toLowerCase());

  const visible = merged.filter(
    (e) => (showHidden || !e.hidden) && (!customOnly || e.isCustom) && matchesSearch(e)
  );
  const byName = (a: MergedEntry, b: MergedEntry) => compareStrings(a.name, b.name);

  // Aisles to render, in canonical order, then any custom aisles present.
  const presentAisles = new Set(visible.map((e) => e.aisle));
  const orderedAisles = [
    ...AISLE_ORDER.filter((a) => presentAisles.has(a)),
    ...[...presentAisles].filter((a) => !(AISLE_ORDER as string[]).includes(a)).sort(),
  ];

  const flatSorted =
    sort === 'name'
      ? [...visible].sort(byName)
      : [...visible].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || byName(a, b));

  const hiddenCount = merged.filter((e) => e.hidden).length;
  const customisedCount = merged.filter((e) => e.isOverridden || e.isCustom).length;

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveField = async (name: string, field: EditField, value: number) => {
    if (!group?.id) return;
    setSaving(name);
    try {
      const supabase = createClient();
      const patch = field === 'days' ? { shelf_life_days: value } : { typical_price_cents: value };
      await supabase
        .from('grocery_item_library')
        .upsert({ group_id: group.id, item_name: name, ...patch }, { onConflict: 'group_id,item_name' });
      setOverrides((prev) => {
        const i = prev.findIndex((o) => canon(o.item_name) === canon(name));
        if (i >= 0) {
          const u = [...prev];
          u[i] = { ...u[i], ...patch };
          return u;
        }
        return [...prev, { item_name: name, shelf_life_days: null, typical_price_cents: null, aisle: null, hidden: false, created_at: null, ...patch }];
      });
    } finally {
      setSaving(null);
      setEditing(null);
    }
  };

  const removeOverride = async (name: string) => {
    if (!group?.id) return;
    setSaving(name);
    try {
      const supabase = createClient();
      await supabase
        .from('grocery_item_library')
        .delete()
        .eq('group_id', group.id)
        .eq('item_name', name);
      setOverrides((prev) => prev.filter((o) => canon(o.item_name) !== canon(name)));
    } finally {
      setSaving(null);
    }
  };

  const setHidden = async (name: string, hidden: boolean) => {
    if (!group?.id) return;
    setSaving(name);
    try {
      const supabase = createClient();
      await supabase
        .from('grocery_item_library')
        .upsert({ group_id: group.id, item_name: name, hidden }, { onConflict: 'group_id,item_name' });
      setOverrides((prev) => {
        const i = prev.findIndex((o) => canon(o.item_name) === canon(name));
        if (i >= 0) {
          const u = [...prev];
          u[i] = { ...u[i], hidden };
          return u;
        }
        return [...prev, { item_name: name, shelf_life_days: null, typical_price_cents: null, aisle: null, hidden, created_at: null }];
      });
    } finally {
      setSaving(null);
    }
  };

  const hideBuiltIn = async (name: string) => {
    setOpenMenu(null);
    await setHidden(name, true);
    setUndo({ label: `Hid “${name}”`, run: () => setHidden(name, false) });
  };

  const deleteCustom = async (entry: MergedEntry) => {
    setOpenMenu(null);
    await removeOverride(entry.name);
    setUndo({
      label: `Deleted “${entry.name}”`,
      run: async () => {
        if (!group?.id) return;
        const supabase = createClient();
        await supabase.from('grocery_item_library').upsert({
          group_id: group.id,
          item_name: entry.name,
          shelf_life_days: entry.effectiveDays,
          typical_price_cents: entry.effectivePriceCents,
          aisle: entry.aisle,
        }, { onConflict: 'group_id,item_name' });
        await fetchData();
      },
    });
  };

  const addCustom = async () => {
    if (!group?.id || !newName.trim()) return;
    const days = newDays ? parseInt(newDays) : NaN;
    const priceDollars = newPrice ? parseFloat(newPrice) : NaN;
    if (isNaN(days) && isNaN(priceDollars)) return; // need at least one value
    setAddSaving(true);
    try {
      const supabase = createClient();
      await supabase.from('grocery_item_library').upsert({
        group_id: group.id,
        item_name: newName.trim(),
        shelf_life_days: isNaN(days) ? null : days,
        typical_price_cents: isNaN(priceDollars) ? null : Math.round(priceDollars * 100),
      }, { onConflict: 'group_id,item_name' });
      await fetchData();
      setNewName(''); setNewDays(''); setNewPrice('');
      setShowAdd(false);
    } finally {
      setAddSaving(false);
    }
  };

  const startEdit = (name: string, field: EditField, current: number | null) => {
    setOpenMenu(null);
    setEditing({ name, field });
    if (current == null) setEditValue('');
    else setEditValue(field === 'days' ? String(current) : String(current / 100));
  };

  const commitEdit = async (name: string, field: EditField) => {
    if (field === 'days') {
      const days = parseInt(editValue);
      if (isNaN(days) || days <= 0) { setEditing(null); return; }
      await saveField(name, 'days', days);
    } else {
      const dollars = parseFloat(editValue);
      if (isNaN(dollars) || dollars < 0) { setEditing(null); return; }
      await saveField(name, 'price', Math.round(dollars * 100));
    }
  };

  // ── Chip + row renderers ───────────────────────────────────────────────────
  const Chip = ({
    entry,
    field,
    label,
    Icon,
    title,
  }: {
    entry: MergedEntry;
    field: EditField;
    label: string | null;
    Icon: typeof Repeat;
    title: string;
  }) => {
    const isEditing = editing?.name === entry.name && editing.field === field;
    const current = field === 'days' ? entry.effectiveDays : entry.effectivePriceCents;
    if (isEditing) {
      return (
        <div className="flex items-center gap-1">
          {field === 'price' && <span className="text-xs text-muted-foreground">{currencySymbol()}</span>}
          <input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitEdit(entry.name, field);
              if (e.key === 'Escape') setEditing(null);
            }}
            autoFocus
            min={field === 'days' ? 1 : 0}
            step={field === 'price' ? 0.01 : 1}
            inputMode="decimal"
            placeholder={field === 'days' ? 'days' : '0.00'}
            className="w-16 text-center bg-input border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          {field === 'days' && <span className="text-xs text-muted-foreground">d</span>}
          <button onClick={() => void commitEdit(entry.name, field)} aria-label="Save" className="text-primary hover:text-primary/80 p-1">
            <Check className="h-4 w-4" />
          </button>
          <button onClick={() => setEditing(null)} aria-label="Cancel" className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={() => startEdit(entry.name, field, current)}
        title={title}
        className={cn(
          'min-h-[32px] text-xs font-medium tabular-nums rounded-lg px-2 py-1 transition-colors flex items-center gap-1',
          label
            ? 'text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/70'
            : 'text-muted-foreground hover:text-foreground border border-dashed border-border'
        )}
      >
        {/* "$5" already says price, so the $ glyph only marks an unset chip. */}
        {(field === 'days' || !label) && <Icon className="h-3 w-3 opacity-70" />}
        {label ?? 'set'}
      </button>
    );
  };

  const renderRow = (entry: MergedEntry) => {
    const isSavingThis = saving === entry.name;
    const emoji = getGroceryEmoji(entry.name, entry.aisle);
    const menuOpen = openMenu === entry.name;

    return (
      <div key={`${entry.aisle}:${entry.name}`} className={cn('relative flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors first:rounded-t-3xl last:rounded-b-3xl', isSavingThis && 'opacity-60', entry.hidden && 'opacity-50')}>
        <GroceryGlyph emoji={emoji} size={22} className="w-6" />
        <span className="flex-1 text-sm text-foreground truncate">{entry.name}</span>

        {entry.hidden && (
          <span className="text-[11px] font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5 flex-shrink-0">Hidden</span>
        )}
        {!entry.hidden && entry.isOverridden && (
          <span className="text-[11px] font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5 flex-shrink-0">Customised</span>
        )}
        {!entry.hidden && entry.isCustom && (
          <span className="text-[11px] font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5 flex-shrink-0">Custom</span>
        )}

        <Chip entry={entry} field="price" label={entry.effectivePriceCents != null ? formatMoney(entry.effectivePriceCents) : null} Icon={DollarSign} title="Typical price" />
        <Chip entry={entry} field="days" label={formatRebuyInterval(entry.effectiveDays)} Icon={Repeat} title="Buy again every ~N" />

        <button
          onClick={() => setOpenMenu(menuOpen ? null : entry.name)}
          disabled={isSavingThis}
          title="More"
          aria-label={`More actions for ${entry.name}`}
          className="-mr-2 grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex-shrink-0"
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {menuOpen && (
          <div className="absolute right-2 top-11 z-20 min-w-[168px] rounded-lg border border-border bg-popover p-1 shadow-xl shadow-black/40">
            {entry.hidden ? (
              <button onClick={() => { setOpenMenu(null); void setHidden(entry.name, false); }} className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm text-popover-foreground hover:bg-muted">
                <Eye className="h-4 w-4" /> Unhide
              </button>
            ) : entry.isCustom ? (
              <button onClick={() => void deleteCustom(entry)} className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm text-destructive hover:bg-muted">
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            ) : (
              <>
                {entry.isOverridden && (
                  <button onClick={() => { setOpenMenu(null); void removeOverride(entry.name); }} className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm text-popover-foreground hover:bg-muted">
                    <RotateCcw className="h-4 w-4" /> Reset to default
                  </button>
                )}
                <button onClick={() => void hideBuiltIn(entry.name)} className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm text-popover-foreground hover:bg-muted">
                  <EyeOff className="h-4 w-4" /> Hide from library
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderRows = (rows: MergedEntry[]) => (
    <div className="rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)] divide-y divide-border/50">
      {rows.map(renderRow)}
    </div>
  );

  if (groupLoading || loading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-5 pb-24">
      {/* Click-away catcher to close an open row menu */}
      {openMenu && <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />}
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} aria-label="Back" className="-ml-2 grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold tracking-[-0.02em] text-foreground">Item library</h1>
          <p className="text-sm text-muted-foreground">Aisle, typical price and how often to rebuy. New items fill in from here.</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items…"
          className="w-full bg-input border border-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring"
        />
      </div>

      {/* Sort + filter controls */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          options={[
            { value: 'section', label: 'Section' },
            { value: 'name', label: 'Name' },
            { value: 'added', label: 'Last added' },
          ]}
          value={sort}
          onChange={setSort}
          size="sm"
          ariaLabel="Sort the item library"
          className="min-h-[44px] w-fit whitespace-nowrap"
        />
        <button
          onClick={() => setCustomOnly((v) => !v)}
          aria-pressed={customOnly}
          className={cn('min-h-[44px] whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors', customOnly ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border bg-muted text-muted-foreground hover:text-foreground')}
        >
          Custom only
        </button>
        {hiddenCount > 0 && (
          <button
            onClick={() => setShowHidden((v) => !v)}
            aria-pressed={showHidden}
            className={cn('min-h-[44px] whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5', showHidden ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border bg-muted text-muted-foreground hover:text-foreground')}
          >
            {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            Hidden <span className="tabular-nums">{hiddenCount}</span>
          </button>
        )}
      </div>

      {/* Sectioned or flat list */}
      {visible.length === 0 ? (
        <div className="rounded-3xl border border-border/60 bg-card px-4 py-8 text-center text-muted-foreground text-sm shadow-[var(--card-shadow)]">
          {search ? <>No items match &ldquo;{search}&rdquo;</> : 'No items to show'}
        </div>
      ) : sort === 'section' ? (
        <div className="space-y-5">
          {orderedAisles.map((aisle) => {
            const rows = visible.filter((e) => e.aisle === aisle).sort(byName);
            if (rows.length === 0) return null;
            const meta = AISLE_META[aisle as keyof typeof AISLE_META];
            const color = getAisleColor(aisle);
            return (
              <div key={aisle} className="space-y-2">
                <h2 className="flex items-center gap-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  <span className={cn('h-2 w-2 rounded-full', color.dot)} />
                  {meta?.label ?? aisle}
                  <span className="text-xs font-normal tabular-nums text-muted-foreground/70">{rows.length}</span>
                </h2>
                {renderRows(rows)}
              </div>
            );
          })}
        </div>
      ) : (
        renderRows(flatSorted)
      )}

      {/* Add custom item */}
      {showAdd ? (
        <div className="space-y-3 rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
          <p className="text-sm font-medium text-foreground">Add custom item</p>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Item name"
            autoFocus
            className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring"
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Buy again (days)</label>
              <input
                type="number"
                value={newDays}
                onChange={(e) => setNewDays(e.target.value)}
                placeholder="e.g., 7"
                min={1}
                className="mt-1 w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Typical price ($)</label>
              <input
                type="number"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder="e.g., 3.50"
                min={0}
                step={0.01}
                className="mt-1 w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void addCustom()}
              disabled={!newName.trim() || (!newDays && !newPrice) || addSaving}
              className="min-h-[44px] flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {addSaving ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => { setShowAdd(false); setNewName(''); setNewDays(''); setNewPrice(''); }}
              className="min-h-[44px] px-4 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="flex min-h-[44px] items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add custom item
        </button>
      )}

      <p className="text-xs tabular-nums text-muted-foreground">
        {customisedCount} customised · {SHELF_LIFE_DEFAULTS.length} built-in items
      </p>

      {/* Undo toast */}
      {undo && (
        <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-2xl border border-border bg-popover px-4 py-2.5 shadow-xl shadow-black/50">
          <span className="text-sm text-popover-foreground">{undo.label}</span>
          <button
            onClick={async () => { const u = undo; setUndo(null); await u.run(); }}
            className="text-sm font-medium text-primary hover:text-primary/80"
          >
            Undo
          </button>
          <button onClick={() => setUndo(null)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
