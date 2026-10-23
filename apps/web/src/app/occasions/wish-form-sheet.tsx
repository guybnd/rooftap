'use client';

// Occasions: add or edit something on your own wishlist. Everyone in the
// household can read it, to drop hints. Native twin:
// apps/mobile/src/features/occasions/wish-form-sheet.tsx.
import { useState } from 'react';
import { Gift } from 'lucide-react';
import { buildWishlistItem, parsePriceInput, type OccasionsApi, type WishlistItem } from '@homeup/core';
import { ItemFormSheet, FormSection, FieldRow } from '@/components/ui/item-form-sheet';
import { Input } from '@/components/ui/input';

const OCCASIONS_SECTION = { id: 'occasions', Icon: Gift };

export function WishFormSheet({
  isOpen,
  onClose,
  item,
  api,
  groupId,
  currentUserId,
}: {
  isOpen: boolean;
  onClose: () => void;
  item?: WishlistItem;
  api: OccasionsApi;
  groupId: string;
  currentUserId: string;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [price, setPrice] = useState(item?.price_cents ? String(item.price_cents / 100) : '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [tried, setTried] = useState(false);

  const submit = () => {
    setTried(true);
    if (!title.trim()) return;
    const fields = { title: title.trim(), url: url.trim() || null, price_cents: parsePriceInput(price), notes: notes.trim() || null };
    const saved: WishlistItem = item
      ? { ...item, ...fields }
      : { ...buildWishlistItem({ id: crypto.randomUUID(), groupId, userId: currentUserId, title: fields.title }), ...fields, created_at: '', updated_at: '' };
    api.saveWish(saved);
    onClose();
  };

  return (
    <ItemFormSheet
      section={OCCASIONS_SECTION}
      isOpen={isOpen}
      onClose={onClose}
      title={item ? 'Edit wish' : 'Add to your wishlist'}
      onSubmit={submit}
      submitLabel={item ? 'Save' : 'Add'}
      onDelete={item ? () => { api.deleteWish(item.id); onClose(); } : undefined}
      deleteLabel="Remove from wishlist"
    >
      <FormSection>
        <FieldRow label="What you'd like" htmlFor="wish-title" required error={tried && !title.trim() ? 'Name it' : null}>
          <Input id="wish-title" autoFocus={!item} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New running shoes, size 8" maxLength={120} />
        </FieldRow>
        <FieldRow label="Link" htmlFor="wish-url">
          <Input id="wish-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Optional" autoComplete="off" />
        </FieldRow>
        <FieldRow label="Price" htmlFor="wish-price">
          <Input id="wish-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Optional" className="tabular-nums" />
        </FieldRow>
        <FieldRow label="Notes" htmlFor="wish-notes" hint="Everyone in your household can see your wishlist.">
          <Input id="wish-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" maxLength={300} />
        </FieldRow>
      </FormSection>
    </ItemFormSheet>
  );
}
