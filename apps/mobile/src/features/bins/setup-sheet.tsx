// Bin night: set up or edit the bin days (Hearth E1-E4). Three ways in, in
// the spec's order: type the days in (the default, it works for every
// council), read the council calendar from a photo or PDF (AI), or read
// Home Assistant's Waste Collection Schedule. The last two only fill the
// fields below; nothing is saved until the person checks it and saves. Time
// and date inputs are scroll fields, since this sheet is itself a
// BottomSheet and can't nest another.
// Web twin: apps/web/src/app/bins/setup-sheet.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Camera, FileText, Plus, Trash2, X } from 'lucide-react-native';
import {
  Button,
  DateScrollField,
  FieldRow,
  FormSection,
  Input,
  ItemFormSheet,
  SegmentedControl,
  Switch,
  Text,
  TimeScrollField,
  cn,
} from '@homeup/ui';
import {
  BIN_LIDS,
  binChangeDraftDetail,
  binDraftWeekOffset,
  binShortDate,
  nextWeekdayISO,
  useBinSetup,
  useModules,
  type BinChangeDraft,
  type BinLid,
  type BinsApi,
  type BinStreamDraft,
  type GroupMember,
} from '@homeup/core';
import { Chip } from '@/features/rewards/chip';
import { readCouncilCalendar, readHomeAssistantBins } from './bins-api';

const BINS_SECTION = { id: 'bins', Icon: Trash2 };

const WEEKDAY_OPTIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => ({ value: String(i), label }));
const EVERY_OPTIONS = [
  { value: '1', label: 'Weekly' },
  { value: '2', label: 'Fortnightly' },
  { value: '3', label: '3 weeks' },
  { value: '4', label: '4 weeks' },
];

