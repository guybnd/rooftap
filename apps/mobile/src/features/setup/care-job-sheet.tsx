// Home care: add or edit one job (native twin of
// apps/web/src/app/setup/care/care-job-sheet.tsx). Every part of the schedule
// is the household's to change: how often, the next date, who, the reminder.
import * as React from 'react';
import { TextInput, View } from 'react-native';
import {
  Text,
  ItemFormSheet,
  FormSection,
  FieldRow,
  DetailsDisclosure,
  Input,
  SegmentedControl,
  SearchablePicker,
  Switch,
  DateScrollField,
  type PickerOption,
} from '@homeup/ui';
import {
  CARE_AREAS,
  CARE_REMIND_OPTIONS,
  SEASONS,
  careEveryLabel,
  monthBeforeSeason,
  monthShort,
  seasonBeforeMonth,
  seasonLabel,
  type CareArea,
  type CareJob,
  type CareJobEdit,
  type CareUnit,
  type GroupMember,
} from '@homeup/core';
import { sectionIconFor } from '@/lib/section-icons';

const SETUP_SECTION = { id: 'setup', Icon: sectionIconFor('setup') };

type Profiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

const UNIT_OPTIONS: { value: CareUnit; label: string }[] = [
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'year', label: 'Years' },
];

function blank(): CareJobEdit {
  return {
    title: '',
    area: 'other',
    room: null,
    every_n: 3,
    every_unit: 'month',
    season_month: null,
    next_due: null,
    assigned_to: null,
    remind: true,
    remind_days_before: 0,
    notes: null,
  };
}

function fromJob(job: CareJob): CareJobEdit {
  const { title, area, room, every_n, every_unit, season_month, next_due, assigned_to, remind, remind_days_before, notes } = job;
  return { title, area, room, every_n, every_unit, season_month, next_due, assigned_to, remind, remind_days_before, notes };
}

function memberName(userId: string, profiles: Profiles): string {
  const p = profiles[userId];
  return p ? p.name || p.email || 'Member' : 'Former member';
}

