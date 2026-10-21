// Rewards cards: the household's loyalty cards (Flybuys, Everyday Rewards...)
// in one bottom sheet off the Groceries header (M4). Three views: the card list,
// one card shown as a scannable code with the screen held awake, and the
// add/edit form. Opened with `initialCardId` it lands straight on that card,
// so a household with one card is one tap from the list to the till.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronLeft, Plus, WalletCards } from 'lucide-react-native';
import {
  BottomSheet,
  BottomSheetScrollView,
  Button,
  CardCode,
  Input,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  SegmentedControl,
  Text,
  haptics,
} from '@homeup/ui';
import {
  LOYALTY_CARD_FORMATS,
  formatLoyaltyNumber,
  loyaltyFormatLabel,
  loyaltyNumberError,
  loyaltyNumberTail,
  normalizeLoyaltyNumber,
  type LoyaltyCard,
  type LoyaltyCardFormat,
  dialog,
} from '@homeup/core';
import { randomUUID } from '@/lib/uuid';
import { useKeepAwakeWhile } from '@/lib/keep-awake';

type SheetView = { kind: 'list' } | { kind: 'show'; id: string } | { kind: 'edit'; id: string | null };

interface RewardsCardsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: LoyaltyCard[];
  groupId: string;
  /** Land on this card when the sheet opens. */
  initialCardId?: string | null;
  onSave: (card: LoyaltyCard) => void;
  onDelete: (card: LoyaltyCard) => void;
}

export function RewardsCardsSheet({ open, onOpenChange, cards, groupId, initialCardId, onSave, onDelete }: RewardsCardsSheetProps) {
  const [view, setView] = React.useState<SheetView>({ kind: 'list' });

  // Each opening starts where the caller points: a card, the add form when
  // there are none yet, otherwise the list.
  React.useEffect(() => {
    if (!open) return;
    if (initialCardId) setView({ kind: 'show', id: initialCardId });
    else setView(cards.length === 0 ? { kind: 'edit', id: null } : { kind: 'list' });
    // Only on open: later card edits must not yank the view around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = view.kind === 'show' ? cards.find((c) => c.id === view.id) : undefined;
  const editing = view.kind === 'edit' && view.id ? cards.find((c) => c.id === view.id) : undefined;
  useKeepAwakeWhile(open && !!shown, 'rewards-card');

  const back = () => setView(cards.length === 0 ? { kind: 'edit', id: null } : { kind: 'list' });

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="max-h-[88%]">
      {/* Scrolls so the form's Save button stays reachable on short screens
          and above the keyboard. */}
      <BottomSheetScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="px-4 pb-6">
      {view.kind === 'list' && (
        <View className="gap-3 pt-1">
          <Text className="text-micro-label uppercase text-muted-foreground">Rewards cards</Text>
          <ListGroup bordered={false}>
            {cards.map((card) => (
              <ListItem key={card.id} onPress={() => setView({ kind: 'show', id: card.id })}>
                <ListItemLeading>
                  <View className="size-9 items-center justify-center rounded-xl bg-muted">
                    <WalletCards size={18} className="text-muted-foreground" />
                  </View>
                </ListItemLeading>
                <ListItemContent>
                  <ListItemTitle>{card.name}</ListItemTitle>
                  <ListItemMeta>
                    <Text className="text-caption text-muted-foreground">{loyaltyFormatLabel(card.format)}</Text>
                    <Text className="font-mono text-caption text-muted-foreground">{loyaltyNumberTail(card.number)}</Text>
                  </ListItemMeta>
                </ListItemContent>
              </ListItem>
            ))}
            <ListItem onPress={() => setView({ kind: 'edit', id: null })}>
              <ListItemLeading>
                <View className="size-9 items-center justify-center rounded-xl">
                  <Plus size={18} className="text-primary" />
                </View>
              </ListItemLeading>
              <ListItemContent className="self-center">
                <ListItemTitle className="text-primary">Add card</ListItemTitle>
              </ListItemContent>
            </ListItem>
          </ListGroup>
        </View>
      )}

      {view.kind === 'show' && shown && (
        <View className="gap-4 pt-1">
          <SheetBackRow label={cards.length > 1 ? 'All cards' : 'Rewards cards'} onPress={back} />
          <View className="gap-0.5">
            <Text className="font-heading text-title text-foreground">{shown.name}</Text>
            <Text className="text-caption text-muted-foreground">Turn your brightness up if it won&apos;t scan</Text>
          </View>
          <CardCode number={shown.number} format={shown.format} />
          <Text selectable className="text-center font-mono text-lg tabular-nums text-foreground">
            {formatLoyaltyNumber(shown.number)}
          </Text>
          <View className="flex-row justify-between pt-2">
            <Button variant="ghost" onPress={() => setView({ kind: 'edit', id: shown.id })}>Edit</Button>
            <Button
              variant="ghost"
              textClassName="text-destructive"
              onPress={() => {
                dialog.alert(`Remove ${shown.name}?`, 'It goes for everyone in your household.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => {
                      onDelete(shown);
                      setView(cards.length > 1 ? { kind: 'list' } : { kind: 'edit', id: null });
                    },
                  },
                ]);
              }}
            >
              Remove
            </Button>
          </View>
        </View>
      )}

      {view.kind === 'edit' && (
        <CardForm
          key={view.id ?? 'new'}
          card={editing}
          showBack={cards.length > 0}
          onBack={() => (editing ? setView({ kind: 'show', id: editing.id }) : back())}
          onSubmit={(fields) => {
            const card: LoyaltyCard = editing
              ? { ...editing, ...fields }
              : {
                  id: randomUUID(),
                  group_id: groupId,
                  created_by: null,
                  ...fields,
                  deleted: false,
                  created_at: '',
                  updated_at: '',
                };
            onSave(card);
            haptics.success();
            setView({ kind: 'show', id: card.id });
          }}
        />
      )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

function SheetBackRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="-ml-1 min-h-11 flex-row items-center gap-1 self-start pr-3">
      <ChevronLeft size={18} className="text-muted-foreground" />
      <Text className="text-sm text-muted-foreground">{label}</Text>
    </Pressable>
  );
}

