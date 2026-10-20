// HOUP-79: native Checklists — live data via HOUP-86's native StoreEnvironment +
// useDataCache() provider. Reuses @homeup/core's checklists domain logic and all
// four Legend stores verbatim (HOUP-73) — no new core code beyond the
// useChecklistToggle/currency-helper promotions this ticket adds (see the
// approved plan). Faithful-but-focused port of
// apps/web/src/app/checklists/page.tsx: active/completed groups, type + date
// pills, a local completion meter, and "Start again" on completed runs.
//
// HOUP-208: ScrollView (via SectionScreen) -> FlashList. Active/completed
// groups flatten into one array via @homeup/ui's flattenGroups/SectionRow
// (the HOUP-205/206 pattern); this screen no longer uses the shared
// SectionScreen shell (its ScrollView doesn't compose with a screen-owned
// FlashList) — the lede/New button hoist into ListHeaderComponent instead,
// with ScreenBackground + safe-area padding applied directly, matching
// tasks/groceries/costs/appointments.
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { use$ } from '@legendapp/state/react';
import { useRouter, type Href } from 'expo-router';
import { Plus, ListChecks } from 'lucide-react-native';
import {
  Text,
  Button,
  EmptyState,
  HeroLede,
  ScreenBackground,
  cn,
  flattenGroups,
  groupFrameClass,
  rowSpacingClassName,
  type SectionRow,
} from '@homeup/ui';
import {
  checklists$,
  checklistItems$,
  householdTasks$,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  useModules,
  cloneRun,
  buildLinkedTask,
  type Checklist,
  type ChecklistTaskItem,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { ChecklistRow } from '@/features/checklists/checklist-row';

export default function ChecklistsSectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group, currentUserId, loading: cacheLoading } = useDataCache();
  // Modules: "Start again" re-links a dashboard to-do only with Tasks and
  // Checklists on (module-features.ts). Off: no task is read or written.
  const syncTask = useModules().feature('tasks.checklists');

  const lists$ = checklists$(group?.id);
  const items$ = checklistItems$(group?.id);
  const tasks$ = householdTasks$(syncTask ? group?.id : undefined);
  useReconnectSync(lists$);
  useReconnectSync(items$);
  useReconnectSync(tasks$);

  const { writeRow: writeList, patchRow: patchList } = useStoreHelpers(lists$, currentUserId);
  const { writeRow: writeItem } = useStoreHelpers(items$, currentUserId);
  const { writeRow: writeTask } = useStoreHelpers(tasks$, currentUserId);
  const storeLoaded = useStoreLoaded(lists$, items$);

  const lists = use$(() =>
    Object.values(lists$.get() ?? {})
      .filter((c): c is Checklist => !!c && !c.deleted)
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  );
  const allItems = use$(() =>
    Object.values(items$.get() ?? {}).filter((i): i is ChecklistTaskItem => !!i && !i.deleted)
  );

  const itemsByList = React.useMemo(() => {
    const m = new Map<string, ChecklistTaskItem[]>();
    for (const it of allItems) {
      const arr = m.get(it.checklist_id) ?? [];
      arr.push(it);
      m.set(it.checklist_id, arr);
    }
    return m;
  }, [allItems]);

  const active = lists.filter((l) => !l.completed_at);
  const completed = lists.filter((l) => l.completed_at);

  // HOUP-208: flatten active/completed groups into one FlashList data array
  // (the HOUP-205/206 pattern).
  const flatData = React.useMemo<SectionRow<Checklist>[]>(
    () =>
      flattenGroups<Checklist>(
        [
          { rows: active },
          { header: completed.length > 0 ? { label: 'Completed', tone: 'muted' as const } : undefined, rows: completed },
        ],
        (l) => l.id
      ),
    [active, completed]
  );

  // "Start again": clone a completed list into a fresh unchecked run, archive
  // the source, re-link a dashboard to-do if it had one, and open the new run.
  const startAgain = (source: Checklist) => {
    const sourceItems = itemsByList.get(source.id) ?? [];
    const { checklist, items: freshItems } = cloneRun({
      source,
      items: sourceItems,
      scheduledDate: source.scheduled_date,
      createdBy: currentUserId,
    });
    writeList(checklist);
    freshItems.forEach(writeItem);
    if (syncTask && checklist.scheduled_date) {
      const task = buildLinkedTask({ checklist, createdBy: currentUserId });
      writeTask(task);
      patchList(checklist.id, { linked_task_id: task.id } as Partial<Checklist>);
    }
    patchList(source.id, { completed_at: new Date().toISOString() } as Partial<Checklist>);
    router.push(`/checklists/${checklist.id}` as Href);
  };

  if (cacheLoading || (!storeLoaded && lists.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  const listHeader = (
    <View className="gap-4 pb-4">
      {/* H1: one lede. Hearth v2 (Pulse): the active count is a Hero number
          under the section's glow; New sits on the label row above it (§11
          section screen head). Rows never restate it. */}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-micro-label uppercase text-muted-foreground">Checklists</Text>
        <Button size="sm" onPress={() => router.push('/checklists/new' as Href)}>
          <Plus size={14} className="text-primary-foreground" />
          <Text className="text-sm font-medium text-primary-foreground">New</Text>
        </Button>
      </View>
      <HeroLede
        value={active.length}
        label="active"
        caption={completed.length > 0 ? `${completed.length} done` : undefined}
      />
      {lists.length === 0 && (
        <EmptyState
          icon={ListChecks}
          title="No checklists yet"
          description="Create one from scratch or a template."
          action={{
            label: 'New checklist',
            onPress: () => router.push('/checklists/new' as Href),
            icon: <Plus size={14} className="text-primary-foreground" />,
          }}
        />
      )}
    </View>
  );

  const renderItem: ListRenderItem<SectionRow<Checklist>> = ({ item: row, index }) => {
    const prev = index > 0 ? flatData[index - 1] : undefined;
    const spacing = rowSpacingClassName(prev, row);
    if (row.kind === 'group-header') {
      return (
        <Text className={cn('cap-inscription px-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground', spacing)}>
          {row.label}
        </Text>
      );
    }
    const list = row.item;
    return (
      <View className={cn(groupFrameClass(row.pos), spacing)}>
        <ChecklistRow
          list={list}
          items={itemsByList.get(list.id) ?? []}
          onPress={() => router.push(`/checklists/${list.id}` as Href)}
          onStartAgain={list.completed_at ? () => startAgain(list) : undefined}
        />
      </View>
    );
  };

  return (
    <ScreenBackground>
      <FlashList
        data={flatData}
        keyExtractor={(row) => row.id}
        getItemType={(row) => row.kind}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 96,
        }}
      />
    </ScreenBackground>
  );
}