export function CareJobSheet({
  open,
  onOpenChange,
  job,
  southern,
  rooms,
  groupMembers,
  memberProfiles,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job?: CareJob;
  southern: boolean;
  rooms: string[];
  groupMembers: GroupMember[];
  memberProfiles: Profiles;
  onSave: (edit: CareJobEdit) => void;
  onDelete?: () => void;
}) {
  const [form, setForm] = React.useState<CareJobEdit>(() => (job ? fromJob(job) : blank()));
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (open && !wasOpen.current) setForm(job ? fromJob(job) : blank());
    wasOpen.current = open;
  }, [open, job]);

  const set = (patch: Partial<CareJobEdit>) => setForm((f) => ({ ...f, ...patch }));
  const cadence = form.season_month ? 'season' : 'interval';

  const roomOptions = React.useMemo<PickerOption[]>(() => rooms.map((r) => ({ value: r, primary: r })), [rooms]);
  const assigneeOptions = React.useMemo<PickerOption[]>(
    () => [{ value: '', primary: 'Anyone' }, ...groupMembers.map((m) => ({ value: m.user_id, primary: memberName(m.user_id, memberProfiles) }))],
    [groupMembers, memberProfiles],
  );
  const whenOptions = React.useMemo<PickerOption[]>(
    () => [
      ...SEASONS.map((s) => ({ value: String(monthBeforeSeason(s, southern)), primary: `Before ${seasonLabel(s).toLowerCase()}` })),
      ...Array.from({ length: 12 }, (_, i) => i + 1)
        .filter((m) => !seasonBeforeMonth(m, southern))
        .map((m) => ({ value: String(m), primary: `In ${monthShort(m)}` })),
    ],
    [southern],
  );
  const areaOptions = React.useMemo<PickerOption[]>(() => CARE_AREAS.map((a) => ({ value: a.id, primary: a.label })), []);
  const canSubmit = !!form.title.trim();

  return (
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      section={SETUP_SECTION}
      title={job ? 'Edit job' : 'Add a job'}
      previewContent={
        job ? (
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 font-heading text-base font-semibold text-foreground" numberOfLines={1}>
              {form.title || 'Untitled job'}
            </Text>
            <Text className="text-xs text-muted-foreground">{careEveryLabel(form, southern)}</Text>
          </View>
        ) : undefined
      }
      onSubmit={() => {
        if (!canSubmit) return;
        onSave(form);
        onOpenChange(false);
      }}
      canSubmit={canSubmit}
      onDelete={onDelete}
      deleteConfirmTitle="Delete this job?"
      deleteConfirmMessage="Its history goes too. To keep it but stop it, pause it instead."
    >
      <FormSection>
        <FieldRow label="Job" required>
          <Input
            autoFocus={!job}
            value={form.title}
            onChangeText={(title) => set({ title })}
            placeholder="e.g., Clean the aircon filters"
          />
        </FieldRow>
        <FieldRow label="How often">
          <SegmentedControl
            options={[
              { value: 'interval', label: 'Every…' },
              { value: 'season', label: 'Once a year' },
            ]}
            value={cadence}
            onChange={(c) =>
              set(c === 'season' ? { season_month: monthBeforeSeason('summer', southern), every_n: 1, every_unit: 'year' } : { season_month: null })
            }
            size="sm"
            accessibilityLabel="How often"
          />
        </FieldRow>
        {cadence === 'interval' ? (
          <View className="flex-row gap-3">
            <View className="w-24">
              <FieldRow label="Every">
                <Input
                  keyboardType="number-pad"
                  value={String(form.every_n)}
                  onChangeText={(t) => set({ every_n: Math.max(1, Math.min(999, Number(t.replace(/\D/g, '')) || 1)) })}
                />
              </FieldRow>
            </View>
            <View className="flex-1">
              <FieldRow label="Unit">
                <SegmentedControl options={UNIT_OPTIONS} value={form.every_unit} onChange={(every_unit) => set({ every_unit })} size="sm" accessibilityLabel="Unit" />
              </FieldRow>
            </View>
          </View>
        ) : (
          <FieldRow label="When">
            <SearchablePicker
              options={whenOptions}
              value={String(form.season_month ?? 1)}
              onChange={(v) => set({ season_month: Number(v) })}
              ariaLabel="When"
            />
          </FieldRow>
        )}
        <FieldRow label="Next due" hint={job ? undefined : 'Leave empty and Rooftap picks a date that is not today.'}>
          <DateScrollField value={form.next_due ?? ''} onChange={(v) => set({ next_due: v || null })} emptyLabel="Pick for us" />
        </FieldRow>
        <FieldRow label="Room">
          <SearchablePicker
            options={roomOptions}
            value={form.room}
            onChange={(room) => set({ room })}
            placeholder="Whole house"
            searchPlaceholder="Search rooms…"
            ariaLabel="Room"
          />
        </FieldRow>
      </FormSection>
      <FormSection title="Reminder">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-medium text-foreground">Remind us</Text>
            <Text className="text-xs text-muted-foreground">Shows on Home and in Calendar, and sends a notification.</Text>
          </View>
          <Switch checked={form.remind} onChange={(remind) => set({ remind })} label="Remind us" />
        </View>
        {form.remind && (
          <FieldRow label="When to remind">
            <SegmentedControl
              options={CARE_REMIND_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
              value={String(form.remind_days_before)}
              onChange={(v) => set({ remind_days_before: Number(v) })}
              wrap
              size="sm"
              accessibilityLabel="When to remind"
            />
          </FieldRow>
        )}
        <FieldRow label="Who">
          <SearchablePicker
            options={assigneeOptions}
            value={form.assigned_to ?? ''}
            onChange={(v) => set({ assigned_to: v || null })}
            placeholder="Anyone"
            ariaLabel="Who does it"
          />
        </FieldRow>
      </FormSection>
      <DetailsDisclosure count={2}>
        <FormSection>
          <FieldRow label="Group">
            <SearchablePicker options={areaOptions} value={form.area} onChange={(v) => set({ area: v as CareArea })} ariaLabel="Group" />
          </FieldRow>
          <FieldRow label="Notes">
            <TextInput
              value={form.notes ?? ''}
              onChangeText={(notes) => set({ notes })}
              placeholder="Filter size, who to call, where the manual is"
              multiline
              numberOfLines={3}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-body text-foreground placeholder:text-muted-foreground"
            />
          </FieldRow>
        </FormSection>
      </DetailsDisclosure>
    </ItemFormSheet>
  );
}
