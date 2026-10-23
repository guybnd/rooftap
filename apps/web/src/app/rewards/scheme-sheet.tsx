'use client';

// Rewards: where a scheme works and what it gets you. One scheme often
// covers many stores, so stores go in as chips (type and press Enter, with
// suggestions from other schemes and the starter list) or as a pasted list,
// and every change applies straight away (M4). Perks are added underneath,
// for every store or one. Native twin: apps/mobile/src/features/rewards/scheme-sheet.tsx.
import { Plus, WalletCards, X } from 'lucide-react';
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
import { ItemFormSheet, FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';

const REWARDS_SECTION = { id: 'rewards', Icon: WalletCards };

const TEXTAREA =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30';

export function SchemeSheet({
  isOpen,
  onClose,
  scheme,
  rewards,
  groupId,
}: {
  isOpen: boolean;
  onClose: () => void;
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
      section={REWARDS_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={scheme.name}
      onSubmit={() => {
        form.save();
        onClose();
      }}
      submitLabel="Done"
      onDelete={() => {
        form.remove();
        onClose();
      }}
      deleteLabel="Delete scheme"
      deleteConfirmTitle={`Delete ${scheme.name}?`}
      deleteConfirmMessage="Its stores and perks go for everyone. Cards stay, as plain cards."
    >
      <FormSection>
        <FieldRow label="Name" htmlFor="scheme-name">
          <Input id="scheme-name" value={name} onChange={(e) => form.setName(e.target.value)} maxLength={80} />
        </FieldRow>
        <FieldRow label="Website" htmlFor="scheme-website">
          <Input
            id="scheme-website"
            type="url"
            inputMode="url"
            value={website}
            onChange={(e) => form.setWebsite(e.target.value)}
            placeholder="https://"
            autoComplete="off"
          />
        </FieldRow>
      </FormSection>

      <FormSection title={stores.length ? `Stores · ${stores.length}` : 'Stores'}>
        {stores.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {stores.map((p) => (
              <span key={p.id} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-muted pl-3 pr-1 text-[12.5px] font-medium text-foreground">
                {p.name}
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => rewards.removePartner(p.id)}
                  className="grid size-7 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <FieldRow label="Add a store" htmlFor="scheme-store">
          <div className="flex gap-2">
            <Input
              id="scheme-store"
              value={storeInput}
              onChange={(e) => form.setStoreInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  if (storeInput.trim()) addStores([storeInput]);
                }
              }}
              placeholder="Officeworks"
              autoComplete="off"
              maxLength={60}
            />
            <Button type="button" variant="secondary" className="h-9" disabled={!storeInput.trim()} onClick={() => addStores([storeInput])}>
              Add
            </Button>
          </div>
          {storeSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2">
              {storeSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addStores([s])}
                  className="min-h-9 rounded-full bg-muted px-3 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </FieldRow>
        {pasting ? (
          <FieldRow label="Paste a list" htmlFor="scheme-paste" hint="One store per line, or copied straight from the scheme's partner page.">
            <textarea id="scheme-paste" rows={5} value={pasted} onChange={(e) => form.setPasted(e.target.value)} className={TEXTAREA} />
            <Button
              type="button"
              variant="secondary"
              className="mt-2 h-10 w-full"
              disabled={pastedNames.length === 0}
              onClick={() => {
                form.addPasted();
              }}
            >
              {pastedNames.length === 0 ? 'Nothing new to add' : `Add ${pastedNames.length} ${pastedNames.length === 1 ? 'store' : 'stores'}`}
            </Button>
          </FieldRow>
        ) : (
          <button type="button" onClick={() => form.setPasting(true)} className="min-h-11 text-left text-sm font-medium text-primary">
            Paste a list of stores
          </button>
        )}
      </FormSection>

      <FormSection title="Perks">
        {perks.length > 0 && (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/50">
            {perks.map((perk) => {
              const meta = schemePerkMeta(perk, storeName, perkEndsCaption(perk.valid_until, today));
              return (
                <li key={perk.id} className="flex min-h-[55px] items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-[570] text-foreground">{perk.title}</p>
                    {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-foreground">{perkValueLabel(perk, currencySymbol(currency))}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${perk.title}`}
                    onClick={() => rewards.removePerk(perk.id)}
                    className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
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
      <button type="button" onClick={() => perk.setOpen(true)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary">
        <Plus className="size-4" />
        Add a perk
      </button>
    );
  }

  const valueField = perkValueField(kind);

  return (
    <div className="space-y-3 rounded-xl bg-muted/50 p-3">
      <FieldRow label="What you get">
        <SegmentedControl options={REWARD_PERK_KINDS} value={kind} onChange={perk.setKind} ariaLabel="Kind of perk" />
      </FieldRow>
      <div className="grid grid-cols-2 gap-3">
        {kind !== 'other' && (
          <FieldRow label={valueField.label} htmlFor="perk-value">
            <Input id="perk-value" inputMode="decimal" value={value} onChange={(e) => perk.setValue(e.target.value)} placeholder={valueField.placeholder} />
          </FieldRow>
        )}
        <FieldRow label="Where" htmlFor="perk-store" className={kind === 'other' ? 'col-span-2' : undefined}>
          <select
            id="perk-store"
            value={partnerId ?? ''}
            onChange={(e) => perk.setPartnerId(e.target.value || null)}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-base md:text-sm dark:bg-input/30"
          >
            <option value="">Every store</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FieldRow>
      </div>
      <FieldRow label="Title" htmlFor="perk-title">
        <Input id="perk-title" value={title} onChange={(e) => perk.setTitle(e.target.value)} placeholder={finalTitle || 'Movie tickets'} maxLength={80} />
      </FieldRow>
      <FieldRow label="Conditions" htmlFor="perk-conditions">
        <Input id="perk-conditions" value={conditions} onChange={(e) => perk.setConditions(e.target.value)} placeholder="Show card, not on sale items" maxLength={120} />
      </FieldRow>
      <FieldRow label="Ends" htmlFor="perk-ends">
        <Input id="perk-ends" type="date" value={ends} onChange={(e) => perk.setEnds(e.target.value)} />
      </FieldRow>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="h-10" onClick={() => perk.setOpen(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-10 flex-1"
          disabled={!finalTitle}
          onClick={perk.add}
        >
          Add perk
        </Button>
      </div>
    </div>
  );
}
