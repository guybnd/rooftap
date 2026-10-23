// Occasions: add or edit something on your own wishlist. Everyone in the
// household can read it, to drop hints. Web twin:
// apps/web/src/app/occasions/wish-form-sheet.tsx.
import { Gift } from 'lucide-react-native';
import { FieldRow, FormSection, Input, ItemFormSheet } from '@homeup/ui';
import { useWishForm, type OccasionsApi, type WishlistItem } from '@homeup/core';

const OCCASIONS_SECTION = { id: 'occasions', Icon: Gift };

export function WishFormSheet({
  open,
  onOpenChange,
  item,
  api,
  groupId,
  currentUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: WishlistItem;
  api: OccasionsApi;
  groupId: string;
  currentUserId: string;
}) {
  const form = useWishForm({ item, api, groupId, currentUserId });
  const { title, setTitle, url, setUrl, price, setPrice, notes, setNotes, tried } = form;

  const submit = () => {
    if (form.submit()) onOpenChange(false);
  };

  return (
    <ItemFormSheet
      open={open}
      onOpenChange={onOpenChange}
      section={OCCASIONS_SECTION}
      title={item ? 'Edit wish' : 'Add to your wishlist'}
      onSubmit={submit}
      submitLabel={item ? 'Save' : 'Add'}
      onDelete={
        item
          ? () => {
              api.deleteWish(item.id);
              onOpenChange(false);
            }
          : undefined
      }
      deleteLabel="Remove from wishlist"
    >
      <FormSection>
        <FieldRow label="What you'd like" required error={tried && !title.trim() ? 'Name it' : null}>
          <Input autoFocus={!item} value={title} onChangeText={setTitle} placeholder="New running shoes, size 8" maxLength={120} />
        </FieldRow>
        <FieldRow label="Link">
          <Input keyboardType="url" autoCapitalize="none" autoCorrect={false} value={url} onChangeText={setUrl} placeholder="Optional" />
        </FieldRow>
        <FieldRow label="Price">
          <Input keyboardType="decimal-pad" value={price} onChangeText={setPrice} placeholder="Optional" className="tabular-nums" />
        </FieldRow>
        <FieldRow label="Notes" hint="Everyone in your household can see your wishlist.">
          <Input value={notes} onChangeText={setNotes} placeholder="Optional" maxLength={300} />
        </FieldRow>
      </FormSection>
    </ItemFormSheet>
  );
}
