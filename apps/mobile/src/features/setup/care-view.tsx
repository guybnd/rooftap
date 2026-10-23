// Home care (module `home-care`): Home Setup's Care view, native twin of
// apps/web/src/app/setup/care/care-view.tsx. Jobs in due order, by season or
// by room; only ever added from the picker or by hand, and each one's
// schedule and reminder can be changed or switched off.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronDown, MoreHorizontal, Plus, Sparkles, Wrench } from 'lucide-react-native';
import {
  Text,
  ActionMenu,
  Button,
  HeroLede,
  ItemFormSheet,
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemTitle,
  ListItemTrailing,
  SegmentMeter,
  SegmentedControl,
  haptics,
  toast,
  cn,
  type ActionMenuAnchor,
  type ActionMenuItem,
} from '@homeup/ui';
import {
  CARE_SNOOZE_OPTIONS,
  careDateLabel,
  careDue,
  careDueGroups,
  careEveryLabel,
  careOverview,
  careRoomGroups,
  careRoomOptions,
  careSeasonGroups,
  nextDueAfter,
  seasonLabel,
  suggestionSchedule,
  todayISO,
  useCareJobs,
  useCarePicker,
  type CareJob,
  type GroupMember,
} from '@homeup/core';
import { getStoreEnvironment } from '@homeup/core';
import { sectionIconFor } from '@/lib/section-icons';
import { CareJobSheet } from './care-job-sheet';

type Profiles = Record<string, { email: string; name: string | null; avatar: string | null }>;
type CareMode = 'due' | 'seasons' | 'rooms';

const MODE_KEY = 'homeup-care-mode';
const MODES: { value: CareMode; label: string }[] = [
  { value: 'due', label: 'Due' },
  { value: 'seasons', label: 'Seasons' },
  { value: 'rooms', label: 'Rooms' },
];
const DUE_TONE = { overdue: 'text-destructive', soon: 'text-warning', later: 'text-muted-foreground' } as const;
const SETUP_SECTION = { id: 'setup', Icon: sectionIconFor('setup') };

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{children}</Text>;
}

