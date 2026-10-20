// HOUP-78: native port of apps/web/src/components/checklist-panel.tsx — a
// group's shared apartment-scoring checklist (full CRUD: add/edit/delete an
// item, category grouping, dealbreaker/bonus/weight). Reads/writes through
// Legend (apartmentChecklistItems$) via useStoreHelpers, same pattern as
// apps/mobile/src/app/(tabs)/setup/index.tsx.
//
// Deliberately scoped down from the web original (all three noted on the
// approved plan, not silent):
//  - No drag-to-reorder — no native DnD lib is wired up yet. Items render in
//    their existing `order` field order within each category.
//  - No dismissible localStorage tutorial card — a web-only first-run nicety.
//  - No bulk multi-select mode — single-item swipe-to-delete + tap-to-edit
//    only. Swipe-to-delete commits immediately (no second-tap confirm),
//    matching every other swipe-delete row in this app (see cost-card.tsx)
//    rather than porting the web's click-again-to-confirm affordance.
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { use$ } from '@legendapp/state/react';
import { Plus, ShieldAlert, Sparkles, Trash2 } from 'lucide-react-native';
import {
  Text,
  DragNumberField,
  FieldRow,
  FormSection,
  Input,
  ItemFormSheet,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  Pill,
  SearchablePicker,
  SwipeActions,
  cn,
  type PickerOption,
  haptics,
} from '@homeup/ui';
import {
  apartmentChecklistItems$,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  type ChecklistItem,
} from '@homeup/core';
import { randomUUID } from '@/lib/uuid';

interface ItemFormState {
  label: string;
  category: string;
  weight: number;
  is_dealbreaker: boolean;
  is_bonus: boolean;
}

function formFromItem(item: ChecklistItem | undefined): ItemFormState {
  return {
    label: item?.label ?? '',
    category: item?.category ?? '',
    weight: item?.weight ?? 5,
    is_dealbreaker: item?.is_dealbreaker ?? false,
    is_bonus: item?.is_bonus ?? false,
  };
}

