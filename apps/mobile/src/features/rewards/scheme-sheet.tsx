// Rewards: where a scheme works and what it gets you. One scheme often
// covers many stores, so stores go in as chips (type and add, with
// suggestions from other schemes and the starter list) or as a pasted list,
// and every change applies straight away (M4). Perks are added underneath,
// for every store or one. Web twin: apps/web/src/app/rewards/scheme-sheet.tsx.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Plus, WalletCards, X } from 'lucide-react-native';
import { Button, DateScrollField, FieldRow, FormSection, Input, ItemFormSheet, SegmentedControl, Text } from '@homeup/ui';
import {
  REWARD_PERK_KINDS,
  currencySymbol,
  perkEndsCaption,
  perkValueField,
  perkValueLabel,
  schemePerkMeta,
  usePerkForm,
  useSchemeForm,
  todayISO,
  useHouseholdCurrency,
  type PerkInput,
  type RewardScheme,
  type RewardsApi,
} from '@homeup/core';
import { Chip } from './chip';

const REWARDS_SECTION = { id: 'rewards', Icon: WalletCards };

export function SchemeSheet({
  open,
  onOpenChange,
  scheme,
  rewards,
  groupId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheme: RewardScheme;
  rewards: RewardsApi;
  groupId: string;
}) {
  const currency = useHouseholdCurrency();
  const today = todayISO();
  const form = useSchemeForm({ scheme, rewards, groupId });
  const { name, website, storeInput, pasting, pasted, stores, perks, storeName, storeSuggestions, pastedNames, addStores } = form;

  return (
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      section={REWARDS_SECTION}
      title={scheme.name}
      onSubmit={() => {
        form.save();
        onOpenChange(false);
      }}
      submitLabel="Done"
      onDelete={() => {
        form.remove();
        onOpenChange(false);
      }}
      deleteLabel="Delete scheme"
      deleteConfirmTitle={`Delete ${scheme.name}?`}
      deleteConfirmMessage="Its stores and perks go for everyone. Cards stay, as plain cards."
    >
      <FormSection>
        <FieldRow label="Name">
          <Input value={name} onChangeText={form.setName} maxLength={80} />
        </FieldRow>
        <FieldRow label="Website">
          <Input
            value={website}
            onChangeText={form.setWebsite}
            placeholder="https://"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FieldRow>
      </FormSection>

      <FormSection title={stores.length ? `Stores · ${stores.length}` : 'Stores'}>
        {stores.length > 0 && (
          <View className="flex-row flex-wrap gap-1.5">
            {stores.map((p) => (
              <Chip key={p.id} label={p.name} onRemove={() => rewards.removePartner(p.id)} />
            ))}
          </View>
        )}
        <FieldRow label="Add a store">
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Input
                value={storeInput}
                onChangeText={form.setStoreInput}
                onSubmitEditing={() => storeInput.trim() && addStores([storeInput])}
                submitBehavior="submit"
                returnKeyType="done"
                placeholder="Officeworks"
                autoComplete="off"
                maxLength={60}
              />
            </View>
            <Button variant="secondary" size="sm" disabled={!storeInput.trim()} onPress={() => addStores([storeInput])}>
              Add
            </Button>
          </View>
          {storeSuggestions.length > 0 && (
            <View className="flex-row flex-wrap gap-1.5 pt-1">
              {storeSuggestions.map((s) => (
                <Chip key={s} label={s} onPress={() => addStores([s])} />
              ))}
            </View>
          )}
        </FieldRow>
        {pasting ? (
          <FieldRow label="Paste a list" hint="One store per line, or copied straight from the scheme's partner page.">
            <Input value={pasted} onChangeText={form.setPasted} multiline numberOfLines={5} className="min-h-[110px]" textAlignVertical="top" />
            <Button
              variant="secondary"
              className="mt-1 h-10"
              disabled={pastedNames.length === 0}
              onPress={() => {
                form.addPasted();
              }}
            >
              {pastedNames.length === 0 ? 'Nothing new to add' : `Add ${pastedNames.length} ${pastedNames.length === 1 ? 'store' : 'stores'}`}
            </Button>
          </FieldRow>
        ) : (
          <Pressable onPress={() => form.setPasting(true)} accessibilityRole="button" className="min-h-11 justify-center">
            <Text className="text-sm font-medium text-primary">Paste a list of stores</Text>
          </Pressable>
        )}
      </FormSection>

      <FormSection title="Perks">
        {perks.length > 0 && (
          <View className="overflow-hidden rounded-xl bg-muted/50">
            {perks.map((perk, i) => {
              const meta = schemePerkMeta(perk, storeName, perkEndsCaption(perk.valid_until, today));
              return (
                <View key={perk.id} className={`min-h-[55px] flex-row items-center gap-3 px-3 py-2 ${i > 0 ? 'border-t border-border/60' : ''}`}>
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                      {perk.title}
                    </Text>
                    {!!meta && (
                      <Text numberOfLines={1} className="text-caption text-muted-foreground">
                        {meta}
                      </Text>
                    )}
                  </View>
                  <Text className="shrink-0 text-sm tabular-nums text-foreground">{perkValueLabel(perk, currencySymbol(currency)) ?? ''}</Text>
                  <Pressable
                    onPress={() => rewards.removePerk(perk.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${perk.title}`}
                    hitSlop={6}
                    className="size-9 items-center justify-center rounded-full"
                  >
                    <X size={16} className="text-muted-foreground" />
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
        <PerkForm stores={form.storeOptions} onAdd={form.addPerk} />
      </FormSection>
    </ItemFormSheet>
  );
}

function PerkForm({
  stores,
  onAdd,
}: {
  stores: { id: string; name: string }[];
  onAdd: (perk: PerkInput) => void;
}) {
  const perk = usePerkForm(stores, onAdd);
  const { open, title, kind, value, partnerId, conditions, ends, finalTitle } = perk;

  if (!open) {
    return (
      <Pressable onPress={() => perk.setOpen(true)} accessibilityRole="button" className="min-h-11 flex-row items-center gap-1.5">
        <Plus size={16} className="text-primary" />
        <Text className="text-sm font-medium text-primary">Add a perk</Text>
      </Pressable>
    );
  }

  const valueField = perkValueField(kind);

  return (
    <View className="gap-3 rounded-xl bg-muted/50 p-3">
      <FieldRow label="What you get">
        <SegmentedControl options={REWARD_PERK_KINDS} value={kind} onChange={perk.setKind} accessibilityLabel="Kind of perk" />
      </FieldRow>
      {kind !== 'other' && (
        <FieldRow label={valueField.label}>
          <Input keyboardType="decimal-pad" value={value} onChangeText={perk.setValue} placeholder={valueField.placeholder} />
        </FieldRow>
      )}
      <FieldRow label="Where">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerClassName="gap-1.5">
          <Chip label="Every store" selected={partnerId === null} onPress={() => perk.setPartnerId(null)} />
          {stores.map((s) => (
            <Chip key={s.id} label={s.name} selected={partnerId === s.id} onPress={() => perk.setPartnerId(s.id)} />
          ))}
        </ScrollView>
      </FieldRow>
      <FieldRow label="Title">
        <Input value={title} onChangeText={perk.setTitle} placeholder={finalTitle || 'Movie tickets'} maxLength={80} />
      </FieldRow>
      <FieldRow label="Conditions">
        <Input value={conditions} onChangeText={perk.setConditions} placeholder="Show card, not on sale items" maxLength={120} />
      </FieldRow>
      <FieldRow label="Ends" action={ends !== '' && <Button size="xs" variant="ghost" onPress={() => perk.setEnds('')}>Clear</Button>}>
        <DateScrollField value={ends} onChange={perk.setEnds} emptyLabel="No end date" />
      </FieldRow>
      <View className="flex-row gap-2">
        <Button variant="ghost" className="h-10" onPress={() => perk.setOpen(false)}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          className="h-10 flex-1"
          disabled={!finalTitle}
          onPress={perk.add}
        >
          Add perk
        </Button>
      </View>
    </View>
  );
}
