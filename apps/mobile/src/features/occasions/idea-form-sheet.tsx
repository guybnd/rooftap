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
  formatMoney,
  memberFirstName,
  occasionTitle,
  useIdeaForm,
  type GiftIdea,
  type GroupMember,
  type Occasion,
  type OccasionsApi,
} from '@homeup/core';
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
  const others = members.filter((m) => m.user_id !== currentUserId);
  const form = useIdeaForm({ idea, occasion, api, groupId, currentUserId, memberIds: members.map((m) => m.user_id), profiles, features });
  const {
    title,
    setTitle,
    occasionId,
    pickOccasion,
    forUserId,
    pickFor,
    forName,
    setForName,
    status,
    setStatus,
    price,
    setPrice,
    priceCents,
    url,
    setUrl,
    notes,
    setNotes,
    hidden,
    keepFrom,
    hints,
    hasWant,
    inBudget,
    setInBudget,
    watch,
    setWatch,
    tried,
  } = form;

  const submit = () => {
    if (form.submit()) onOpenChange(false);
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
                  onChange={(next) => keepFrom(m.user_id, next)}
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
