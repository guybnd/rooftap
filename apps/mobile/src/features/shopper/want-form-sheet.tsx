// HOUP-434: add or edit a Shopper item (Hearth E1-E4, the pull-up editor).
// What it is, the words to search for, a target price that raises the
// alert, the budget, and when it's needed by. Prices are found by the server
// after save. The web form's `<input type="date">` is DateScrollField here,
// since this sheet is itself a BottomSheet and can't nest another.
// Web twin: apps/web/src/app/shopper/want-form-sheet.tsx.
import * as React from 'react';
import { View } from 'react-native';
import { ShoppingBag } from 'lucide-react-native';
import {
  Button,
  ItemFormSheet,
  FormSection,
  FieldRow,
  Input,
  SegmentedControl,
  DateScrollField,
  Text,
} from '@homeup/ui';
import {
  SHOPPER_WANT_STATUSES,
  buildShopperWant,
  keptFromLabel,
  currencySymbol,
  parsePriceInput,
  type ShopperWant,
  type ShopperWantStatus,
} from '@homeup/core';
import { randomUUID } from '@/lib/uuid';
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
  open,
  onOpenChange,
  want,
  groupId,
  currency,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this one; omit to add. */
  want?: ShopperWant;
  groupId: string;
  currency: string;
  onSave: (want: ShopperWant, isNew: boolean) => void;
  onDelete?: (want: ShopperWant) => void;
}) {
  const [title, setTitle] = React.useState(want?.title ?? '');
  const [query, setQuery] = React.useState(want?.query ?? '');
  const [target, setTarget] = React.useState(centsText(want?.target_cents ?? null));
  const [budget, setBudget] = React.useState(centsText(want?.budget_cents ?? null));
  const [needBy, setNeedBy] = React.useState(want?.need_by ?? '');
  const [notes, setNotes] = React.useState(want?.notes ?? '');
  const [status, setStatus] = React.useState<ShopperWantStatus>(want?.status ?? 'watching');
  const [hiddenFrom, setHiddenFrom] = React.useState<string[]>([]);
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
          id: randomUUID(),
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
    onOpenChange(false);
  };

  return (
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      section={SHOPPER_SECTION}
      title={want ? 'Edit item' : 'Add something to buy'}
      onSubmit={submit}
      submitLabel={want ? 'Save' : 'Add'}
      canSubmit={!!title.trim()}
      onDelete={want && onDelete ? () => onDelete(want) : undefined}
      deleteLabel="Delete item"
      deleteConfirmTitle={want ? `Delete "${want.title}"?` : undefined}
      deleteConfirmMessage="Its price history goes with it."
    >
      <FormSection>
        <FieldRow label="What is it" required>
          <Input autoFocus={!want} value={title} onChangeText={setTitle} placeholder="Sony Bravia 7, 65 inch" maxLength={120} />
        </FieldRow>
        <FieldRow label="Search for" hint="The model or words stores use. Leave blank to search the name.">
          <Input value={query} onChangeText={setQuery} placeholder="K-65XR70" maxLength={160} />
        </FieldRow>
        <View className="flex-row gap-2">
          <FieldRow label="Tell me under" className="flex-1">
            <Input keyboardType="decimal-pad" value={target} onChangeText={setTarget} placeholder={`${symbol}1,700`} />
          </FieldRow>
          <FieldRow label="Budget" className="flex-1">
            <Input keyboardType="decimal-pad" value={budget} onChangeText={setBudget} placeholder={`${symbol}2,000`} />
          </FieldRow>
        </View>
        <FieldRow
          label="Need it by"
          action={needBy !== '' && <Button size="xs" variant="ghost" onPress={() => setNeedBy('')}>Clear</Button>}
        >
          <DateScrollField value={needBy} onChange={setNeedBy} emptyLabel="Any time" />
        </FieldRow>
        <FieldRow label="Status">
          <SegmentedControl
            accessibilityLabel="Status"
            value={status}
            onChange={setStatus}
            options={(want ? SHOPPER_WANT_STATUSES : SHOPPER_WANT_STATUSES.filter((s) => s !== 'bought')).map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            }))}
          />
        </FieldRow>
        <FieldRow label="Notes">
          <Input value={notes} onChangeText={setNotes} placeholder="Optional" multiline numberOfLines={2} />
        </FieldRow>
        {!!kept && <Text className="text-xs text-muted-foreground">{kept}</Text>}
      </FormSection>
      {!want && <KeepFromField value={hiddenFrom} onChange={setHiddenFrom} />}
    </ItemFormSheet>
  );
}