export function ChecklistPanel({ groupId }: { groupId: string }) {
  const items$ = apartmentChecklistItems$(groupId);
  useReconnectSync(items$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(items$, null);
  const storeLoaded = useStoreLoaded(items$);

  const items = use$(() =>
    Object.values(items$.get() ?? {}).filter((i): i is ChecklistItem => !!i && !i.deleted)
  );

  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<ChecklistItem | undefined>();
  const [form, setForm] = React.useState<ItemFormState>(() => formFromItem(undefined));
  const [addingNewCategory, setAddingNewCategory] = React.useState(false);

  const categories = React.useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(),
    [items]
  );

  const categoryOptions = React.useMemo<PickerOption[]>(
    () => categories.map((c) => ({ value: c, primary: c })),
    [categories]
  );

  const groupedByCategory = React.useMemo(() => {
    const sorted = [...items].sort((a, b) => a.order - b.order);
    const groups = new Map<string, ChecklistItem[]>();
    for (const item of sorted) {
      const cat = item.category || '';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(item);
    }
    // Named categories (alphabetical), uncategorized last — mirrors the web original.
    const named = Array.from(groups.keys()).filter(Boolean).sort();
    const ordered = [...named, ...(groups.has('') ? [''] : [])];
    return ordered.map((cat) => ({ category: cat, items: groups.get(cat) ?? [] }));
  }, [items]);

  const stats = React.useMemo(() => {
    const dealbreakers = items.filter((i) => i.is_dealbreaker).length;
    const bonuses = items.filter((i) => i.is_bonus).length;
    return { total: items.length, dealbreakers, bonuses };
  }, [items]);

  const openCreate = () => {
    setEditingItem(undefined);
    setForm(formFromItem(undefined));
    setAddingNewCategory(categories.length === 0);
    setSheetOpen(true);
  };

  const openEdit = (item: ChecklistItem) => {
    setEditingItem(item);
    setForm(formFromItem(item));
    setAddingNewCategory(!!item.category && !categories.includes(item.category));
    setSheetOpen(true);
  };

  const canSubmit = form.label.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (editingItem) {
      patchRow(editingItem.id, {
        label: form.label.trim(),
        category: form.category.trim(),
        weight: form.weight,
        is_dealbreaker: form.is_dealbreaker,
        is_bonus: form.is_bonus,
      });
    } else {
      const maxOrder = items.length > 0 ? Math.max(...items.map((i) => i.order)) + 1 : 0;
      writeRow({
        id: randomUUID(),
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
    setSheetOpen(false);
  };

  const handleDelete = (item: ChecklistItem) => {
    haptics.remove();
    softDeleteRow(item.id);
  };

  const handleDeleteFromSheet = () => {
    if (!editingItem) return;
    softDeleteRow(editingItem.id);
    setSheetOpen(false);
  };

  if (!storeLoaded && items.length === 0) {
    return (
      <View className="flex-1 items-center justify-center py-10">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <StatPill label="Items" value={stats.total} />
          {stats.dealbreakers > 0 && <StatPill label="Dealbreakers" value={stats.dealbreakers} tone="destructive" />}
          {stats.bonuses > 0 && <StatPill label="Bonus" value={stats.bonuses} tone="primary" />}
        </View>
        <Pressable
          onPress={openCreate}
          className="flex-row items-center gap-1.5 rounded-full bg-primary px-3 py-1.5"
          accessibilityRole="button"
          accessibilityLabel="Add checklist item"
        >
          <Plus size={14} className="text-primary-foreground" />
          <Text className="text-sm font-medium text-primary-foreground">Add</Text>
        </Pressable>
      </View>

      {items.length === 0 ? (
        <View className="items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10">
          <Text className="text-center text-sm text-muted-foreground">No checklist items yet.</Text>
          <Text className="text-center text-xs text-muted-foreground/70">
            Add your first item to start scoring apartments.
          </Text>
        </View>
      ) : (
        <View className="gap-4">
          {groupedByCategory.map(({ category, items: categoryItems }) => (
            <View key={category || '__uncategorized'} className="gap-2">
              <View className="flex-row items-center gap-1.5 px-1">
                <Text className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  {category || 'Uncategorized'}
                </Text>
                <Text className="text-xs tabular-nums text-muted-foreground">({categoryItems.length})</Text>
              </View>
              <ListGroup>
                {categoryItems.map((item) => (
                  <SwipeActions
                    key={item.id}
                    onSwipeLeft={() => handleDelete(item)}
                    left={{
                      bg: 'bg-destructive/15',
                      activeBg: 'bg-destructive',
                      icon: <Trash2 size={18} className="text-destructive" />,
                      label: 'Delete',
                    }}
                  >
                    <ListItem onPress={() => openEdit(item)}>
                      <ListItemContent>
                        <ListItemTitle>{item.label}</ListItemTitle>
                        <ListItemMeta>
                          <ItemTypePill item={item} />
                          <Text className="text-caption text-muted-foreground">Weight {item.weight}</Text>
                        </ListItemMeta>
                      </ListItemContent>
                      <ListItemTrailing>
                        <View className="h-[3px] w-8 overflow-hidden rounded-full bg-muted/60">
                          <View
                            className={cn(
                              'h-full rounded-full',
                              item.is_dealbreaker ? 'bg-destructive/60' : item.is_bonus ? 'bg-primary/60' : 'bg-foreground/20'
                            )}
                            style={{ width: `${(item.weight / 10) * 100}%` }}
                          />
                        </View>
                      </ListItemTrailing>
                    </ListItem>
                  </SwipeActions>
                ))}
              </ListGroup>
            </View>
          ))}
        </View>
      )}

      <ItemFormSheet
        key={editingItem?.id ?? 'new'}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={editingItem ? 'Edit item' : 'New item'}
        onSubmit={handleSubmit}
        canSubmit={canSubmit}
        onDelete={editingItem ? handleDeleteFromSheet : undefined}
        deleteConfirmTitle={editingItem ? `Delete "${editingItem.label}"?` : undefined}
      >
        <FormSection>
          <FieldRow label="Label" required>
            <Input
              autoFocus
              value={form.label}
              onChangeText={(label) => setForm((f) => ({ ...f, label }))}
              placeholder="e.g. Natural light"
            />
          </FieldRow>

          <FieldRow
            label="Category"
            action={
              categories.length > 0 ? (
                <Pressable
                  onPress={() => {
                    setAddingNewCategory((v) => !v);
                    setForm((f) => ({ ...f, category: '' }));
                  }}
                  hitSlop={6}
                >
                  <Text className="text-xs font-medium text-primary">
                    {addingNewCategory ? 'Choose existing' : '+ New category'}
                  </Text>
                </Pressable>
              ) : undefined
            }
          >
            {addingNewCategory || categories.length === 0 ? (
              <Input
                value={form.category}
                onChangeText={(category) => setForm((f) => ({ ...f, category }))}
                placeholder="e.g. Essentials"
              />
            ) : (
              <SearchablePicker
                options={categoryOptions}
                value={form.category || null}
                onChange={(category) => setForm((f) => ({ ...f, category }))}
                placeholder="Select a category…"
                searchPlaceholder="Search categories…"
                ariaLabel="Category"
              />
            )}
          </FieldRow>

          <FieldRow label="Weight" hint="How much this item matters, 1 (nice to have) to 10 (critical).">
            <DragNumberField
              value={form.weight}
              onChange={(weight) => setForm((f) => ({ ...f, weight: weight ?? 5 }))}
              min={1}
              max={10}
              allowEmpty={false}
              accessibilityLabel="Weight"
            />
          </FieldRow>

          <FieldRow label="Type">
            <View className="flex-row gap-2">
              <TypeToggle
                active={form.is_dealbreaker}
                label="Dealbreaker"
                icon={<ShieldAlert size={12} className={form.is_dealbreaker ? 'text-destructive' : 'text-muted-foreground'} />}
                tone="destructive"
                onPress={() =>
                  setForm((f) => ({ ...f, is_dealbreaker: !f.is_dealbreaker, is_bonus: f.is_dealbreaker ? f.is_bonus : false }))
                }
              />
              <TypeToggle
                active={form.is_bonus}
                label="Bonus"
                icon={<Sparkles size={12} className={form.is_bonus ? 'text-primary' : 'text-muted-foreground'} />}
                tone="primary"
                onPress={() => setForm((f) => ({ ...f, is_bonus: !f.is_bonus, is_dealbreaker: f.is_bonus ? f.is_dealbreaker : false }))}
              />
            </View>
          </FieldRow>
        </FormSection>
      </ItemFormSheet>
    </View>
  );
}

function StatPill({ label, value, tone }: { label: string; value: number; tone?: 'destructive' | 'primary' }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          tone === 'destructive' ? 'bg-destructive' : tone === 'primary' ? 'bg-primary' : 'bg-muted-foreground/50'
        )}
      />
      <Text
        className={cn(
          'text-xs',
          tone === 'destructive' ? 'text-destructive' : tone === 'primary' ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        <Text className="font-semibold tabular-nums">{value}</Text> {label}
      </Text>
    </View>
  );
}

function ItemTypePill({ item }: { item: ChecklistItem }) {
  if (item.is_dealbreaker) {
    return (
      <Pill variant="destructive" size="sm">
        <ShieldAlert size={10} className="text-destructive" />
        <Text className="text-[0.65rem] font-bold text-destructive">Dealbreaker</Text>
      </Pill>
    );
  }
  if (item.is_bonus) {
    return (
      <Pill variant="primary" size="sm">
        <Sparkles size={10} className="text-primary" />
        <Text className="text-[0.65rem] font-bold text-primary">Bonus</Text>
      </Pill>
    );
  }
  return (
    <Pill variant="muted" size="sm">
      <Text className="text-[0.65rem] font-medium text-muted-foreground">Required</Text>
    </Pill>
  );
}

function TypeToggle({
  active,
  label,
  icon,
  tone,
  onPress,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  tone: 'destructive' | 'primary';
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Pill variant={active ? tone : 'outline'} className={cn(active && tone === 'destructive' && 'border-destructive/30', active && tone === 'primary' && 'border-primary/30')}>
        {icon}
        <Text className={cn('text-[0.7rem] font-medium', active ? (tone === 'destructive' ? 'text-destructive' : 'text-primary') : 'text-muted-foreground')}>
          {label}
        </Text>
      </Pill>
    </Pressable>
  );
}
