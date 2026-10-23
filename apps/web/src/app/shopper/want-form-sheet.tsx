'use client';

// HOUP-434: add or edit a Shopper item (Hearth E1-E4, the pull-up editor).
// What it is, the words to search for, a target price that raises the
// alert, the budget, and when it's needed by. Prices are found by the server
// after save. Native twin: apps/mobile/src/features/shopper/want-form-sheet.tsx.
import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import {
  SHOPPER_WANT_STATUSES,
  buildShopperWant,
  currencySymbol,
  keptFromLabel,
  parsePriceInput,
  type ShopperWant,
  type ShopperWantStatus,
} from '@homeup/core';
import { ItemFormSheet, FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useDataCache } from '@/lib/data-cache';
import { KeepFromField } from './keep-from-field';

const SHOPPER_SECTION = { id: 'shopper', Icon: ShoppingBag };

const STATUS_LABEL: Record<ShopperWantStatus, string> = {
  watching: 'Watching',
  idea: 'Idea',
  bought: 'Bought',
};

function centsText(cents: number | null): string {
  return cents == null ? '' : String(cents / 100);
}

export function WantFormSheet({
  isOpen,
  want,
  groupId,
  currency,
  onClose,
  onSave,
  onDelete,
}: {
  isOpen: boolean;
  /** Edit this one; omit to add. */
  want?: ShopperWant;
  groupId: string;
  currency: string;
  onClose: () => void;
  onSave: (want: ShopperWant, isNew: boolean) => void;
  onDelete?: (want: ShopperWant) => void;
}) {
  const [title, setTitle] = useState(want?.title ?? '');
  const [query, setQuery] = useState(want?.query ?? '');
  const [target, setTarget] = useState(centsText(want?.target_cents ?? null));
  const [budget, setBudget] = useState(centsText(want?.budget_cents ?? null));
  const [needBy, setNeedBy] = useState(want?.need_by ?? '');
  const [notes, setNotes] = useState(want?.notes ?? '');
  const [status, setStatus] = useState<ShopperWantStatus>(want?.status ?? 'watching');
  const [hiddenFrom, setHiddenFrom] = useState<string[]>([]);
  const { memberProfiles } = useDataCache();
  // Who an existing watch is kept from is set when it's made: hiding it later
  // would leave a copy on their device.
  const kept = want ? keptFromLabel(want.hidden_from, memberProfiles) : null;
  const symbol = currencySymbol(currency);

  const submit = () => {
    const fields = {
      title: title.trim(),
      query: query.trim() || null,
      target_cents: parsePriceInput(target),
      budget_cents: parsePriceInput(budget),
      need_by: needBy || null,
      notes: notes.trim() || null,
    };
    if (want) {
      const bought = status === 'bought' && want.status !== 'bought';
      onSave(
        {
          ...want,
          ...fields,
          status,
          bought_at: status === 'bought' ? (bought ? new Date().toISOString() : want.bought_at) : null,
        },
        false,
      );
    } else {
      onSave(
        buildShopperWant({
          id: crypto.randomUUID(),
          groupId,
          title: fields.title,
          query: fields.query,
          targetCents: fields.target_cents,
          budgetCents: fields.budget_cents,
          needBy: fields.need_by,
          notes: fields.notes,
          status: status === 'bought' ? 'watching' : status,
          hiddenFrom,
          createdBy: null,
        }),
        true,
      );
    }
    onClose();
  };

  return (
    <ItemFormSheet
      section={SHOPPER_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={want ? 'Edit item' : 'Add something to buy'}
      onSubmit={submit}
      submitLabel={want ? 'Save' : 'Add'}
      canSubmit={!!title.trim()}
      onDelete={want && onDelete ? () => onDelete(want) : undefined}
      deleteLabel="Delete item"
    >
      <FormSection>
        <FieldRow label="What is it" htmlFor="want-title" required>
          <Input
            id="want-title"
            autoFocus={!want}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sony Bravia 7, 65 inch"
            maxLength={120}
          />
        </FieldRow>
        <FieldRow label="Search for" htmlFor="want-query" hint="The model or words stores use. Leave blank to search the name.">
          <Input id="want-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="K-65XR70" maxLength={160} />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Tell me under" htmlFor="want-target">
            <Input
              id="want-target"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={`${symbol}1,700`}
            />
          </FieldRow>
          <FieldRow label="Budget" htmlFor="want-budget">
            <Input
              id="want-budget"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder={`${symbol}2,000`}
            />
          </FieldRow>
        </div>
        <FieldRow label="Need it by" htmlFor="want-need-by">
          <Input id="want-need-by" type="date" value={needBy} onChange={(e) => setNeedBy(e.target.value)} />
        </FieldRow>
        <FieldRow label="Status">
          <SegmentedControl
            ariaLabel="Status"
            value={status}
            onChange={setStatus}
            options={(want ? SHOPPER_WANT_STATUSES : SHOPPER_WANT_STATUSES.filter((s) => s !== 'bought')).map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            }))}
          />
        </FieldRow>
        <FieldRow label="Notes" htmlFor="want-notes">
          <textarea
            id="want-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          />
        </FieldRow>
        {kept && <p className="text-xs text-muted-foreground">{kept}</p>}
      </FormSection>
      {!want && <KeepFromField value={hiddenFrom} onChange={setHiddenFrom} />}
    </ItemFormSheet>
  );
}
