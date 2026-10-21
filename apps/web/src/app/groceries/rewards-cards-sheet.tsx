'use client';

// Rewards cards: the household's loyalty cards (Flybuys, Everyday Rewards...)
// in one bottom sheet off the Groceries header (M4), mirroring mobile's
// rewards-cards-sheet.tsx. Three views: the card list, one card shown as a
// scannable code with the screen held awake, and the add/edit form. Opened
// with `initialCardId` it lands straight on that card, so a household with
// one card is one tap from the list to the till.

import { useEffect, useState } from 'react';
import { ChevronLeft, Plus, WalletCards } from 'lucide-react';
import {
  LOYALTY_CARD_FORMATS,
  formatLoyaltyNumber,
  loyaltyFormatLabel,
  loyaltyNumberError,
  loyaltyNumberTail,
  normalizeLoyaltyNumber,
  type LoyaltyCard,
  type LoyaltyCardFormat,
} from '@homeup/core';
import { dialog } from '@homeup/core';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
} from '@/components/ui/list-item';
import { CardCode } from '@/components/card-code';
import { success } from '@/lib/haptics';
import { useWakeLock } from '@/lib/wake-lock';

type SheetView = { kind: 'list' } | { kind: 'show'; id: string } | { kind: 'edit'; id: string | null };

export function RewardsCardsSheet({
  open,
  onOpenChange,
  cards,
  groupId,
  initialCardId,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: LoyaltyCard[];
  groupId: string;
  /** Land on this card when the sheet opens. */
  initialCardId?: string | null;
  onSave: (card: LoyaltyCard) => void;
  onDelete: (card: LoyaltyCard) => void;
}) {
  const [view, setView] = useState<SheetView>({ kind: 'list' });

  // Each opening starts where the caller points: a card, the add form when
  // there are none yet, otherwise the list.
  useEffect(() => {
    if (!open) return;
    if (initialCardId) setView({ kind: 'show', id: initialCardId });
    else setView(cards.length === 0 ? { kind: 'edit', id: null } : { kind: 'list' });
    // Only on open: later card edits must not yank the view around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = view.kind === 'show' ? cards.find((c) => c.id === view.id) : undefined;
  const editing = view.kind === 'edit' && view.id ? cards.find((c) => c.id === view.id) : undefined;
  useWakeLock(open && !!shown);

  const back = () => setView(cards.length === 0 ? { kind: 'edit', id: null } : { kind: 'list' });

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      overlayClassName="bg-black/40"
      className="max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pt-4"
      handleClassName="sm:hidden"
      popupProps={{ 'aria-label': 'Rewards cards' }}
    >
      {view.kind === 'list' && (
        <div className="space-y-3 pt-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Rewards cards</p>
          <ListGroup className="border-0 bg-transparent shadow-none">
            {cards.map((card) => (
              <ListItem key={card.id} asChild className="cursor-pointer rounded-lg hover:bg-muted/50">
                <button type="button" onClick={() => setView({ kind: 'show', id: card.id })} className="text-left">
                  <ListItemLeading>
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <WalletCards className="h-[18px] w-[18px]" />
                    </span>
                  </ListItemLeading>
                  <ListItemContent>
                    <ListItemTitle>{card.name}</ListItemTitle>
                    <ListItemMeta>
                      <span>{loyaltyFormatLabel(card.format)}</span>
                      <span className="font-mono">{loyaltyNumberTail(card.number)}</span>
                    </ListItemMeta>
                  </ListItemContent>
                </button>
              </ListItem>
            ))}
            <ListItem asChild className="cursor-pointer rounded-lg hover:bg-muted/50">
              <button type="button" onClick={() => setView({ kind: 'edit', id: null })} className="text-left">
                <ListItemLeading>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl">
                    <Plus className="h-[18px] w-[18px] text-primary" />
                  </span>
                </ListItemLeading>
                <ListItemContent className="self-center">
                  <ListItemTitle className="text-primary">Add card</ListItemTitle>
                </ListItemContent>
              </button>
            </ListItem>
          </ListGroup>
        </div>
      )}

      {view.kind === 'show' && shown && (
        <div className="space-y-4 pt-1">
          <BackRow label={cards.length > 1 ? 'All cards' : 'Rewards cards'} onClick={back} />
          <div>
            <p className="font-heading text-base font-semibold text-foreground">{shown.name}</p>
            <p className="text-xs text-muted-foreground">Turn your brightness up if it won&apos;t scan</p>
          </div>
          <CardCode number={shown.number} format={shown.format} />
          <p className="select-all text-center font-mono text-lg tabular-nums text-foreground">
            {formatLoyaltyNumber(shown.number)}
          </p>
          <div className="flex justify-between pt-2">
            <Button variant="ghost" className="h-11" onClick={() => setView({ kind: 'edit', id: shown.id })}>
              Edit
            </Button>
            <Button
              variant="ghost"
              className="h-11 text-destructive hover:text-destructive"
              onClick={async () => {
                const confirmed = await dialog.confirm({
                  title: `Remove ${shown.name}?`,
                  message: 'It goes for everyone in your household.',
                  confirmLabel: 'Remove',
                  destructive: true,
                });
                if (!confirmed) return;
                onDelete(shown);
                setView(cards.length > 1 ? { kind: 'list' } : { kind: 'edit', id: null });
              }}
            >
              Remove
            </Button>
          </div>
        </div>
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
                  id: crypto.randomUUID(),
                  group_id: groupId,
                  created_by: null,
                  ...fields,
                  deleted: false,
                  created_at: '',
                  updated_at: '',
                };
            onSave(card);
            success();
            setView({ kind: 'show', id: card.id });
          }}
        />
      )}
    </BottomSheet>
  );
}

function BackRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 flex min-h-11 items-center gap-1 pr-3 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="h-[18px] w-[18px]" />
      {label}
    </button>
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
  const [name, setName] = useState(card?.name ?? '');
  const [number, setNumber] = useState(card ? formatLoyaltyNumber(card.number) : '');
  const [format, setFormat] = useState<LoyaltyCardFormat>(card?.format ?? 'code128');
  const [tried, setTried] = useState(false);

  const normalized = normalizeLoyaltyNumber(number, format);
  const numberError = loyaltyNumberError(normalized, format);
  const nameError = name.trim() ? null : 'Give the card a name';

  return (
    <form
      className="space-y-4 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (nameError || numberError) return;
        onSubmit({ name: name.trim(), number: normalized, format });
      }}
    >
      {showBack ? (
        <BackRow label={card ? card.name : 'Rewards cards'} onClick={onBack} />
      ) : (
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Rewards cards</p>
      )}
      <div>
        <p className="font-heading text-base font-semibold text-foreground">{card ? 'Edit card' : 'Add a card'}</p>
        {!card && (
          <p className="text-xs text-muted-foreground">
            Type the number under the barcode. Everyone in your household can show it.
          </p>
        )}
      </div>
      <label className="block space-y-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Flybuys" className="h-11" />
        {tried && nameError && <span className="block text-xs text-destructive">{nameError}</span>}
      </label>
      <label className="block space-y-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Card number</span>
        <Input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="6008 1234 5678 9012"
          className="h-11 font-mono"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        {tried && numberError && <span className="block text-xs text-destructive">{numberError}</span>}
      </label>
      <div className="space-y-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Code</span>
        <SegmentedControl options={LOYALTY_CARD_FORMATS} value={format} onChange={setFormat} ariaLabel="Code type" />
        <p className="text-xs text-muted-foreground">
          Barcode suits most cards, Flybuys and Everyday Rewards included. Pick QR if the card shows a square code, or EAN-13 only if the card says so.
        </p>
      </div>
      <Button type="submit" className="h-11 w-full">
        {card ? 'Save' : 'Add card'}
      </Button>
    </form>
  );
}
