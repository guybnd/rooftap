'use client';

// Occasions: add or edit an occasion (Hearth E1-E4). What kind, who it is
// for (a member or a name), the day, whether it comes round every year, and
// a gift budget. "Keep it from" sits behind the details for a surprise party.
// Native twin: apps/mobile/src/features/occasions/occasion-form-sheet.tsx.
import { useState } from 'react';
import { Gift } from 'lucide-react';
import {
  OCCASION_KINDS,
  buildOccasion,
  memberFirstName,
  parsePriceInput,
  suggestedOccasionTitle,
  type GroupMember,
  type Occasion,
  type OccasionKind,
  type OccasionsApi,
} from '@homeup/core';
import { ItemFormSheet, FormSection, FieldRow, DetailsDisclosure } from '@/components/ui/item-form-sheet';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const OCCASIONS_SECTION = { id: 'occasions', Icon: Gift };
const CHIP = 'min-h-9 rounded-full px-3 text-[12.5px] font-medium';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;
/** A member's id, a typed name, or nobody (a shared day like Christmas). */
type Who = { kind: 'member'; id: string } | { kind: 'name' } | { kind: 'nobody' };

export function OccasionFormSheet({
  isOpen,
  onClose,
  occasion,
  api,
  groupId,
  currentUserId,
  members,
  profiles,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  occasion?: Occasion;
  api: OccasionsApi;
  groupId: string;
  currentUserId: string | null;
  members: GroupMember[];
  profiles: MemberProfiles;
  onSaved?: (occasion: Occasion) => void;
}) {
  const [kind, setKind] = useState<OccasionKind>(occasion?.kind ?? 'birthday');
  const [who, setWho] = useState<Who>(
    occasion?.person_id ? { kind: 'member', id: occasion.person_id } : occasion?.person_name ? { kind: 'name' } : occasion ? { kind: 'nobody' } : { kind: 'name' },
  );
  const [personName, setPersonName] = useState(occasion?.person_name ?? '');
  const [title, setTitle] = useState(occasion?.title ?? '');
  const [titleTouched, setTitleTouched] = useState(!!occasion);
  const [date, setDate] = useState(occasion?.date ?? '');
  const [repeats, setRepeats] = useState(occasion?.repeats ?? true);
  const [budget, setBudget] = useState(occasion?.budget_cents ? String(occasion.budget_cents / 100) : '');
  const [hidden, setHidden] = useState<string[]>(occasion?.hidden_from ?? []);
  const [tried, setTried] = useState(false);

  const others = members.filter((m) => m.user_id !== currentUserId);
  const person = who.kind === 'member' ? memberFirstName(who.id, profiles) : who.kind === 'name' ? personName.trim() || null : null;
  const shownTitle = titleTouched ? title : suggestedOccasionTitle(kind, person);
  const budgetCents = parsePriceInput(budget);

  const submit = () => {
    setTried(true);
    if (!shownTitle.trim() || !date) return;
    const fields = {
      title: shownTitle.trim(),
      kind,
      date,
      repeats,
      person_id: who.kind === 'member' ? who.id : null,
      person_name: who.kind === 'name' ? personName.trim() || null : null,
      budget_cents: budgetCents,
      hidden_from: hidden.filter((id) => id !== currentUserId),
    };
    const saved: Occasion = occasion
      ? { ...occasion, ...fields }
      : { ...buildOccasion({ id: crypto.randomUUID(), groupId, title: fields.title, kind, date, createdBy: currentUserId }), ...fields, created_at: '', updated_at: '' };
    api.saveOccasion(saved);
    onSaved?.(saved);
    onClose();
  };

  const chip = (active: boolean) => cn(CHIP, active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground');

  return (
    <ItemFormSheet
      section={OCCASIONS_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={occasion ? 'Edit occasion' : 'New occasion'}
      onSubmit={submit}
      submitLabel={occasion ? 'Save' : 'Add occasion'}
      onDelete={occasion ? () => { api.deleteOccasion(occasion.id); onClose(); } : undefined}
      deleteLabel="Remove occasion"
      deleteConfirmMessage="The gift ideas you can see under it go too."
    >
      <FormSection>
        <FieldRow label="Kind">
          <SegmentedControl options={[...OCCASION_KINDS]} value={kind} onChange={setKind} ariaLabel="Kind" />
        </FieldRow>
        <FieldRow label="Who it's for">
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <button key={m.user_id} type="button" onClick={() => setWho({ kind: 'member', id: m.user_id })} className={chip(who.kind === 'member' && who.id === m.user_id)}>
                {m.user_id === currentUserId ? 'Me' : memberFirstName(m.user_id, profiles)}
              </button>
            ))}
            <button type="button" onClick={() => setWho({ kind: 'name' })} className={chip(who.kind === 'name')}>
              Someone else
            </button>
            <button type="button" onClick={() => setWho({ kind: 'nobody' })} className={chip(who.kind === 'nobody')}>
              Everyone
            </button>
          </div>
          {who.kind === 'name' && (
            <Input className="mt-2" value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Name, like Mum" maxLength={60} aria-label="Name" />
          )}
        </FieldRow>
        <FieldRow label="Name" htmlFor="occasion-title" required error={tried && !shownTitle.trim() ? 'Name the occasion' : null}>
          <Input
            id="occasion-title"
            value={shownTitle}
            onChange={(e) => {
              setTitleTouched(true);
              setTitle(e.target.value);
            }}
            placeholder="Christmas"
            maxLength={80}
          />
        </FieldRow>
        <FieldRow label="Day" htmlFor="occasion-date" required error={tried && !date ? 'Pick the day' : null}>
          <Input id="occasion-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FieldRow>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm text-foreground">Every year</span>
          <Switch checked={repeats} onChange={setRepeats} label="Every year" />
        </div>
        <FieldRow label="Gift budget" htmlFor="occasion-budget">
          <Input id="occasion-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Optional" className="tabular-nums" />
        </FieldRow>
      </FormSection>

      {others.length > 0 && (
        <DetailsDisclosure count={1}>
          <FormSection title="Keep it from">
            {others.map((m) => (
              <div key={m.user_id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-sm text-foreground">Keep it from {memberFirstName(m.user_id, profiles)}</span>
                <Switch
                  checked={hidden.includes(m.user_id)}
                  label={`Keep it from ${memberFirstName(m.user_id, profiles)}`}
                  onChange={(next) => setHidden((h) => (next ? [...h, m.user_id] : h.filter((id) => id !== m.user_id)))}
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">For a surprise party. Gift ideas have their own switch.</p>
          </FormSection>
        </DetailsDisclosure>
      )}
    </ItemFormSheet>
  );
}
