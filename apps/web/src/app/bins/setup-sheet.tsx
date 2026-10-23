'use client';

// Bin night: set up or edit the bin days (Hearth E1-E4). Three ways in, in
// the spec's order: type the days in (the default, it works for every
// council), read the council calendar from a photo or PDF (AI), or read
// Home Assistant's Waste Collection Schedule. The last two only fill the
// fields below; nothing is saved until the person checks it and saves.
// Native twin: apps/mobile/src/features/bins/setup-sheet.tsx.
import { useRef, useState } from 'react';
import { Camera, Plus, Trash2, X } from 'lucide-react';
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
import { ItemFormSheet, FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { memberLabel } from '@/app/setup/member-label';
import { readCouncilCalendar, readHomeAssistantBins } from '@/lib/bins-api';
import { cn } from '@/lib/utils';

const BINS_SECTION = { id: 'bins', Icon: Trash2 };
const CHIP = 'min-h-9 rounded-full bg-muted px-3 text-[12.5px] font-medium text-muted-foreground hover:text-foreground';
const CHIP_ON = 'bg-primary/15 text-primary hover:text-primary';

const WEEKDAY_OPTIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => ({ value: String(i), label }));
const EVERY_OPTIONS = [
  { value: '1', label: 'Weekly' },
  { value: '2', label: 'Fortnightly' },
  { value: '3', label: '3 weeks' },
  { value: '4', label: '4 weeks' },
];

type Method = 'manual' | 'council' | 'home-assistant';

