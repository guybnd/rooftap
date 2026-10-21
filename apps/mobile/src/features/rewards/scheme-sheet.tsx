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
  REWARD_CATALOG,
  REWARD_PERK_KINDS,
  brandKey,
  buildRewardPerk,
  comparePerks,
  currencySymbol,
  newPartnerNames,
  parsePartnerList,
  perkEndsCaption,
  perkValueLabel,
  todayISO,
  useHouseholdCurrency,
  type RewardPerkKind,
  type RewardScheme,
  type RewardsApi,
} from '@homeup/core';
import { randomUUID } from '@/lib/uuid';
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
  const [name, setName] = React.useState(scheme.name);
  const [website, setWebsite] = React.useState(scheme.website ?? '');
  const [storeInput, setStoreInput] = React.useState('');
  const [pasting, setPasting] = React.useState(false);
  const [pasted, setPasted] = React.useState('');

  const stores = React.useMemo(
    () => rewards.partners.filter((p) => p.scheme_id === scheme.id).sort((a, b) => a.name.localeCompare(b.name)),
    [rewards.partners, scheme.id],
  );
  const perks = React.useMemo(
    () => rewards.perks.filter((p) => p.scheme_id === scheme.id).sort(comparePerks),
    [rewards.perks, scheme.id],
  );
  const storeName = new Map(stores.map((p) => [p.id, p.name]));

  // Suggestions: store names the household or the starter list already
  // knows, minus this scheme's own.
  const known = React.useMemo(() => {
    const names = new Map<string, string>();
    for (const p of rewards.partners) names.set(p.brand_key, p.name);
    for (const e of REWARD_CATALOG) for (const p of e.partners) if (!names.has(brandKey(p.name))) names.set(brandKey(p.name), p.name);
    return [...names.values()];
  }, [rewards.partners]);
  const storeSuggestions = React.useMemo(() => {
    const key = brandKey(storeInput);
    if (!key) return [];
    return newPartnerNames(
      known.filter((n) => brandKey(n).startsWith(key)),
      stores,
    ).slice(0, 5);
  }, [storeInput, known, stores]);
  const pastedNames = React.useMemo(() => newPartnerNames(parsePartnerList(pasted), stores), [pasted, stores]);

  const addStores = (names: string[]) => {
    rewards.addPartners(scheme.id, names);
    setStoreInput('');
  };

  return (
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      section={REWARDS_SECTION}
      title={scheme.name}
      onSubmit={() => {
        rewards.saveScheme({ ...scheme, name: name.trim() || scheme.name, website: website.trim() || null });
        onOpenChange(false);
      }}
      submitLabel="Done"
      onDelete={() => {
        rewards.deleteScheme(scheme.id);
        onOpenChange(false);
      }}
      deleteLabel="Delete scheme"
      deleteConfirmTitle={`Delete ${scheme.name}?`}
      deleteConfirmMessage="Its stores and perks go for everyone. Cards stay, as plain cards."
    >
      <FormSection>
        <FieldRow label="Name">
          <Input value={name} onChangeText={setName} maxLength={80} />
        </FieldRow>
        <FieldRow label="Website">
          <Input
            value={website}
            onChangeText={setWebsite}
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
                onChangeText={setStoreInput}
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
            <Input value={pasted} onChangeText={setPasted} multiline numberOfLines={5} className="min-h-[110px]" textAlignVertical="top" />
            <Button
              variant="secondary"
              className="mt-1 h-10"
              disabled={pastedNames.length === 0}
              onPress={() => {
                addStores(pastedNames);
                setPasted('');
                setPasting(false);
              }}
            >
              {pastedNames.length === 0 ? 'Nothing new to add' : `Add ${pastedNames.length} ${pastedNames.length === 1 ? 'store' : 'stores'}`}
            </Button>
          </FieldRow>
        ) : (
          <Pressable onPress={() => setPasting(true)} accessibilityRole="button" className="min-h-11 justify-center">
            <Text className="text-sm font-medium text-primary">Paste a list of stores</Text>
          </Pressable>
        )}
      </FormSection>

      <FormSection title="Perks">
        {perks.length > 0 && (
          <View className="overflow-hidden rounded-xl bg-muted/50">
            {perks.map((perk, i) => {
              const where = perk.partner_id ? storeName.get(perk.partner_id) : 'Every store';
              const meta = [where, perk.conditions, perkEndsCaption(perk.valid_until, today)].filter(Boolean).join(' · ');
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
        <PerkForm
          stores={stores.map((p) => ({ id: p.id, name: p.name }))}
          onAdd={(input) => rewards.savePerk(buildRewardPerk({ id: randomUUID(), groupId, schemeId: scheme.id, ...input }))}
        />
      </FormSection>
    </ItemFormSheet>
  );
}

function PerkForm({
  stores,
  onAdd,
}: {
  stores: { id: string; name: string }[];
  onAdd: (perk: {
    partnerId: string | null;
    title: string;
    kind: RewardPerkKind;
    value: number | null;
    conditions: string | null;
    validUntil: string | null;
  }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [kind, setKind] = React.useState<RewardPerkKind>('percent');
  const [value, setValue] = React.useState('');
  const [partnerId, setPartnerId] = React.useState<string | null>(null);
  const [conditions, setConditions] = React.useState('');
  const [ends, setEnds] = React.useState('');

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" className="min-h-11 flex-row items-center gap-1.5">
        <Plus size={16} className="text-primary" />
        <Text className="text-sm font-medium text-primary">Add a perk</Text>
      </Pressable>
    );
  }

  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  const numeric = value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  const storeLabel = stores.find((s) => s.id === partnerId)?.name;
  const fallbackTitle =
    kind === 'percent' && numeric ? `${numeric}% off` : kind === 'amount' && numeric ? 'Money off' : kind === 'points' ? 'Points' : '';
  const finalTitle = title.trim() || (storeLabel ? `${fallbackTitle} at ${storeLabel}`.trim() : fallbackTitle);

  return (
    <View className="gap-3 rounded-xl bg-muted/50 p-3">
      <FieldRow label="What you get">
        <SegmentedControl options={REWARD_PERK_KINDS} value={kind} onChange={setKind} accessibilityLabel="Kind of perk" />
      </FieldRow>
      {kind !== 'other' && (
        <FieldRow label={kind === 'percent' ? 'Percent' : kind === 'amount' ? 'Amount' : 'Times points'}>
          <Input keyboardType="decimal-pad" value={value} onChangeText={setValue} placeholder={kind === 'percent' ? '10' : kind === 'amount' ? '5' : '2'} />
        </FieldRow>
      )}
      <FieldRow label="Where">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerClassName="gap-1.5">
          <Chip label="Every store" selected={partnerId === null} onPress={() => setPartnerId(null)} />
          {stores.map((s) => (
            <Chip key={s.id} label={s.name} selected={partnerId === s.id} onPress={() => setPartnerId(s.id)} />
          ))}
        </ScrollView>
      </FieldRow>
      <FieldRow label="Title">
        <Input value={title} onChangeText={setTitle} placeholder={finalTitle || 'Movie tickets'} maxLength={80} />
      </FieldRow>
      <FieldRow label="Conditions">
        <Input value={conditions} onChangeText={setConditions} placeholder="Show card, not on sale items" maxLength={120} />
      </FieldRow>
      <FieldRow label="Ends" action={ends !== '' && <Button size="xs" variant="ghost" onPress={() => setEnds('')}>Clear</Button>}>
        <DateScrollField value={ends} onChange={setEnds} emptyLabel="No end date" />
      </FieldRow>
      <View className="flex-row gap-2">
        <Button variant="ghost" className="h-10" onPress={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          className="h-10 flex-1"
          disabled={!finalTitle}
          onPress={() => {
            onAdd({
              partnerId,
              title: finalTitle,
              kind,
              value: kind === 'other' ? null : numeric,
              conditions: conditions.trim() || null,
              validUntil: ends || null,
            });
            setTitle('');
            setValue('');
            setConditions('');
            setEnds('');
            setOpen(false);
          }}
        >
          Add perk
        </Button>
      </View>
    </View>
  );
}
