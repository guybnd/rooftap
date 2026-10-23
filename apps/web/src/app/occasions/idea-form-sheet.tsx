'use client';

// Occasions: add or edit a gift idea (Hearth E1-E4). Who it is for, the
// occasion, where it's at and the price, then "Keep it from": one switch per
// member, on by default for the member it is for. The database hides a kept
// idea from them, and its price watch and Budget line follow (core
// occasions.ts). Native twin: apps/mobile/src/features/occasions/idea-form-sheet.tsx.
import { useState } from 'react';
import { Gift } from 'lucide-react';
import {
  GIFT_IDEA_STATUSES,
  JOINT_ACCOUNT_GIFT_WARNING,
  buildGiftIdea,
  defaultHiddenFrom,
  formatMoney,
  keepFromHints,
  memberFirstName,
  occasionTitle,
  parsePriceInput,
  revealDay,
  type GiftIdea,
  type GiftIdeaStatus,
  type GroupMember,
  type Occasion,
  type OccasionsApi,
} from '@homeup/core';
import { ItemFormSheet, FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const OCCASIONS_SECTION = { id: 'occasions', Icon: Gift };
const CHIP = 'min-h-9 rounded-full px-3 text-[12.5px] font-medium';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export function IdeaFormSheet({
  isOpen,
  onClose,
  idea,
  occasion,
  api,
  groupId,
  currentUserId,
  members,
  profiles,
  features,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Edit this one; omit to add. */
  idea?: GiftIdea;
  /** The occasion a new idea goes under. */
  occasion: Occasion | null;
  api: OccasionsApi;
  groupId: string;
  currentUserId: string | null;
  members: GroupMember[];
  profiles: MemberProfiles;
  features: { costs: boolean; shopper: boolean };
}) {
  const memberIds = members.map((m) => m.user_id);
  const others = members.filter((m) => m.user_id !== currentUserId);
  const startFor = idea ? idea.for_user_id : occasion?.person_id ?? null;
  const [title, setTitle] = useState(idea?.title ?? '');
  const [occasionId, setOccasionId] = useState<string | null>(idea ? idea.occasion_id : occasion?.id ?? null);
  const [forUserId, setForUserId] = useState<string | null>(startFor);
  const [forName, setForName] = useState(idea ? idea.for_name ?? '' : occasion?.person_name ?? '');
  const [status, setStatus] = useState<GiftIdeaStatus>(idea?.status ?? 'idea');
  const [price, setPrice] = useState(idea?.price_cents ? String(idea.price_cents / 100) : '');
  const [url, setUrl] = useState(idea?.url ?? '');
  const [notes, setNotes] = useState(idea?.notes ?? '');
  const [hidden, setHidden] = useState<string[]>(idea ? idea.hidden_from : defaultHiddenFrom(startFor, currentUserId, memberIds));
  // Who it's kept from follows who it's for until the person touches a switch.
  const [hiddenTouched, setHiddenTouched] = useState(!!idea);
  const [inBudget, setInBudget] = useState(!!api.linkedCostOf(idea));
  const [watch, setWatch] = useState(false);
  const [tried, setTried] = useState(false);

  const chosen = occasionId ? api.occasionById.get(occasionId) ?? null : null;
  const priceCents = parsePriceInput(price);
  const hasWant = !!api.linkedWantOf(idea);
  const hints = keepFromHints({
    names: hidden.map((id) => memberFirstName(id, profiles)),
    revealOn: revealDay(chosen, api.today),
    budget: features.costs && inBudget,
  });

  const pickFor = (userId: string | null) => {
    setForUserId(userId);
    if (!hiddenTouched) setHidden(defaultHiddenFrom(userId, currentUserId, memberIds));
  };

  const pickOccasion = (o: Occasion | null) => {
    setOccasionId(o?.id ?? null);
    if (!idea && o) {
      if (o.person_id) pickFor(o.person_id);
      else if (o.person_name) {
        pickFor(null);
        setForName(o.person_name);
      }
    }
  };

  const submit = () => {
    setTried(true);
    if (!title.trim()) return;
    const fields = {
      title: title.trim(),
      occasion_id: occasionId,
      for_user_id: forUserId,
      for_name: forUserId ? null : forName.trim() || null,
      status,
      price_cents: priceCents,
      url: url.trim() || null,
      notes: notes.trim() || null,
      // Never kept from yourself: you would lose it too.
      hidden_from: hidden.filter((id) => id !== currentUserId),
    };
    const next: GiftIdea = idea
      ? { ...idea, ...fields }
      : { ...buildGiftIdea({ id: crypto.randomUUID(), groupId, title: fields.title, occasionId, hiddenFrom: [], createdBy: currentUserId }), ...fields, created_at: '', updated_at: '' };
    api.saveIdea(next, { inBudget, watch });
    onClose();
  };

  return (
    <ItemFormSheet
      section={OCCASIONS_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={idea ? 'Edit gift idea' : 'New gift idea'}
      onSubmit={submit}
      submitLabel={idea ? 'Save' : 'Save idea'}
      onDelete={idea ? () => { api.deleteIdea(idea); onClose(); } : undefined}
      deleteLabel="Remove idea"
      deleteConfirmMessage={api.linkedCostOf(idea) ? 'Its budget line goes too.' : undefined}
    >
      <FormSection>
        <FieldRow label="Idea" htmlFor="gift-title" required error={tried && !title.trim() ? 'Name the idea' : null}>
          <Input id="gift-title" autoFocus={!idea} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Linen robe, sage" maxLength={120} />
        </FieldRow>
        <FieldRow label="For">
          <div className="flex flex-wrap gap-1.5">
            {others.map((m) => (
              <button
                key={m.user_id}
                type="button"
                onClick={() => pickFor(m.user_id)}
                className={cn(CHIP, forUserId === m.user_id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
              >
                {memberFirstName(m.user_id, profiles)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => pickFor(null)}
              className={cn(CHIP, forUserId === null ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
            >
              Someone else
            </button>
          </div>
          {forUserId === null && (
            <Input className="mt-2" value={forName} onChange={(e) => setForName(e.target.value)} placeholder="Name, like Mum" maxLength={60} aria-label="Who it is for" />
          )}
        </FieldRow>
        {api.occasions.length > 0 && (
          <FieldRow label="Occasion">
            <div className="flex flex-wrap gap-1.5">
              {api.occasions.slice(0, 8).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => pickOccasion(occasionId === o.id ? null : o)}
                  className={cn(CHIP, occasionId === o.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
                >
                  {occasionTitle(o, currentUserId)}
                </button>
              ))}
            </div>
          </FieldRow>
        )}
        <FieldRow label="Where it's at">
          <SegmentedControl options={[...GIFT_IDEA_STATUSES]} value={status} onChange={setStatus} ariaLabel="Where it's at" />
        </FieldRow>
        <FieldRow label="Price" htmlFor="gift-price" error={tried && price.trim() && priceCents === null ? 'Enter a price, like 89' : null}>
          <Input id="gift-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Optional" className="tabular-nums" />
        </FieldRow>
        <FieldRow label="Link" htmlFor="gift-url">
          <Input id="gift-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Optional" autoComplete="off" />
        </FieldRow>
      </FormSection>

      {others.length > 0 && (
        <FormSection title="Keep it from">
          {others.map((m) => {
            const on = hidden.includes(m.user_id);
            return (
              <div key={m.user_id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-sm text-foreground">Keep it from {memberFirstName(m.user_id, profiles)}</span>
                <Switch
                  checked={on}
                  label={`Keep it from ${memberFirstName(m.user_id, profiles)}`}
                  onChange={(next) => {
                    setHiddenTouched(true);
                    setHidden((h) => (next ? [...h, m.user_id] : h.filter((id) => id !== m.user_id)));
                  }}
                />
              </div>
            );
          })}
          {hints.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {hints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
        </FormSection>
      )}

      {(features.costs || (features.shopper && !hasWant)) && (
        <FormSection>
          {features.costs && (
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-sm text-foreground">
                  In the budget{priceCents ? ` · ${formatMoney(priceCents)}` : ''}
                </span>
                <Switch checked={inBudget} onChange={setInBudget} label="In the budget" disabled={!priceCents} />
              </div>
              <p className="text-xs text-muted-foreground">
                {!priceCents ? 'Add a price to put it in the budget.' : hidden.length ? JOINT_ACCOUNT_GIFT_WARNING : 'A one-off purchase in Costs.'}
              </p>
            </div>
          )}
          {features.shopper && !hasWant && (
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-sm text-foreground">Watch the price</span>
                <Switch checked={watch} onChange={setWatch} label="Watch the price" />
              </div>
              <p className="text-xs text-muted-foreground">
                {hidden.length ? 'Adds it to Shopper, kept from the same people.' : 'Adds it to Shopper.'}
              </p>
            </div>
          )}
        </FormSection>
      )}

      <FormSection>
        <FieldRow label="Notes" htmlFor="gift-notes">
          <Input id="gift-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Size, colour, where to get it" maxLength={300} />
        </FieldRow>
      </FormSection>
    </ItemFormSheet>
  );
}
