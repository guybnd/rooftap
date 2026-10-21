// HOUP-79: native Checklists — group-shared checklist templates manager.
// Faithful port of apps/web/src/app/checklists/templates/page.tsx: list every
// group template (seeded starters + user-authored), create/edit/delete them.
// The web page's hand-rolled `fixed inset-0` modal editor becomes a
// BottomSheet (Hearth M4: sheets, not modals); `confirm(...)` becomes a native
// themed dialog.alert confirm.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { use$ } from '@legendapp/state/react';
import { useRouter } from 'expo-router';
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp, ListChecks, Plus, Trash2, X } from 'lucide-react-native';
import {
  Text,
  BottomSheet,
  Button,
  EmptyState,
  HeroLede,
  Input,
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  ScreenBackground,
  SegmentedControl,
} from '@homeup/ui';
import {
  checklistTemplates$,
  checklistTemplateItems$,
  useReconnectSync,
  useStoreHelpers,
  useModules,
  typeMeta,
  typeDescription,
  CHECKLIST_TYPES,
  buildTemplate,
  buildTemplateItem,
  seedStarterTemplates,
  dollarsToCents,
  centsToDollars,
  type ChecklistTemplate,
  type ChecklistTemplateItem,
  type ChecklistType,
  dialog,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { randomUUID } from '@/lib/uuid';
import { checklistTypeIcon } from '@/features/checklists/checklist-ui';

interface DraftItem {
  key: string;
  existingId: string | null;
  label: string;
  costDollars: string;
}

export default function ChecklistTemplatesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group, currentUserId } = useDataCache();

  const templates$ = checklistTemplates$(group?.id);
  const templateItems$ = checklistTemplateItems$(group?.id);
  useReconnectSync(templates$);
  useReconnectSync(templateItems$);

  const templates = use$(() =>
    Object.values(templates$.get() ?? {})
      .filter((t): t is ChecklistTemplate => !!t && !t.deleted)
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
  );
  const items = use$(() =>
    Object.values(templateItems$.get() ?? {}).filter((i): i is ChecklistTemplateItem => !!i && !i.deleted)
  );

  const { writeRow: writeTemplate, patchRow: patchTemplate, softDeleteRow: softDeleteTemplate } = useStoreHelpers(templates$, currentUserId);
  const { writeRow: writeTemplateItem, patchRow: patchTemplateItem, softDeleteRow: softDeleteTemplateItem } = useStoreHelpers(
    templateItems$,
    currentUserId
  );

  const itemsByTemplate = React.useMemo(() => {
    const map = new Map<string, ChecklistTemplateItem[]>();
    for (const it of items) {
      const list = map.get(it.template_id) ?? [];
      list.push(it);
      map.set(it.template_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [items]);

  const seededRef = React.useRef<string | null>(null);
  React.useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, currentUserId]);

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

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

  const editingTemplate = React.useMemo(() => (editingId ? templates.find((t) => t.id === editingId) ?? null : null), [editingId, templates]);
  const editingItems = React.useMemo(() => (editingId ? itemsByTemplate.get(editingId) ?? [] : []), [editingId, itemsByTemplate]);

  const handleDelete = React.useCallback(
    (tpl: ChecklistTemplate) => {
      dialog.alert(`Delete "${tpl.title}"?`, "This can't be undone.", [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            (itemsByTemplate.get(tpl.id) ?? []).forEach((it) => softDeleteTemplateItem(it.id));
            softDeleteTemplate(tpl.id);
            setEditorOpen(false);
            setEditingId(null);
          },
        },
      ]);
    },
    [itemsByTemplate, softDeleteTemplate, softDeleteTemplateItem]
  );

  const handleSave = React.useCallback(
    (draft: { title: string; defaultType: ChecklistType; cadenceDays: number | null; items: DraftItem[] }) => {
      if (!group?.id) return;
      const cadence = draft.defaultType === 'repeating' ? draft.cadenceDays : null;

      if (editingTemplate) {
        patchTemplate(editingTemplate.id, {
          title: draft.title.trim(),
          default_type: draft.defaultType,
          default_cadence_days: cadence,
        });
        const keptIds = new Set(draft.items.map((d) => d.existingId).filter((id): id is string => !!id));
        editingItems.forEach((it) => {
          if (!keptIds.has(it.id)) softDeleteTemplateItem(it.id);
        });
        draft.items.forEach((d, idx) => {
          const cost = draft.defaultType === 'shopping' ? dollarsToCents(d.costDollars) : null;
          if (d.existingId) {
            patchTemplateItem(d.existingId, { label: d.label.trim(), order: idx, default_cost_cents: cost });
          } else {
            writeTemplateItem(
              buildTemplateItem({ templateId: editingTemplate.id, groupId: group.id, label: d.label.trim(), order: idx, defaultCostCents: cost })
            );
          }
        });
      } else {
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
                defaultCostCents: draft.defaultType === 'shopping' ? dollarsToCents(d.costDollars) : null,
              })
            )
          );
      }
      closeEditor();
    },
    [group?.id, currentUserId, editingTemplate, editingItems, patchTemplate, patchTemplateItem, writeTemplate, writeTemplateItem, softDeleteTemplateItem]
  );

  if (!group) {
    return <NoGroupScreen />;
  }

  return (
    <ScreenBackground>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }}
      >
        {/* §11 section screen head: back + the screen's name as a micro label,
            New on the right; then the Hero lede (H1), mirroring web. */}
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="-ml-2 h-11 w-11 items-center justify-center rounded-lg"
          >
            <ArrowLeft size={20} className="text-muted-foreground" />
          </Pressable>
          <Text className="flex-1 text-micro-label uppercase text-muted-foreground">Templates</Text>
          <Button size="sm" onPress={openCreate}>
            <Plus size={14} className="text-primary-foreground" />
            <Text className="text-sm font-medium text-primary-foreground">New template</Text>
          </Button>
        </View>
        <HeroLede
          value={templates.length}
          label={templates.length === 1 ? 'template' : 'templates'}
          caption="Shared with your group"
        />

        {templates.length === 0 ? (
          <EmptyState icon={ListChecks} title="No templates yet" description="Starters are on their way, or create your own." />
        ) : (
          // Tap a row to edit it; Delete lives in the editor (E4), not as a
          // resting row icon (§6).
          <ListGroup>
            {templates.map((tpl) => {
              const meta = typeMeta(tpl.default_type ?? 'plain');
              const count = (itemsByTemplate.get(tpl.id) ?? []).length;
              const cadence = tpl.default_type === 'repeating' ? tpl.default_cadence_days : null;
              return (
                <ListItem key={tpl.id} onPress={() => openEdit(tpl.id)} accessibilityLabel={`Edit ${tpl.title}`}>
                  <LeadingTile sectionId="checklists" Icon={checklistTypeIcon(tpl.default_type)} size="md" />
                  <ListItemContent>
                    <ListItemTitle>{tpl.title}</ListItemTitle>
                    <ListItemMeta>
                      <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                        {cadence != null ? `Every ${cadence === 1 ? 'day' : `${cadence} days`}` : meta.label} · {count}{' '}
                        {count === 1 ? 'item' : 'items'}
                      </Text>
                    </ListItemMeta>
                  </ListItemContent>
                  <ListItemTrailing>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </ListItemTrailing>
                </ListItem>
              );
            })}
          </ListGroup>
        )}
      </ScrollView>

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
    </ScreenBackground>
  );
}

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
  onSave: (draft: { title: string; defaultType: ChecklistType; cadenceDays: number | null; items: DraftItem[] }) => void;
  /** E4: delete sits alone at the end of the editor (existing templates only). */
  onDelete?: () => void;
}) {
  const [title, setTitle] = React.useState(template?.title ?? '');
  const [defaultType, setDefaultType] = React.useState<ChecklistType>(template?.default_type ?? 'plain');
  // Modules: the type description only promises what the household's modules
  // can keep (web's TemplateEditor does the same).
  const modules = useModules();
  const describe = (t: ChecklistType) =>
    typeDescription(t, {
      linkedTask: modules.feature('tasks.checklists'),
      logCosts: modules.feature('costs.from-checklists'),
    });
  const [cadence, setCadence] = React.useState<string>(template?.default_cadence_days != null ? String(template.default_cadence_days) : '7');
  const [draftItems, setDraftItems] = React.useState<DraftItem[]>(() =>
    items.map((it) => ({ key: it.id, existingId: it.id, label: it.label, costDollars: centsToDollars(it.default_cost_cents) }))
  );

  const addItem = () => setDraftItems((prev) => [...prev, { key: randomUUID(), existingId: null, label: '', costDollars: '' }]);
  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    setDraftItems((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const removeItem = (key: string) => setDraftItems((prev) => prev.filter((d) => d.key !== key));
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
      cadenceDays: parsedCadence != null && Number.isFinite(parsedCadence) && parsedCadence > 0 ? Math.round(parsedCadence) : null,
      items: draftItems.filter((d) => d.label.trim()),
    });
  };

  return (
    <BottomSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      showHandle={false}
    >
      <View style={{ maxHeight: 560 }}>
        <View className="flex-row items-center justify-between border-b border-border/60 px-4 pb-3 pt-3">
          <Text className="font-heading text-title font-medium text-foreground">{template ? 'Edit template' : 'New template'}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
            <X size={18} className="text-muted-foreground" />
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-4 px-4 py-4">
          <View className="gap-1.5">
            <Text className="text-caption font-medium text-muted-foreground">Title</Text>
            <Input value={title} onChangeText={setTitle} placeholder="e.g. Weekly reset, Trip packing…" autoFocus maxLength={80} />
          </View>

          <View className="gap-1.5">
            <Text className="text-caption font-medium text-muted-foreground">Default type</Text>
            <SegmentedControl
              options={CHECKLIST_TYPES.map((t) => {
                const Icon = checklistTypeIcon(t);
                return {
                  value: t,
                  label: typeMeta(t).label,
                  icon: <Icon size={14} className={defaultType === t ? 'text-foreground' : 'text-muted-foreground'} />,
                };
              })}
              value={defaultType}
              onChange={setDefaultType}
              accessibilityLabel="Default type"
            />
            <Text className="text-xs text-muted-foreground">{describe(defaultType)}</Text>
          </View>

          {defaultType === 'repeating' && (
            <View className="gap-1.5">
              <Text className="text-caption font-medium text-muted-foreground">Renews every (days)</Text>
              <Input value={cadence} onChangeText={setCadence} placeholder="7" keyboardType="number-pad" className="w-24" />
            </View>
          )}

          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-caption font-medium text-muted-foreground">Items</Text>
              <Text className="text-caption text-muted-foreground">{draftItems.length}</Text>
            </View>
            {draftItems.map((d, idx) => (
              <View key={d.key} className="flex-row items-center gap-2 rounded-xl bg-muted/50 px-2 py-1.5">
                <View className="flex-col">
                  <Pressable
                    onPress={() => moveItem(d.key, -1)}
                    disabled={idx === 0}
                    hitSlop={{ left: 4, right: 4 }}
                    accessibilityLabel="Move item up"
                    className="h-5 w-8 items-center justify-center"
                  >
                    <ChevronUp size={16} className={idx === 0 ? 'text-muted-foreground/30' : 'text-muted-foreground'} />
                  </Pressable>
                  <Pressable
                    onPress={() => moveItem(d.key, 1)}
                    disabled={idx === draftItems.length - 1}
                    hitSlop={{ left: 4, right: 4 }}
                    accessibilityLabel="Move item down"
                    className="h-5 w-8 items-center justify-center"
                  >
                    <ChevronDown size={16} className={idx === draftItems.length - 1 ? 'text-muted-foreground/30' : 'text-muted-foreground'} />
                  </Pressable>
                </View>
                <Input
                  value={d.label}
                  onChangeText={(v) => updateItem(d.key, { label: v })}
                  placeholder="Item label…"
                  className="min-w-0 flex-1 border-0 bg-transparent px-0"
                />
                {defaultType === 'shopping' && (
                  <Input
                    value={d.costDollars}
                    onChangeText={(v) => updateItem(d.key, { costDollars: v })}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    className="w-16"
                  />
                )}
                <Pressable
                  onPress={() => removeItem(d.key)}
                  hitSlop={4}
                  accessibilityLabel="Remove item"
                  className="-mr-1 h-9 w-9 items-center justify-center rounded-lg"
                >
                  <Trash2 size={16} className="text-muted-foreground" />
                </Pressable>
              </View>
            ))}
            <Button variant="ghost" size="sm" className="h-11" onPress={addItem}>
              <Plus size={14} className="text-foreground" />
              <Text className="text-sm text-foreground">Add item</Text>
            </Button>
          </View>

          {onDelete && (
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              className="min-h-11 flex-row items-center gap-1.5 border-t border-border/60 pt-3"
            >
              <Trash2 size={16} className="text-destructive" />
              <Text className="text-body font-medium text-destructive">Delete template</Text>
            </Pressable>
          )}
        </ScrollView>

        <View className="flex-row gap-2 border-t border-border/60 px-4 py-3">
          <View className="flex-1">
            <Button onPress={submit} disabled={!canSave}>
              {template ? 'Save changes' : 'Create template'}
            </Button>
          </View>
          <Button variant="outline" onPress={onClose}>
            Cancel
          </Button>
        </View>
      </View>
    </BottomSheet>
  );
}
