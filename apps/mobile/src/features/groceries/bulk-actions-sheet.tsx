// HOUP-80: select-mode bulk-action sheet — set aisle for the selection. Bulk
// delete is a plain destructive Alert in the screen itself (Hearth M4), not
// this sheet. Bulk "assign" is dropped (see the implementation-plan comment);
// assignee stays a per-item field on the edit sheet.
import { BottomSheet, ListGroup, ListItem, ListItemTitle } from '@homeup/ui';
import { AISLE_ORDER, getAisleMeta, type GroceryCustomAisle } from '@homeup/core';

interface BulkActionsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customAisles?: GroceryCustomAisle[];
  onSetAisle: (aisle: string) => void;
}

export function BulkActionsSheet({ open, onOpenChange, customAisles, onSetAisle }: BulkActionsSheetProps) {
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="max-h-[70%] pb-2">
      <ListGroup className="mx-1.5 mt-1.5 border-0 bg-transparent">
        {AISLE_ORDER.map((a) => (
          <ListItem key={a} onPress={() => onSetAisle(a)}>
            <ListItemTitle>{getAisleMeta(a).label}</ListItemTitle>
          </ListItem>
        ))}
        {(customAisles ?? []).map((a) => (
          <ListItem key={a.id} onPress={() => onSetAisle(a.name)}>
            <ListItemTitle>{a.name}</ListItemTitle>
          </ListItem>
        ))}
      </ListGroup>
    </BottomSheet>
  );
}
