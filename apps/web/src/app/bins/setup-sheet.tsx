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
  binDraftWeekOffset,
  binDraftsFrom,
  binShortDate,
  newBinStreamDraft,
  nextWeekdayISO,
  realignBinAnchor,
  useModules,
  type BinChangeDraft,
  type BinLid,
  type BinSource,
  type BinStreamDraft,
  type BinsApi,
  type GroupMember,
  type ParsedBinSetup,
} from '@homeup/core';
import { ItemFormSheet, FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { memberLabel } from '@/app/setup/member-label';
import { readCouncilCalendar, readHomeAssistantBins, type HomeAssistantBinCalendar } from '@/lib/bins-api';
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
  const saved = binDraftsFrom(bins.streams, bins.changes, today);
  const [method, setMethod] = useState<Method>((bins.plan?.setup_source as Method) ?? 'manual');
  const [streams, setStreams] = useState<BinStreamDraft[]>(() => (saved.streams.length ? saved.streams : [newBinStreamDraft('new-0', today)]));
  const [changes, setChanges] = useState<BinChangeDraft[]>(saved.changes);
  const [remindAt, setRemindAt] = useState(bins.plan?.remind_at ?? '19:00');
  const [pushOn, setPushOn] = useState(bins.plan ? bins.plan.push_at !== null : true);
  const [pushAt, setPushAt] = useState(bins.plan?.push_at ?? '21:00');
  const [rotation, setRotation] = useState<string[]>(bins.plan?.rotation ?? []);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [haCalendars, setHaCalendars] = useState<HomeAssistantBinCalendar[]>([]);
  const [tried, setTried] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);
  const key = (prefix: string) => `${prefix}-${nextKey.current++}`;

  const updateStream = (k: string, patch: Partial<BinStreamDraft>) =>
    setStreams((all) => all.map((s) => (s.key === k ? realignBinAnchor({ ...s, ...patch }, today) : s)));

  const applyRead = (setup: ParsedBinSetup, source: BinSource) => {
    // Keep ids of bins already saved under the same name, so their changes and history stay put.
    const byName = new Map(saved.streams.map((s) => [s.name.toLowerCase(), s]));
    const keyMap = new Map<string, string>();
    const merged = setup.streams.map((s) => {
      const existing = byName.get(s.name.toLowerCase());
      const k = existing?.key ?? key('read');
      keyMap.set(s.key, k);
      return { ...s, key: k, id: existing?.id };
    });
    setStreams(merged);
    setChanges(setup.changes.map((c) => ({ ...c, key: key('rc'), streamKey: c.streamKey === null ? null : (keyMap.get(c.streamKey) ?? null) })));
    const n = merged.length;
    const m = setup.changes.length;
    setReadNote(`Found ${n} ${n === 1 ? 'bin' : 'bins'}${m ? ` and ${m} ${m === 1 ? 'change' : 'changes'}` : ''}. Check them below, then save.`);
    setMethod(source === 'council' ? 'council' : 'home-assistant');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setReadError(null);
    setReadNote(null);
    const result = await readCouncilCalendar(file);
    setReading(false);
    if (!result.ok) setReadError(result.error);
    else applyRead(result.setup, 'council');
  };

  const readHomeAssistant = async (entityId?: string) => {
    setReading(true);
    setReadError(null);
    setReadNote(null);
    const result = await readHomeAssistantBins(entityId);
    setReading(false);
    if (!result.ok) {
      setReadError(result.error);
      return;
    }
    setHaCalendars(result.calendars);
    if (result.setup.streams.length === 0) {
      setReadError(
        result.calendars.length
          ? 'No bin calendar found by name. Pick the one that has your bin days.'
          : 'Home Assistant has no calendars. Add the Waste Collection Schedule integration there first.',
      );
      return;
    }
    applyRead(result.setup, 'home-assistant');
  };

  const invalid = streams.some((s) => !s.name.trim());
  const submit = () => {
    setTried(true);
    if (invalid || streams.length === 0) return;
    bins.saveSetup({
      streams,
      changes,
      remindAt,
      pushAt: pushOn ? pushAt : null,
      rotation,
      rotationAnchor: rotation.length > 1 ? (rotation[0] === bins.plan?.rotation[0] ? bins.plan?.rotation_anchor : today) : null,
      source: method,
    });
    onClose();
  };

  const toggleMember = (id: string) => setRotation((r) => (r.includes(id) ? r.filter((m) => m !== id) : [...r, id]));
  const nameOf = (id: string) => (id === currentUserId ? 'You' : memberLabel(id, memberProfiles));
  const streamLabel = (k: string | null) => (k === null ? 'Every bin' : (streams.find((s) => s.key === k)?.name ?? 'Bin'));

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
            onChange={(m) => {
              setMethod(m);
              setReadError(null);
              setReadNote(null);
            }}
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
                    onClick={() => {
                      setStreams((all) => all.filter((x) => x.key !== s.key));
                      setChanges((all) => all.filter((c) => c.streamKey !== s.key));
                    }}
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
          onClick={() => {
            const used = new Set(streams.map((s) => s.lid));
            const lid = (['yellow', 'green', 'blue', 'purple', 'red', 'grey'] as BinLid[]).find((l) => !used.has(l)) ?? 'other';
            setStreams((all) => [...all, { ...newBinStreamDraft(key('new'), today, lid, all[0]?.weekday), every_weeks: 2 }]);
          }}
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
                  <span className="text-muted-foreground"> · {c.moved_to ? (c.moved_to === c.on_date ? 'extra' : `to ${binShortDate(c.moved_to)}`) : 'none'}{c.note ? ` · ${c.note}` : ''}</span>
                </span>
                <button
                  type="button"
                  aria-label="Remove change"
                  onClick={() => setChanges((all) => all.filter((x) => x.key !== c.key))}
                  className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <AddChange streams={streams} today={today} onAdd={(c) => setChanges((all) => [...all, { ...c, key: key('nc') }].sort((a, b) => a.on_date.localeCompare(b.on_date)))} />
      </FormSection>

      <FormSection title="Reminders">
        <FieldRow label="Show on Home from" htmlFor="bins-remind" hint="On the night before a collection.">
          <Input id="bins-remind" type="time" value={remindAt} onChange={(e) => setRemindAt(e.target.value || '19:00')} className="w-36 font-mono" />
        </FieldRow>
        <FieldRow label="Notification if they're not out">
          <div className="flex items-center gap-3">
            <Switch checked={pushOn} onChange={setPushOn} label="Notification if they're not out" />
            {pushOn && (
              <Input aria-label="Notification time" type="time" value={pushAt} onChange={(e) => setPushAt(e.target.value || '21:00')} className="w-36 font-mono" />
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