function CardForm({
  card,
  showBack,
  onBack,
  onSubmit,
}: {
  card?: LoyaltyCard;
  showBack: boolean;
  onBack: () => void;
  onSubmit: (fields: { name: string; number: string; format: LoyaltyCardFormat }) => void;
}) {
  const [name, setName] = React.useState(card?.name ?? '');
  const [number, setNumber] = React.useState(card ? formatLoyaltyNumber(card.number) : '');
  const [format, setFormat] = React.useState<LoyaltyCardFormat>(card?.format ?? 'code128');
  const [tried, setTried] = React.useState(false);

  const normalized = normalizeLoyaltyNumber(number, format);
  const numberError = loyaltyNumberError(normalized, format);
  const nameError = name.trim() ? null : 'Give the card a name';

  const submit = () => {
    setTried(true);
    if (nameError || numberError) return;
    onSubmit({ name: name.trim(), number: normalized, format });
  };

  return (
    <View className="gap-4 pt-1">
      {showBack ? (
        <SheetBackRow label={card ? card.name : 'Rewards cards'} onPress={onBack} />
      ) : (
        <Text className="text-micro-label uppercase text-muted-foreground">Rewards cards</Text>
      )}
      <View className="gap-0.5">
        <Text className="font-heading text-title text-foreground">{card ? 'Edit card' : 'Add a card'}</Text>
        {!card && (
          <Text className="text-caption text-muted-foreground">
            Type the number under the barcode. Everyone in your household can show it.
          </Text>
        )}
      </View>
      <View className="gap-1.5">
        <Text className="text-micro-label uppercase text-muted-foreground">Name</Text>
        <Input value={name} onChangeText={setName} placeholder="Flybuys" className="h-11" autoCapitalize="words" />
        {tried && nameError && <Text className="text-caption text-destructive">{nameError}</Text>}
      </View>
      <View className="gap-1.5">
        <Text className="text-micro-label uppercase text-muted-foreground">Card number</Text>
        <Input
          value={number}
          onChangeText={setNumber}
          placeholder="6008 1234 5678 9012"
          className="h-11 font-mono"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={format === 'qr' ? 'default' : 'visible-password'}
          onSubmitEditing={submit}
        />
        {tried && numberError && <Text className="text-caption text-destructive">{numberError}</Text>}
      </View>
      <View className="gap-1.5">
        <Text className="text-micro-label uppercase text-muted-foreground">Code</Text>
        <SegmentedControl
          options={LOYALTY_CARD_FORMATS}
          value={format}
          onChange={setFormat}
          accessibilityLabel="Code type"
        />
        <Text className="text-caption text-muted-foreground">
          Barcode suits most cards, Flybuys and Everyday Rewards included. Pick QR if the card shows a square code, or EAN-13 only if the card says so.
        </Text>
      </View>
      <Button className="h-11" onPress={submit}>
        {card ? 'Save' : 'Add card'}
      </Button>
    </View>
  );
}
