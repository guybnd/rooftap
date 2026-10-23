// Occasions: add or edit a gift idea (Hearth E1-E4). Who it is for, the
// occasion, where it's at and the price, then "Keep it from": one switch per
// member, on by default for the member it is for. The database hides a kept
// idea from them, and its price watch and Budget line follow (core
// occasions.ts). Web twin: apps/web/src/app/occasions/idea-form-sheet.tsx.
import * as React from 'react';
import { View } from 'react-native';
import { Gift } from 'lucide-react-native';
import { FieldRow, FormSection, Input, ItemFormSheet, SegmentedControl, Switch, Text } from '@homeup/ui';
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
import { randomUUID } from '@/lib/uuid';
import { Chip } from './chip';

const OCCASIONS_SECTION = { id: 'occasions', Icon: Gift };

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export function IdeaFormSheet({
  open,
  onOpenChange,
  idea,
  occasion,
  api,
  groupId,
  currentUserId,
  members,
  profiles,
  features,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  const [title, setTitle] = React.useState(idea?.title ?? '');
  const [occasionId, setOccasionId] = React.useState<string | null>(idea ? idea.occasion_id : occasion?.id ?? null);
  const [forUserId, setForUserId] = React.useState<string | null>(startFor);
  const [forName, setForName] = React.useState(idea ? idea.for_name ?? '' : occasion?.person_name ?? '');
  const [status, setStatus] = React.useState<GiftIdeaStatus>(idea?.status ?? 'idea');
  const [price, setPrice] = React.useState(idea?.price_cents ? String(idea.price_cents / 100) : '');
  const [url, setUrl] = React.useState(idea?.url ?? '');
  const [notes, setNotes] = React.useState(idea?.notes ?? '');
  const [hidden, setHidden] = React.useState<string[]>(idea ? idea.hidden_from : defaultHiddenFrom(startFor, currentUserId, memberIds));
  // Who it's kept from follows who it's for until the person touches a switch.
  const [hiddenTouched, setHiddenTouched] = React.useState(!!idea);
  const [inBudget, setInBudget] = React.useState(!!api.linkedCostOf(idea));
  const [watch, setWatch] = React.useState(false);
  const [tried, setTried] = React.useState(false);

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
      : { ...buildGiftIdea({ id: randomUUID(), groupId, title: fields.title, occasionId, hiddenFrom: [], createdBy: currentUserId }), ...fields, created_at: '', updated_at: '' };
    api.saveIdea(next, { inBudget, watch });
    onOpenChange(false);
  };

  return (
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      section={OCCASIONS_SECTION}
      title={idea ? 'Edit gift idea' : 'New gift idea'}
      onSubmit={submit}
      submitLabel={idea ? 'Save' : 'Save idea'}
      onDelete={
        idea
          ? () => {
              api.deleteIdea(idea);
              onOpenChange(false);
            }
          : undefined
      }
      deleteLabel="Remove idea"
      deleteConfirmMessage={api.linkedCostOf(idea) ? 'Its budget line goes too.' : undefined}
    >
      <FormSection>
        <FieldRow label="Idea" required error={tried && !title.trim() ? 'Name the idea' : null}>
          <Input autoFocus={!idea} value={title} onChangeText={setTitle} placeholder="Linen robe, sage" maxLength={120} />
        </FieldRow>
        <FieldRow label="For">
          <View className="flex-row flex-wrap gap-1.5">
            {others.map((m) => (
              <Chip key={m.user_id} label={memberFirstName(m.user_id, profiles)} selected={forUserId === m.user_id} onPress={() => pickFor(m.user_id)} />
            ))}
            <Chip label="Someone else" selected={forUserId === null} onPress={() => pickFor(null)} />
          </View>
          {forUserId === null && (
            <Input className="mt-2" value={forName} onChangeText={setForName} placeholder="Name, like Mum" maxLength={60} accessibilityLabel="Who it is for" />
          )}
        </FieldRow>
        {api.occasions.length > 0 && (
          <FieldRow label="Occasion">
            <View className="flex-row flex-wrap gap-1.5">
              {api.occasions.slice(0, 8).map((o) => (
                <Chip key={o.id} label={occasionTitle(o, currentUserId)} selected={occasionId === o.id} onPress={() => pickOccasion(occasionId === o.id ? null : o)} />
              ))}
            </View>
          </FieldRow>
        )}
        <FieldRow label="Where it's at">
          <SegmentedControl options={[...GIFT_IDEA_STATUSES]} value={status} onChange={setStatus} accessibilityLabel="Where it's at" />
        </FieldRow>
        <FieldRow label="Price" error={tried && price.trim() && priceCents === null ? 'Enter a price, like 89' : null}>
          <Input keyboardType="decimal-pad" value={price} onChangeText={setPrice} placeholder="Optional" className="tabular-nums" />
        </FieldRow>
        <FieldRow label="Link">
          <Input keyboardType="url" autoCapitalize="none" autoCorrect={false} value={url} onChangeText={setUrl} placeholder="Optional" />
        </FieldRow>
      </FormSection>

      {others.length > 0 && (
        <FormSection title="Keep it from">
          {others.map((m) => {
            const name = memberFirstName(m.user_id, profiles);
            return (
              <View key={m.user_id} className="flex-row items-center gap-3">
                <Text className="min-w-0 flex-1 text-sm text-foreground">Keep it from {name}</Text>
                <Switch
                  checked={hidden.includes(m.user_id)}
                  label={`Keep it from ${name}`}
                  onChange={(next) => {
                    setHiddenTouched(true);
                    setHidden((h) => (next ? [...h, m.user_id] : h.filter((id) => id !== m.user_id)));
                  }}
                />
              </View>
            );
          })}
          {hints.length > 0 && (
            <View className="gap-1">
              {hints.map((h) => (
                <Text key={h} className="text-xs text-muted-foreground">
                  {h}
                </Text>
              ))}
            </View>
          )}
        </FormSection>
      )}

      {(features.costs || (features.shopper && !hasWant)) && (
        <FormSection>
          {features.costs && (
            <View className="gap-1">
              <View className="flex-row items-center gap-3">
                <Text className="min-w-0 flex-1 text-sm text-foreground">
                  In the budget{priceCents ? ` · ${formatMoney(priceCents)}` : ''}
                </Text>
                <Switch checked={inBudget} onChange={setInBudget} label="In the budget" disabled={!priceCents} />
              </View>
              <Text className="text-xs text-muted-foreground">
                {!priceCents ? 'Add a price to put it in the budget.' : hidden.length ? JOINT_ACCOUNT_GIFT_WARNING : 'A one-off purchase in Costs.'}
              </Text>
            </View>
          )}
          {features.shopper && !hasWant && (
            <View className="gap-1">
              <View className="flex-row items-center gap-3">
                <Text className="min-w-0 flex-1 text-sm text-foreground">Watch the price</Text>
                <Switch checked={watch} onChange={setWatch} label="Watch the price" />
              </View>
              <Text className="text-xs text-muted-foreground">
                {hidden.length ? 'Adds it to Shopper, kept from the same people.' : 'Adds it to Shopper.'}
              </Text>
            </View>
          )}
        </FormSection>
      )}

      <FormSection>
        <FieldRow label="Notes">
          <Input value={notes} onChangeText={setNotes} placeholder="Size, colour, where to get it" maxLength={300} />
        </FieldRow>
      </FormSection>
    </ItemFormSheet>
  );
}