function PickerList({ picker, southern }: { picker: ReturnType<typeof useCarePicker>; southern: boolean }) {
  const { groups, state, toggle, toggleSkip } = picker;
  if (groups.length === 0) {
    return <Text className="px-1 py-4 text-body text-muted-foreground">Every suggestion is already on your list.</Text>;
  }
  return (
    <View className="gap-4">
      {groups.map((g) => {
        const skipped = state.skipped.has(g.area);
        return (
          <View key={g.area} className="gap-1.5">
            <View className="flex-row items-center justify-between px-1">
              <SectionLabel>{g.label}</SectionLabel>
              <Pressable onPress={() => (haptics.select(), toggleSkip(g.area))} accessibilityRole="button" accessibilityState={{ selected: skipped }} hitSlop={8}>
                <Text className={cn('text-xs font-medium', skipped ? 'text-primary' : 'text-muted-foreground')}>{skipped ? 'Show these' : 'Not for us'}</Text>
              </Pressable>
            </View>
            {skipped ? (
              <Text className="px-1 text-xs text-muted-foreground">Hidden. You can bring them back from the Hidden list.</Text>
            ) : (
              <View className="overflow-hidden rounded-2xl bg-muted/40">
                {g.suggestions.map((s, i) => {
                  const on = state.picked.has(s.id);
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => (haptics.select(), toggle(s.id))}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      className={cn('min-h-12 flex-row items-start gap-3 px-3 py-2.5', i > 0 && 'border-t border-border')}
                    >
                      <View className={cn('mt-0.5 h-5 w-5 items-center justify-center rounded-md border', on ? 'border-primary bg-primary' : 'border-border')}>
                        {on && <Check size={14} strokeWidth={3} className="text-primary-foreground" />}
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="text-body font-medium text-foreground">{s.title}</Text>
                        <Text className="text-xs text-muted-foreground">
                          {careEveryLabel(suggestionSchedule(s, southern), southern)}
                          {s.why ? ` · ${s.why}` : ''}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

export function CareView({
  header,
  groupId,
  currentUserId,
  region,
  groupMembers,
  memberProfiles,
  setupRooms,
}: {
  /** The Setting up / Care switch, drawn at the top of the scroll. */
  header: React.ReactNode;
  groupId: string | undefined;
  currentUserId: string | null;
  region: string | null | undefined;
  groupMembers: GroupMember[];
  memberProfiles: Profiles;
  setupRooms: string[];
}) {
  const insets = useSafeAreaInsets();
  const care = useCareJobs(groupId, currentUserId, region);
  const { jobs, loaded, southern } = care;
  const today = todayISO();

  const [mode, setModeState] = React.useState<CareMode>(() => {
    try {
      const saved = getStoreEnvironment().keyValue.getItem(MODE_KEY);
      return saved === 'seasons' || saved === 'rooms' ? saved : 'due';
    } catch {
      return 'due';
    }
  });
  const setMode = (m: CareMode) => {
    setModeState(m);
    try {
      getStoreEnvironment().keyValue.setItem(MODE_KEY, m);
    } catch {
      // ignore
    }
  };

  const [editing, setEditing] = React.useState<CareJob | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [suggesting, setSuggesting] = React.useState(false);
  const [showPaused, setShowPaused] = React.useState(false);
  const [showHidden, setShowHidden] = React.useState(false);
  const [menu, setMenu] = React.useState<{ job: CareJob; anchor: ActionMenuAnchor } | null>(null);

  const overview = React.useMemo(() => careOverview(jobs, today), [jobs, today]);
  const due = React.useMemo(() => careDueGroups(jobs, today), [jobs, today]);
  const seasons = React.useMemo(() => careSeasonGroups(jobs, today, southern), [jobs, today, southern]);
  const rooms = React.useMemo(() => careRoomGroups(jobs, today), [jobs, today]);
  const roomOptions = React.useMemo(() => careRoomOptions(jobs, setupRooms), [jobs, setupRooms]);
  const paused = React.useMemo(() => jobs.filter((j) => j.state === 'paused'), [jobs]);
  const hidden = React.useMemo(() => jobs.filter((j) => j.state === 'hidden'), [jobs]);

  const firstRun = loaded && jobs.length === 0;
  const firstPicker = useCarePicker(jobs, region, true);
  const sheetPicker = useCarePicker(jobs, region, false);

  const finish = (job: CareJob) => {
    haptics.success();
    care.markDone(job.id);
    toast.message(`Done. Next: ${careDateLabel(nextDueAfter(job, today), today)}`, {
      duration: 5000,
      action: { label: 'Undo', onPress: () => care.undoDone(job.id) },
    });
  };

  const menuItems: ActionMenuItem[] = menu
    ? [
        { key: 'skip', label: 'Skip this time', onPress: () => (setMenu(null), care.skip(menu.job.id)) },
        ...CARE_SNOOZE_OPTIONS.map((o) => ({
          key: `snooze-${o.days}`,
          label: `Push back ${o.label.toLowerCase()}`,
          onPress: () => (setMenu(null), care.snooze(menu.job.id, o.days)),
        })),
        { key: 'edit', label: 'Change schedule', onPress: () => (setMenu(null), setEditing(menu.job)) },
        { key: 'pause', label: 'Pause', onPress: () => (setMenu(null), care.setState(menu.job.id, 'paused')) },
        { key: 'hide', label: "We don't have this", onPress: () => (setMenu(null), care.setState(menu.job.id, 'hidden')) },
      ]
    : [];

  const row = (job: CareJob) => <CareRow key={job.id} job={job} today={today} southern={southern} showRoom={mode !== 'rooms'} onOpen={() => setEditing(job)} onDone={() => finish(job)} onMore={(anchor) => setMenu({ job, anchor })} />;

  const scrollPad = { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 };

  const sheets = (
    <>
      <CareJobSheet
        open={adding || !!editing}
        onOpenChange={(o) => {
          if (!o) {
            setAdding(false);
            setEditing(null);
          }
        }}
        job={editing ?? undefined}
        southern={southern}
        rooms={roomOptions}
        groupMembers={groupMembers}
        memberProfiles={memberProfiles}
        onSave={(edit) => {
          if (editing) care.saveJob(editing.id, edit);
          else care.addJob(edit);
        }}
        onDelete={editing ? () => care.remove(editing.id) : undefined}
      />
      <ItemFormSheet
        open={suggesting}
        onOpenChange={(o) => {
          if (o) sheetPicker.reset();
          setSuggesting(o);
        }}
        section={SETUP_SECTION}
        title="Add from suggestions"
        submitLabel={
          sheetPicker.state.picked.size > 0
            ? `Add ${sheetPicker.state.picked.size} ${sheetPicker.state.picked.size === 1 ? 'job' : 'jobs'}`
            : sheetPicker.state.skipped.size > 0
              ? 'Save'
              : 'Add'
        }
        canSubmit={sheetPicker.state.picked.size > 0 || sheetPicker.state.skipped.size > 0}
        onSubmit={() => {
          const { picked, hidden: h } = sheetPicker.result();
          care.addSuggestions(picked, h);
          setSuggesting(false);
        }}
      >
        <PickerList picker={sheetPicker} southern={southern} />
      </ItemFormSheet>
      <ActionMenu anchor={menu?.anchor ?? null} onClose={() => setMenu(null)} items={menuItems} />
    </>
  );

  if (!loaded) {
    return (
      <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4" contentContainerStyle={scrollPad}>
        {header}
      </ScrollView>
    );
  }

  if (firstRun) {
    const count = firstPicker.state.picked.size;
    return (
      <>
        <ScrollView className="flex-1" contentContainerClassName="gap-5 px-4" contentContainerStyle={{ ...scrollPad, paddingBottom: insets.bottom + 168 }}>
          {header}
          <View className="gap-1.5">
            <Text className="font-heading text-2xl font-bold text-foreground">What does your home need?</Text>
            <Text className="text-body text-muted-foreground">
              Tick the jobs you want reminders for. Each one starts at a relaxed pace, and you can change how often, who does it, or switch it off later. Nothing is added unless you pick it.
            </Text>
          </View>
          <PickerList picker={firstPicker} southern={southern} />
        </ScrollView>
        <View className="absolute inset-x-2 flex-row gap-2 rounded-2xl bg-background/95 p-2" style={{ bottom: insets.bottom + 80 }}>
          <Button variant="outline" className="flex-1" onPress={() => setAdding(true)}>
            <Text className="font-medium text-foreground">Add your own</Text>
          </Button>
          <Button
            className="flex-1"
            disabled={count === 0 && firstPicker.state.skipped.size === 0}
            onPress={() => {
              haptics.commit();
              const { picked, hidden: h } = firstPicker.result();
              care.addSuggestions(picked, h);
            }}
          >
            <Text className="font-semibold text-primary-foreground">{count > 0 ? `Add ${count} ${count === 1 ? 'job' : 'jobs'}` : 'Add jobs'}</Text>
          </Button>
        </View>
        {sheets}
      </>
    );
  }

  const caption = [overview.overdue > 0 ? `${overview.overdue} overdue` : null, `${overview.active} on the schedule`].filter(Boolean).join(' · ');

  return (
    <>
      <ScrollView className="flex-1" contentContainerClassName="gap-5 px-4" contentContainerStyle={scrollPad}>
        {header}
        <HeroLede value={overview.dueThisMonth} label="due this month" caption={caption} />
        <View className="flex-row gap-2">
          <Button variant="outline" className="flex-1" onPress={() => setSuggesting(true)}>
            <Sparkles size={16} className="text-foreground" />
            <Text className="font-medium text-foreground">Suggestions</Text>
          </Button>
          <Button className="flex-1" onPress={() => setAdding(true)}>
            <Plus size={16} className="text-primary-foreground" />
            <Text className="font-semibold text-primary-foreground">Add job</Text>
          </Button>
        </View>
        <SegmentedControl options={MODES} value={mode} onChange={setMode} size="sm" accessibilityLabel="Show jobs" />

        {overview.active === 0 && (
          <Text className="rounded-3xl bg-card px-4 py-3 text-body text-muted-foreground">Nothing is scheduled. Add a job, or bring one back from the paused list.</Text>
        )}

        {mode === 'due' && (
          <View className="gap-4">
            {due.soon.length > 0 && (
              <View className="gap-2">
                <SectionLabel>Next 30 days</SectionLabel>
                <ListGroup>{due.soon.map(row)}</ListGroup>
              </View>
            )}
            {due.later.length > 0 && (
              <View className="gap-2">
                <SectionLabel>Later</SectionLabel>
                <ListGroup>{due.later.map(row)}</ListGroup>
              </View>
            )}
          </View>
        )}

        {mode === 'seasons' && (
          <View className="gap-4">
            {seasons.map((s) => {
              const total = s.done + s.jobs.length;
              return (
                <View key={s.from} className="gap-2">
                  <View className="flex-row items-baseline justify-between px-1">
                    <Text className="font-heading text-base font-semibold text-foreground">
                      {seasonLabel(s.season)}
                      {s.current ? ', now' : ''}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {s.months}
                      {s.current && total > 0 ? ` · ${s.done} of ${total} done` : ''}
                    </Text>
                  </View>
                  {s.current && total > 0 && <SegmentMeter done={s.done} total={total} className="px-1" />}
                  {s.jobs.length > 0 ? <ListGroup>{s.jobs.map(row)}</ListGroup> : <Text className="px-1 text-body text-muted-foreground">Nothing due.</Text>}
                </View>
              );
            })}
          </View>
        )}

        {mode === 'rooms' && (
          <View className="gap-4">
            {rooms.map((r) => (
              <View key={r.room} className="gap-2">
                <View className="flex-row items-baseline justify-between px-1">
                  <Text className="font-heading text-base font-semibold text-foreground">{r.room}</Text>
                  <Text className={cn('text-xs', r.overdue > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                    {r.overdue > 0 ? `${r.overdue} overdue` : `${r.jobs.length} ${r.jobs.length === 1 ? 'job' : 'jobs'}`}
                  </Text>
                </View>
                <ListGroup>{r.jobs.map(row)}</ListGroup>
              </View>
            ))}
          </View>
        )}

        {paused.length > 0 && (
          <OffList title="Paused" open={showPaused} onToggle={() => setShowPaused((v) => !v)} jobs={paused} southern={southern} today={today} actionLabel="Resume" onAction={(j) => care.setState(j.id, 'active')} onOpen={setEditing} />
        )}
        {hidden.length > 0 && (
          <OffList
            title="Hidden"
            hint="Things your home doesn't have. They stay out of suggestions."
            open={showHidden}
            onToggle={() => setShowHidden((v) => !v)}
            jobs={hidden}
            southern={southern}
            today={today}
            actionLabel="Bring back"
            onAction={(j) => care.setState(j.id, 'active')}
            onOpen={setEditing}
          />
        )}
      </ScrollView>
      {sheets}
    </>
  );
}

function CareRow({
  job,
  today,
  southern,
  showRoom,
  onOpen,
  onDone,
  onMore,
}: {
  job: CareJob;
  today: string;
  southern: boolean;
  showRoom: boolean;
  onOpen: () => void;
  onDone: () => void;
  onMore: (anchor: ActionMenuAnchor) => void;
}) {
  const moreRef = React.useRef<View>(null);
  const when = careDue(job, today);
  const facts = [showRoom ? job.room : null, careEveryLabel(job, southern), job.remind ? null : 'no reminder'].filter(Boolean).join(' · ');
  return (
    <ListItem onPress={onOpen} accessibilityRole="button" accessibilityLabel={job.title}>
      <LeadingTile sectionId="setup" Icon={Wrench} size="sm" />
      <ListItemContent>
        <ListItemTitle numberOfLines={1}>{job.title}</ListItemTitle>
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {when && <Text className={cn('font-medium', DUE_TONE[when.tone])}>{when.text}</Text>}
          {when && facts ? ' · ' : ''}
          {facts}
        </Text>
      </ListItemContent>
      <ListItemTrailing>
        <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel={`Done: ${job.title}`} className="min-h-11 justify-center rounded-lg px-2.5">
          <Text className="font-medium text-primary">Done</Text>
        </Pressable>
        <View ref={moreRef} collapsable={false}>
          <Pressable
            onPress={() => moreRef.current?.measureInWindow((x, y, width, height) => onMore({ x, y, width, height }))}
            accessibilityRole="button"
            accessibilityLabel={`More for ${job.title}`}
            className="h-11 w-9 items-center justify-center"
          >
            <MoreHorizontal size={18} className="text-muted-foreground" />
          </Pressable>
        </View>
      </ListItemTrailing>
    </ListItem>
  );
}

function OffList({
  title,
  hint,
  open,
  onToggle,
  jobs,
  southern,
  today,
  actionLabel,
  onAction,
  onOpen,
}: {
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  jobs: CareJob[];
  southern: boolean;
  today: string;
  actionLabel: string;
  onAction: (job: CareJob) => void;
  onOpen: (job: CareJob) => void;
}) {
  return (
    <View className="gap-2">
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} className="min-h-11 flex-row items-center gap-1.5 px-1">
        <SectionLabel>
          {title} ({jobs.length})
        </SectionLabel>
        <View className="ml-auto" style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <ChevronDown size={16} className="text-muted-foreground" />
        </View>
      </Pressable>
      {open && (
        <>
          {hint && <Text className="px-1 text-xs text-muted-foreground">{hint}</Text>}
          <ListGroup>
            {jobs.map((j) => (
              <ListItem key={j.id} onPress={() => onOpen(j)} accessibilityRole="button">
                <ListItemContent>
                  <ListItemTitle numberOfLines={1} className="text-muted-foreground">
                    {j.title}
                  </ListItemTitle>
                  <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                    {[j.room, careEveryLabel(j, southern), j.last_done ? `last done ${careDateLabel(j.last_done, today)}` : null].filter(Boolean).join(' · ')}
                  </Text>
                </ListItemContent>
                <ListItemTrailing>
                  <Pressable onPress={() => onAction(j)} accessibilityRole="button" className="min-h-11 justify-center rounded-lg px-2.5">
                    <Text className="font-medium text-primary">{actionLabel}</Text>
                  </Pressable>
                </ListItemTrailing>
              </ListItem>
            ))}
          </ListGroup>
        </>
      )}
    </View>
  );
}