export function BinSetupSheet({
  isOpen,
  onClose,
  bins,
  groupMembers,
  memberProfiles,
  currentUserId,
  today,
}: {
  isOpen: boolean;
  onClose: () => void;
  bins: BinsApi;
  groupMembers: GroupMember[];
  memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }>;
  currentUserId: string | null;
  today: string;
}) {
  const modules = useModules();
  const haOn = modules.feature('bins.home-assistant');
  const setup = useBinSetup({ bins, today, readHomeAssistantBins });
  const { method, streams, changes, remindAt, pushOn, pushAt, rotation, reading, readNote, readError, haCalendars, tried } = setup;
  const { updateStream, readHomeAssistant, toggleMember, streamLabel } = setup;
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    return setup.readCouncil(() => readCouncilCalendar(file));
  };

  const submit = () => {
    if (setup.submit()) onClose();
  };

  const nameOf = (id: string) => (id === currentUserId ? 'You' : memberLabel(id, memberProfiles));

  return (
    <ItemFormSheet
      section={BINS_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={bins.streams.length ? 'Bin days' : 'Set up bin night'}
      onSubmit={submit}
      submitLabel="Save bin days"
      saving={reading}
    >
      <FormSection>
        <FieldRow label="Where the days come from" hint="Pick the easiest way. You can change it later.">
          <SegmentedControl
            ariaLabel="Where the days come from"
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
            <div className="space-y-2 pt-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button type="button" disabled={reading} onClick={() => fileRef.current?.click()} className={cn(CHIP, 'inline-flex items-center gap-1.5')}>
                <Camera className="h-4 w-4" />
                {reading ? 'Reading…' : 'Photo of the magnet, or the council PDF'}
              </button>
            </div>
          )}
          {method === 'home-assistant' && (
            <div className="flex flex-wrap gap-1.5 pt-2">
              <button type="button" disabled={reading} onClick={() => void readHomeAssistant()} className={CHIP}>
                {reading ? 'Reading…' : 'Read from Waste Collection Schedule'}
              </button>
              {haCalendars.map((c) => (
                <button key={c.entityId} type="button" disabled={reading} onClick={() => void readHomeAssistant(c.entityId)} className={CHIP}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {readNote && <p className="pt-2 text-xs text-success">{readNote}</p>}
          {readError && <p className="pt-2 text-xs text-destructive">{readError}</p>}
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
                  <button
                    type="button"
                    aria-label={`Remove ${s.name || 'bin'}`}
                    onClick={() => setup.removeStream(s.key)}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : undefined
              }
            >
              <Input value={s.name} onChange={(e) => updateStream(s.key, { name: e.target.value })} placeholder="Red, Recycling, Glass" maxLength={40} />
              <div className="flex flex-wrap gap-1.5 pt-2" role="radiogroup" aria-label="Lid colour">
                {BIN_LIDS.map((lid) => (
                  <button
                    key={lid.id}
                    type="button"
                    role="radio"
                    aria-checked={s.lid === lid.id}
                    aria-label={lid.label}
                    title={lid.label}
                    onClick={() => updateStream(s.key, { lid: lid.id as BinLid, name: s.name || lid.label })}
                    className={cn('flex size-9 items-center justify-center rounded-full border-2 border-transparent', s.lid === lid.id && 'border-primary')}
                  >
                    <span className="size-5 rounded-md border border-foreground/25" style={{ backgroundColor: lid.color }} />
                  </button>
                ))}
              </div>
            </FieldRow>
            <FieldRow label="Collected on">
              <SegmentedControl
                ariaLabel="Weekday"
                size="sm"
                value={String(s.weekday)}
                onChange={(v) => updateStream(s.key, { weekday: Number(v), anchor_date: nextWeekdayISO(today, Number(v), weekOffset) })}
                options={WEEKDAY_OPTIONS}
              />
            </FieldRow>
            <FieldRow label="How often">
              <SegmentedControl
                ariaLabel="How often"
                size="sm"
                value={String(s.every_weeks)}
                onChange={(v) => updateStream(s.key, { every_weeks: Number(v), anchor_date: nextWeekdayISO(today, s.weekday) })}
                options={EVERY_OPTIONS}
              />
            </FieldRow>
            {s.every_weeks > 1 && (
              <FieldRow label="Next collection">
                <SegmentedControl
                  ariaLabel="Next collection"
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
        <button
          type="button"
          onClick={setup.addStream}
          className={cn(CHIP, 'inline-flex items-center gap-1.5')}
        >
          <Plus className="h-4 w-4" />
          Add a bin
        </button>
      </FormSection>

      <FormSection title="Changes">
        {changes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No holiday changes. Add one when the council moves a collection.</p>
        ) : (
          <div className="space-y-1">
            {changes.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {binShortDate(c.on_date)} · {streamLabel(c.streamKey)}
                  <span className="text-muted-foreground"> · {binChangeDraftDetail(c)}</span>
                </span>
                <button
                  type="button"
                  aria-label="Remove change"
                  onClick={() => setup.removeChange(c.key)}
                  className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <AddChange streams={streams} today={today} onAdd={setup.addChange} />
      </FormSection>

      <FormSection title="Reminders">
        <FieldRow label="Show on Home from" htmlFor="bins-remind" hint="On the night before a collection.">
          <Input id="bins-remind" type="time" value={remindAt} onChange={(e) => setup.setRemindAt(e.target.value || '19:00')} className="w-36 font-mono" />
        </FieldRow>
        <FieldRow label="Notification if they're not out">
          <div className="flex items-center gap-3">
            <Switch checked={pushOn} onChange={setup.setPushOn} label="Notification if they're not out" />
            {pushOn && (
              <Input aria-label="Notification time" type="time" value={pushAt} onChange={(e) => setup.setPushAt(e.target.value || '21:00')} className="w-36 font-mono" />
            )}
          </div>
        </FieldRow>
      </FormSection>

      {groupMembers.length > 1 && (
        <FormSection title="Who takes them out">
          <FieldRow hint={rotation.length > 1 ? `Taking turns each week. This week: ${nameOf(rotation[0])}.` : rotation.length === 1 ? `Always ${nameOf(rotation[0])}.` : 'Pick who takes turns, in order. Nobody picked: everyone gets the reminder.'}>
            <div className="flex flex-wrap gap-1.5">
              {groupMembers.map((m) => {
                const at = rotation.indexOf(m.user_id);
                return (
                  <button key={m.user_id} type="button" aria-pressed={at >= 0} onClick={() => toggleMember(m.user_id)} className={cn(CHIP, at >= 0 && CHIP_ON)}>
                    {at >= 0 && <span className="mr-1 font-mono tabular-nums">{at + 1}</span>}
                    {nameOf(m.user_id)}
                  </button>
                );
              })}
            </div>
          </FieldRow>
        </FormSection>
      )}
    </ItemFormSheet>
  );
}

function AddChange({ streams, today, onAdd }: { streams: BinStreamDraft[]; today: string; onAdd: (c: Omit<BinChangeDraft, 'key'>) => void }) {
  const [open, setOpen] = useState(false);
  const [onDate, setOnDate] = useState('');
  const [movedTo, setMovedTo] = useState('');
  const [streamKey, setStreamKey] = useState<string>('all');
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn(CHIP, 'mt-2 inline-flex items-center gap-1.5')}>
        <Plus className="h-4 w-4" />
        Add a change
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-2xl bg-muted/50 p-3">
      <div className="flex flex-wrap gap-1.5">
        {[{ key: 'all', name: 'Every bin' }, ...streams].map((s) => (
          <button key={s.key} type="button" onClick={() => setStreamKey(s.key)} className={cn(CHIP, streamKey === s.key && CHIP_ON)}>
            {s.name || 'Bin'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Usual day
          <Input type="date" min={today} value={onDate} onChange={(e) => setOnDate(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Moves to (blank: none)
          <Input type="date" min={today} value={movedTo} onChange={(e) => setMovedTo(e.target.value)} />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className={CHIP}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!onDate}
          onClick={() => {
            onAdd({ streamKey: streamKey === 'all' ? null : streamKey, on_date: onDate, moved_to: movedTo || null, note: null });
            setOpen(false);
            setOnDate('');
            setMovedTo('');
          }}
          className={cn(CHIP, CHIP_ON, 'disabled:opacity-50')}
        >
          Add change
        </button>
      </div>
    </div>
  );
}