type Method = 'manual' | 'council' | 'home-assistant';
type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export function BinSetupSheet({
  open,
  onOpenChange,
  bins,
  groupMembers,
  memberProfiles,
  currentUserId,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bins: BinsApi;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  currentUserId: string | null;
  today: string;
}) {
  const modules = useModules();
  const haOn = modules.feature('bins.home-assistant');
  const setup = useBinSetup({ bins, today, readHomeAssistantBins });
  const { method, streams, changes, remindAt, pushOn, pushAt, rotation, reading, readNote, readError, haCalendars, tried } = setup;
  const { updateStream, readHomeAssistant, toggleMember, streamLabel } = setup;

  const readCouncil = (source: 'camera' | 'file') => setup.readCouncil(() => readCouncilCalendar(source));

  const submit = () => {
    if (setup.submit()) onOpenChange(false);
  };

  const nameOf = (id: string) => {
    if (id === currentUserId) return 'You';
    const p = memberProfiles[id];
    return p ? p.name || p.email || 'Member' : 'Former member';
  };

  return (
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      section={BINS_SECTION}
      title={bins.streams.length ? 'Bin days' : 'Set up bin night'}
      onSubmit={submit}
      submitLabel="Save bin days"
      saving={reading}
    >
      <FormSection>
        <FieldRow label="Where the days come from" hint="Pick the easiest way. You can change it later.">
          <SegmentedControl
            accessibilityLabel="Where the days come from"
            value={method}
            onChange={setup.pickMethod}
            wrap
            options={[
              { value: 'manual', label: "I'll enter them" },
              { value: 'council', label: 'Council calendar' },
              ...(haOn ? [{ value: 'home-assistant' as const, label: 'Home Assistant' }] : []),
            ]}
          />
          {method === 'council' && (
            <View className="flex-row flex-wrap gap-2 pt-1">
              <Button size="sm" variant="secondary" disabled={reading} onPress={() => void readCouncil('camera')}>
                <Camera size={14} className="text-foreground" />
                <Text className="text-sm font-medium text-foreground">{reading ? 'Reading…' : 'Photo of the magnet'}</Text>
              </Button>
              <Button size="sm" variant="secondary" disabled={reading} onPress={() => void readCouncil('file')}>
                <FileText size={14} className="text-foreground" />
                <Text className="text-sm font-medium text-foreground">Photo or PDF from files</Text>
              </Button>
            </View>
          )}
          {method === 'home-assistant' && (
            <View className="flex-row flex-wrap gap-1.5 pt-1">
              <Chip label={reading ? 'Reading…' : 'Read from Waste Collection Schedule'} onPress={reading ? undefined : () => void readHomeAssistant()} />
              {haCalendars.map((c) => (
                <Chip key={c.entityId} label={c.name} onPress={reading ? undefined : () => void readHomeAssistant(c.entityId)} />
              ))}
            </View>
          )}
          {readNote && <Text className="pt-1 text-xs text-success">{readNote}</Text>}
          {readError && <Text className="pt-1 text-xs text-destructive">{readError}</Text>}
        </FieldRow>
      </FormSection>

      {streams.map((s, i) => {
        const weekOffset = binDraftWeekOffset(s, today);
        const weekOptions = Array.from({ length: s.every_weeks }, (_, w) => {
          const date = nextWeekdayISO(today, s.weekday, w);
          return { value: String(w), label: w === 0 ? `This week, ${binShortDate(date)}` : binShortDate(date) };
        });
        return (
          <FormSection key={s.key} title={i === 0 ? 'Bins' : undefined}>
            <FieldRow
              label="Bin"
              required
              error={tried && !s.name.trim() ? 'Name the bin' : null}
              action={
                streams.length > 1 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${s.name || 'bin'}`}
                    hitSlop={8}
                    onPress={() => setup.removeStream(s.key)}
                  >
                    <X size={16} className="text-muted-foreground" />
                  </Pressable>
                ) : undefined
              }
            >
              <Input value={s.name} onChangeText={(name) => updateStream(s.key, { name })} placeholder="Red, Recycling, Glass" maxLength={40} />
              <View className="flex-row flex-wrap gap-1.5 pt-1" accessibilityRole="radiogroup" accessibilityLabel="Lid colour">
                {BIN_LIDS.map((lid) => (
                  <Pressable
                    key={lid.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: s.lid === lid.id }}
                    accessibilityLabel={lid.label}
                    onPress={() => updateStream(s.key, { lid: lid.id as BinLid, name: s.name || lid.label })}
                    className={cn('size-11 items-center justify-center rounded-full border-2 border-transparent', s.lid === lid.id && 'border-primary')}
                  >
                    <View className="size-5 rounded-md border border-foreground/25" style={{ backgroundColor: lid.color }} />
                  </Pressable>
                ))}
              </View>
            </FieldRow>
            <FieldRow label="Collected on">
              <SegmentedControl
                accessibilityLabel="Weekday"
                size="sm"
                value={String(s.weekday)}
                onChange={(v) => updateStream(s.key, { weekday: Number(v), anchor_date: nextWeekdayISO(today, Number(v), weekOffset) })}
                options={WEEKDAY_OPTIONS}
              />
            </FieldRow>
            <FieldRow label="How often">
              <SegmentedControl
                accessibilityLabel="How often"
                size="sm"
                value={String(s.every_weeks)}
                onChange={(v) => updateStream(s.key, { every_weeks: Number(v), anchor_date: nextWeekdayISO(today, s.weekday) })}
                options={EVERY_OPTIONS}
              />
            </FieldRow>
            {s.every_weeks > 1 && (
              <FieldRow label="Next collection">
                <SegmentedControl
                  accessibilityLabel="Next collection"
                  size="sm"
                  wrap
                  value={String(weekOffset)}
                  onChange={(v) => updateStream(s.key, { anchor_date: nextWeekdayISO(today, s.weekday, Number(v)) })}
                  options={weekOptions}
                />
              </FieldRow>
            )}
          </FormSection>
        );
      })}

      <FormSection>
        <View className="flex-row">
          <Button
            size="sm"
            variant="secondary"
            onPress={setup.addStream}
          >
            <Plus size={14} className="text-foreground" />
            <Text className="text-sm font-medium text-foreground">Add a bin</Text>
          </Button>
        </View>
      </FormSection>

      <FormSection title="Changes">
        {changes.length === 0 ? (
          <Text className="text-xs text-muted-foreground">No holiday changes. Add one when the council moves a collection.</Text>
        ) : (
          <View className="gap-1">
            {changes.map((c) => (
              <View key={c.key} className="flex-row items-center gap-2">
                <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-foreground">
                  {binShortDate(c.on_date)} · {streamLabel(c.streamKey)}
                  <Text className="text-sm text-muted-foreground">
                    {' · '}
                    {binChangeDraftDetail(c)}
                  </Text>
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove change"
                  hitSlop={8}
                  onPress={() => setup.removeChange(c.key)}
                  className="size-9 items-center justify-center"
                >
                  <X size={16} className="text-muted-foreground" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <AddChange
          streams={streams}
          today={today}
          onAdd={setup.addChange}
        />
      </FormSection>

      <FormSection title="Reminders">
        <FieldRow label="Show on Home from" hint="On the night before a collection.">
          <TimeScrollField value={remindAt} onChange={(v) => setup.setRemindAt(v.slice(0, 5))} />
        </FieldRow>
        <FieldRow label="Notification if they're not out" action={<Switch checked={pushOn} onChange={setup.setPushOn} label="Notification if they're not out" />}>
          {pushOn ? <TimeScrollField value={pushAt} onChange={(v) => setup.setPushAt(v.slice(0, 5))} /> : null}
        </FieldRow>
      </FormSection>

      {groupMembers.length > 1 && (
        <FormSection title="Who takes them out">
          <FieldRow
            hint={
              rotation.length > 1
                ? `Taking turns each week. This week: ${nameOf(rotation[0])}.`
                : rotation.length === 1
                  ? `Always ${nameOf(rotation[0])}.`
                  : 'Pick who takes turns, in order. Nobody picked: everyone gets the reminder.'
            }
          >
            <View className="flex-row flex-wrap gap-1.5">
              {groupMembers.map((m) => {
                const at = rotation.indexOf(m.user_id);
                return (
                  <Chip key={m.user_id} label={at >= 0 ? `${at + 1}  ${nameOf(m.user_id)}` : nameOf(m.user_id)} selected={at >= 0} onPress={() => toggleMember(m.user_id)} />
                );
              })}
            </View>
          </FieldRow>
        </FormSection>
      )}
    </ItemFormSheet>
  );
}

function AddChange({ streams, today, onAdd }: { streams: BinStreamDraft[]; today: string; onAdd: (c: Omit<BinChangeDraft, 'key'>) => void }) {
  const [open, setOpen] = React.useState(false);
  const [onDate, setOnDate] = React.useState(today);
  const [moves, setMoves] = React.useState(true);
  const [movedTo, setMovedTo] = React.useState(today);
  const [streamKey, setStreamKey] = React.useState<string>('all');
  if (!open) {
    return (
      <View className="flex-row pt-1">
        <Button size="sm" variant="secondary" onPress={() => setOpen(true)}>
          <Plus size={14} className="text-foreground" />
          <Text className="text-sm font-medium text-foreground">Add a change</Text>
        </Button>
      </View>
    );
  }
  return (
    <View className="gap-2 rounded-2xl bg-muted/50 p-3">
      <View className="flex-row flex-wrap gap-1.5">
        {[{ key: 'all', name: 'Every bin' }, ...streams].map((s) => (
          <Chip key={s.key} label={s.name || 'Bin'} selected={streamKey === s.key} onPress={() => setStreamKey(s.key)} />
        ))}
      </View>
      <Text className="text-xs text-muted-foreground">Usual day</Text>
      <DateScrollField value={onDate} onChange={setOnDate} />
      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-muted-foreground">Moves to another day</Text>
        <Switch checked={moves} onChange={setMoves} label="Moves to another day" />
      </View>
      {moves ? <DateScrollField value={movedTo} onChange={setMovedTo} /> : <Text className="text-xs text-muted-foreground">No collection that day.</Text>}
      <View className="flex-row justify-end gap-2">
        <Button size="sm" variant="ghost" onPress={() => setOpen(false)}>
          <Text className="text-sm font-medium text-foreground">Cancel</Text>
        </Button>
        <Button
          size="sm"
          onPress={() => {
            onAdd({ streamKey: streamKey === 'all' ? null : streamKey, on_date: onDate, moved_to: moves ? movedTo : null, note: null });
            setOpen(false);
          }}
        >
          <Text className="text-sm font-medium text-primary-foreground">Add change</Text>
        </Button>
      </View>
    </View>
  );
}
