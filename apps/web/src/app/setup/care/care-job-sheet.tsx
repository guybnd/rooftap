'use client';

// Home care: add or edit one job. Every part of the schedule is the
// household's to change: how often, the next date, who, and the reminder.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CARE_AREAS,
  CARE_REMIND_OPTIONS,
  SEASONS,
  careEveryLabel,
  monthBeforeSeason,
  monthShort,
  seasonBeforeMonth,
  seasonLabel,
  todayISO,
  type CareArea,
  type CareJob,
  type CareJobEdit,
  type CareUnit,
  type GroupMember,
} from '@homeup/core';
import { ItemFormSheet, FormSection, FieldRow, DetailsDisclosure } from '@/components/ui/item-form-sheet';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SearchablePicker, type PickerOption } from '@/components/ui/searchable-picker';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { sectionIconFor } from '@/lib/section-icons';
import { memberLabel } from '../member-label';

const SETUP_SECTION = { id: 'setup', Icon: sectionIconFor('setup') };

type Profiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

type Cadence = 'interval' | 'season';

const UNIT_OPTIONS: { value: CareUnit; label: string }[] = [
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'year', label: 'Years' },
];

const SELECT =
  'h-9 w-full min-w-0 rounded-lg border border-input bg-input px-3 text-sm text-foreground focus:outline-none focus:border-ring';

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

export function CareJobSheet({
  isOpen,
  job,
  southern,
  rooms,
  groupMembers,
  memberProfiles,
  onClose,
  onSave,
  onDelete,
}: {
  isOpen: boolean;
  job?: CareJob;
  southern: boolean;
  rooms: string[];
  groupMembers: GroupMember[];
  memberProfiles: Profiles;
  onClose: () => void;
  onSave: (edit: CareJobEdit) => void;
  onDelete?: () => void;
}) {
  const [form, setForm] = useState<CareJobEdit>(() => (job ? fromJob(job) : blank()));
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) setForm(job ? fromJob(job) : blank());
    wasOpen.current = isOpen;
  }, [isOpen, job]);

  const cadence: Cadence = form.season_month ? 'season' : 'interval';
  const set = (patch: Partial<CareJobEdit>) => setForm((f) => ({ ...f, ...patch }));

  const roomOptions = useMemo<PickerOption[]>(() => rooms.map((r) => ({ value: r, primary: r })), [rooms]);
  const assigneeOptions = useMemo<PickerOption[]>(
    () => [
      { value: '', primary: 'Anyone' },
      ...groupMembers.map((m) => ({ value: m.user_id, primary: memberLabel(m.user_id, memberProfiles) })),
    ],
    [groupMembers, memberProfiles],
  );

  const season = form.season_month ? seasonBeforeMonth(form.season_month, southern) : null;
  const canSubmit = !!form.title.trim();

  return (
    <ItemFormSheet
      section={SETUP_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={job ? 'Edit job' : 'Add a job'}
      previewContent={
        job ? (
          <>
            <span className="min-w-0 flex-1 truncate font-heading text-base font-semibold text-foreground">
              {form.title || 'Untitled job'}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{careEveryLabel(form, southern)}</span>
          </>
        ) : undefined
      }
      onSubmit={() => {
        if (!canSubmit) return;
        onSave(form);
        onClose();
      }}
      canSubmit={canSubmit}
      onDelete={onDelete}
      deleteConfirmTitle="Delete this job?"
      deleteConfirmMessage="Its history goes too. To keep it but stop it, pause it instead."
    >
      <FormSection>
        <FieldRow label="Job" htmlFor="care-title" required>
          <Input
            id="care-title"
            autoFocus={!job}
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
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
              set(
                c === 'season'
                  ? { season_month: monthBeforeSeason('summer', southern), every_n: 1, every_unit: 'year' }
                  : { season_month: null },
              )
            }
            size="sm"
            ariaLabel="How often"
          />
        </FieldRow>
        {cadence === 'interval' ? (
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Every" htmlFor="care-every">
              <Input
                id="care-every"
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                value={form.every_n}
                onChange={(e) => set({ every_n: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })}
              />
            </FieldRow>
            <FieldRow label="Unit" htmlFor="care-unit">
              <select
                id="care-unit"
                className={SELECT}
                value={form.every_unit}
                onChange={(e) => set({ every_unit: e.target.value as CareUnit })}
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </FieldRow>
          </div>
        ) : (
          <FieldRow label="When" htmlFor="care-month" hint={season ? `${monthShort(form.season_month ?? 1)}, before ${season} starts` : undefined}>
            <select
              id="care-month"
              className={SELECT}
              value={form.season_month ?? 1}
              onChange={(e) => set({ season_month: Number(e.target.value) })}
            >
              {SEASONS.map((s) => (
                <option key={s} value={monthBeforeSeason(s, southern)}>
                  Before {seasonLabel(s).toLowerCase()}
                </option>
              ))}
              {Array.from({ length: 12 }, (_, i) => i + 1)
                .filter((m) => !seasonBeforeMonth(m, southern))
                .map((m) => (
                  <option key={m} value={m}>
                    In {monthShort(m)}
                  </option>
                ))}
            </select>
          </FieldRow>
        )}
        <FieldRow label="Next due" htmlFor="care-next" hint={job ? undefined : 'Leave empty and Rooftap picks a date that is not today.'}>
          <Input
            id="care-next"
            type="date"
            min={job ? undefined : todayISO()}
            value={form.next_due ?? ''}
            onChange={(e) => set({ next_due: e.target.value || null })}
          />
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
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Remind us</p>
            <p className="text-xs text-muted-foreground">Shows on Home and in Calendar, and sends a notification.</p>
          </div>
          <Switch checked={form.remind} onChange={(remind) => set({ remind })} label="Remind us" />
        </div>
        {form.remind && (
          <FieldRow label="When to remind">
            <SegmentedControl
              options={CARE_REMIND_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
              value={String(form.remind_days_before)}
              onChange={(v) => set({ remind_days_before: Number(v) })}
              wrap
              size="sm"
              ariaLabel="When to remind"
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
          <FieldRow label="Group" htmlFor="care-area">
            <select
              id="care-area"
              className={SELECT}
              value={form.area}
              onChange={(e) => set({ area: e.target.value as CareArea })}
            >
              {CARE_AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="Notes" htmlFor="care-notes">
            <textarea
              id="care-notes"
              value={form.notes ?? ''}
              onChange={(e) => set({ notes: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground"
              placeholder="Filter size, who to call, where the manual is"
              rows={3}
            />
          </FieldRow>
        </FormSection>
      </DetailsDisclosure>
    </ItemFormSheet>
  );
}
