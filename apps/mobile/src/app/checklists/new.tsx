// HOUP-79: native Checklists — New checklist flow. Faithful port of
// apps/web/src/app/checklists/new/page.tsx: create from scratch (title + type
// + optional date) or from a group template (seeded starters + user-authored).
// Creating a dated checklist links a dashboard to-do. Instantiation reuses
// @homeup/core's buildChecklist/instantiateTemplate so this and the templates
// manager stay in lockstep.
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { use$ } from '@legendapp/state/react';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ArrowLeft, CalendarDays, ChevronRight, Plus } from 'lucide-react-native';
import {
  Text,
  Button,
  Card,
  DateScrollField,
  Input,
  LeadingTile,
  ScreenBackground,
  SegmentedControl,
  Switch,
} from '@homeup/ui';
import {
  checklists$,
  checklistItems$,
  checklistTemplates$,
  checklistTemplateItems$,
  householdTasks$,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  useModules,
  CHECKLIST_TYPES,
  typeMeta,
  typeDescription,
  buildChecklist,
  buildLinkedTask,
  instantiateTemplate,
  seedStarterTemplates,
  liveItems,
  compareStrings,
  type Checklist,
  type ChecklistTemplate,
  type ChecklistTemplateItem,
  type ChecklistType,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { checklistTypeIcon } from '@/features/checklists/checklist-ui';

export default function NewChecklistScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group, currentUserId, loading: cacheLoading } = useDataCache();
  const modules = useModules();
  // Modules: a dated checklist writes its linked dashboard to-do only with
  // Tasks and Checklists on (module-features.ts). Off: the date stays on the list.
  const syncTask = modules.feature('tasks.checklists');
  // Modules: the Shopping type's "log a purchase" line needs Costs and Checklists (module-features.ts).
  const logCostsOn = modules.feature('costs.from-checklists');

  const lists$ = checklists$(group?.id);
  const items$ = checklistItems$(group?.id);
  const templates$ = checklistTemplates$(group?.id);
  const templateItems$ = checklistTemplateItems$(group?.id);
  const tasks$ = householdTasks$(syncTask ? group?.id : undefined);
  useReconnectSync(lists$);
  useReconnectSync(templates$);
  useReconnectSync(templateItems$);
  useReconnectSync(tasks$);

  const { writeRow: writeList, patchRow: patchList } = useStoreHelpers(lists$, currentUserId);
  const { writeRow: writeItem } = useStoreHelpers(items$, currentUserId);
  const { writeRow: writeTask } = useStoreHelpers(tasks$, currentUserId);
  const { writeRow: writeTemplate } = useStoreHelpers(templates$, currentUserId);
  const { writeRow: writeTemplateItem } = useStoreHelpers(templateItems$, currentUserId);
  const storeLoaded = useStoreLoaded(templates$);

  const templates = use$(() =>
    Object.values(templates$.get() ?? {})
      .filter((t): t is ChecklistTemplate => !!t && !t.deleted)
      .sort((a, b) => compareStrings(a.title, b.title))
  );
  const templateItems = use$(() =>
    Object.values(templateItems$.get() ?? {}).filter((i): i is ChecklistTemplateItem => !!i && !i.deleted)
  );

  // Seed starter templates once (idempotent) so they're offered here even
  // before the templates manager has been visited.
  React.useEffect(() => {
    if (!group?.id) return;
    seedStarterTemplates({
      existing: templates,
      groupId: group.id,
      createdBy: currentUserId,
      writeTemplate,
      writeTemplateItem,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, templates.length]);

  const [title, setTitle] = React.useState('');
  const [type, setType] = React.useState<ChecklistType>('plain');
  // ?date=YYYY-MM-DD (Home's "add to this day") starts it dated.
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();
  const presetDate = typeof dateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : '';
  const [dated, setDated] = React.useState(!!presetDate);
  const [date, setDate] = React.useState(presetDate);

  const linkTaskIfDated = (checklist: Checklist) => {
    if (!syncTask || !checklist.scheduled_date) return;
    const task = buildLinkedTask({ checklist, createdBy: currentUserId });
    writeTask(task);
    patchList(checklist.id, { linked_task_id: task.id } as Partial<Checklist>);
  };

  const createFromScratch = () => {
    if (!group?.id || !title.trim()) return;
    const checklist = buildChecklist({
      groupId: group.id,
      title,
      type,
      scheduledDate: dated && date ? date : null,
      createdBy: currentUserId,
    });
    writeList(checklist);
    linkTaskIfDated(checklist);
    router.push(`/checklists/${checklist.id}` as Href);
  };

  const createFromTemplate = (template: ChecklistTemplate) => {
    if (!group?.id) return;
    const tItems = liveItems(templateItems).filter((i) => i.template_id === template.id);
    const { checklist, items } = instantiateTemplate({
      template,
      items: tItems,
      scheduledDate: dated && date ? date : null,
      createdBy: currentUserId,
    });
    writeList(checklist);
    items.forEach(writeItem);
    linkTaskIfDated(checklist);
    router.push(`/checklists/${checklist.id}` as Href);
  };

  const templateItemCount = (id: string) => liveItems(templateItems).filter((i) => i.template_id === id).length;

  if (cacheLoading || (!storeLoaded && templates.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

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
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="-ml-2 h-11 w-11 items-center justify-center rounded-lg"
          >
            <ArrowLeft size={20} className="text-muted-foreground" />
          </Pressable>
          <Text className="font-heading text-display font-bold text-foreground">New checklist</Text>
        </View>

        {/* From scratch */}
        <Card className="rounded-3xl">
          <View className="gap-4 px-4">
            <Text className="font-heading text-title font-semibold text-foreground">Start from scratch</Text>

            <View className="gap-1.5">
              <Text className="text-caption font-medium text-muted-foreground">Title</Text>
              <Input value={title} onChangeText={setTitle} placeholder="e.g. Weekend camping trip" />
            </View>

            {/* Type: one segmented control (Lucide glyphs, not emoji) with the
                picked type's description under it. Same control on web. */}
            <View className="gap-1.5">
              <Text className="text-caption font-medium text-muted-foreground">Type</Text>
              <SegmentedControl
                options={CHECKLIST_TYPES.map((t) => {
                  const Icon = checklistTypeIcon(t);
                  return {
                    value: t,
                    label: typeMeta(t).label,
                    icon: <Icon size={14} className={type === t ? 'text-foreground' : 'text-muted-foreground'} />,
                  };
                })}
                value={type}
                onChange={setType}
                accessibilityLabel="Checklist type"
              />
              <Text className="text-xs text-muted-foreground">
                {typeDescription(type, { linkedTask: syncTask, logCosts: logCostsOn })}
              </Text>
            </View>

            <View className="gap-2">
              <View className="min-h-11 flex-row items-center gap-3">
                <CalendarDays size={16} className="text-muted-foreground" />
                <View className="min-w-0 flex-1">
                  <Text className="text-body text-foreground">Add a date</Text>
                  {syncTask && <Text className="text-caption text-muted-foreground">Shows on Home</Text>}
                </View>
                <Switch checked={dated} onChange={setDated} label="Add a date" />
              </View>
              {dated && (
                <View className="rounded-2xl bg-muted/40 py-2">
                  <DateScrollField value={date} onChange={setDate} emptyLabel="No date. Spin to pick one" />
                </View>
              )}
            </View>

            <Button onPress={createFromScratch} disabled={!title.trim() || (dated && !date)} className="h-11">
              <Plus size={14} className="text-primary-foreground" />
              <Text className="text-sm font-medium text-primary-foreground">Create checklist</Text>
            </Button>
          </View>
        </Card>

        {/* From a template: one list card, hairline rows (H4: no card in card). */}
        <View className="gap-2">
          <View className="flex-row items-center justify-between gap-2 px-1">
            <Text className="text-micro-label uppercase text-muted-foreground">Start from a template</Text>
            <Pressable
              onPress={() => router.push('/checklists/templates' as Href)}
              accessibilityRole="link"
              className="min-h-11 flex-row items-center gap-0.5"
            >
              <Text className="text-xs font-medium text-primary">Manage templates</Text>
              <ChevronRight size={14} className="text-primary" />
            </Pressable>
          </View>
          {templates.length === 0 ? (
            <Text className="px-1 text-sm text-muted-foreground">No templates yet.</Text>
          ) : (
            <Card className="gap-0 rounded-3xl py-0">
              {templates.map((tpl, idx) => {
                const meta = typeMeta(tpl.default_type ?? 'plain');
                const count = templateItemCount(tpl.id);
                return (
                  <Pressable
                    key={tpl.id}
                    onPress={() => createFromTemplate(tpl)}
                    accessibilityRole="button"
                    className={`min-h-[55px] flex-row items-center gap-3 px-4 py-3 active:bg-accent/30 ${idx > 0 ? 'border-t border-border/60' : ''}`}
                  >
                    <LeadingTile sectionId="checklists" Icon={checklistTypeIcon(tpl.default_type)} size="md" />
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="text-body font-medium text-foreground">
                        {tpl.title}
                      </Text>
                      <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                        {meta.label} · {count} {count === 1 ? 'item' : 'items'}
                      </Text>
                    </View>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </Pressable>
                );
              })}
            </Card>
          )}
          <Text className="px-1 text-xs text-muted-foreground">
            A template copies its items, type and cadence.
            {syncTask && ' Turn on a date above to show it on Home.'}
          </Text>
        </View>
      </ScrollView>
    </ScreenBackground>
  );
}
