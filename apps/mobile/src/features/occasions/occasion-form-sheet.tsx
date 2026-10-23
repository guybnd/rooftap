// Occasions: add or edit an occasion (Hearth E1-E4). What kind, who it is
// for (a member or a name), the day, whether it comes round every year, and
// a gift budget. "Keep it from" sits behind the details for a surprise party.
// The web form's date input is DateScrollField here, since this sheet is
// itself a BottomSheet and can't nest another.
// Web twin: apps/web/src/app/occasions/occasion-form-sheet.tsx.
import * as React from 'react';
import { View } from 'react-native';
import { Gift } from 'lucide-react-native';
import { DateScrollField, DetailsDisclosure, FieldRow, FormSection, Input, ItemFormSheet, SegmentedControl, Switch, Text } from '@homeup/ui';
import {
  OCCASION_KINDS,
  memberFirstName,
  useOccasionForm,
  todayISO,
  type GroupMember,
  type Occasion,
  type OccasionsApi,
} from '@homeup/core';
import { Chip } from './chip';

const OCCASIONS_SECTION = { id: 'occasions', Icon: Gift };

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export function OccasionFormSheet({
  open,
  onOpenChange,
  occasion,
  api,
  groupId,
  currentUserId,
  members,
  profiles,
  onSaved,
  calendar = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  occasion?: Occasion;
  api: OccasionsApi;
  groupId: string;
  currentUserId: string | null;
  members: GroupMember[];
  profiles: MemberProfiles;
  onSaved?: (occasion: Occasion) => void;
  /** Offer the Calendar switch: calendar.occasions is on and the server has the column. */
  calendar?: boolean;
}) {
  const form = useOccasionForm({ occasion, api, groupId, currentUserId, profiles, calendar, initialDate: todayISO() });
  const { kind, setKind, who, setWho, personName, setPersonName, shownTitle, typeTitle, date, setDate, repeats, setRepeats, onCalendar, setOnCalendar, budget, setBudget, hidden, keepFrom, tried } = form;
  const others = members.filter((m) => m.user_id !== currentUserId);

  const submit = () => {
    const saved = form.submit();
    if (!saved) return;
    onSaved?.(saved);
    onOpenChange(false);
  };

  return (
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      section={OCCASIONS_SECTION}
      title={occasion ? 'Edit occasion' : 'New occasion'}
      onSubmit={submit}
      submitLabel={occasion ? 'Save' : 'Add occasion'}
      onDelete={
        occasion
          ? () => {
              api.deleteOccasion(occasion.id);
              onOpenChange(false);
            }
          : undefined
      }
      deleteLabel="Remove occasion"
      deleteConfirmMessage="The gift ideas you can see under it go too."
    >
      <FormSection>
        <FieldRow label="Kind">
          <SegmentedControl options={[...OCCASION_KINDS]} value={kind} onChange={setKind} accessibilityLabel="Kind" />
        </FieldRow>
        <FieldRow label="Who it's for">
          <View className="flex-row flex-wrap gap-1.5">
            {members.map((m) => (
              <Chip
                key={m.user_id}
                label={m.user_id === currentUserId ? 'Me' : memberFirstName(m.user_id, profiles)}
                selected={who.kind === 'member' && who.id === m.user_id}
                onPress={() => setWho({ kind: 'member', id: m.user_id })}
              />
            ))}
            <Chip label="Someone else" selected={who.kind === 'name'} onPress={() => setWho({ kind: 'name' })} />
            <Chip label="Everyone" selected={who.kind === 'nobody'} onPress={() => setWho({ kind: 'nobody' })} />
          </View>
          {who.kind === 'name' && (
            <Input className="mt-2" value={personName} onChangeText={setPersonName} placeholder="Name, like Mum" maxLength={60} accessibilityLabel="Name" />
          )}
        </FieldRow>
        <FieldRow label="Name" required error={tried && !shownTitle.trim() ? 'Name the occasion' : null}>
          <Input
            value={shownTitle}
            onChangeText={typeTitle}
            placeholder="Christmas"
            maxLength={80}
          />
        </FieldRow>
        <FieldRow label="Day" required>
          <DateScrollField value={date} onChange={setDate} minYear={1920} maxYear={new Date().getFullYear() + 5} />
        </FieldRow>
        <View className="flex-row items-center gap-3">
          <Text className="min-w-0 flex-1 text-sm text-foreground">Every year</Text>
          <Switch checked={repeats} onChange={setRepeats} label="Every year" />
        </View>
        {calendar && (
          <View className="flex-row items-center gap-3">
            <Text className="min-w-0 flex-1 text-sm text-foreground">Show on Calendar</Text>
            <Switch checked={onCalendar} onChange={setOnCalendar} label="Show on Calendar" />
          </View>
        )}
        <FieldRow label="Gift budget">
          <Input keyboardType="decimal-pad" value={budget} onChangeText={setBudget} placeholder="Optional" className="tabular-nums" />
        </FieldRow>
      </FormSection>

      {others.length > 0 && (
        <DetailsDisclosure count={1}>
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
            <Text className="text-xs text-muted-foreground">For a surprise party. Gift ideas have their own switch.</Text>
          </FormSection>
        </DetailsDisclosure>
      )}
    </ItemFormSheet>
  );
}
