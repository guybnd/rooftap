// HOUP-88: select-mode bulk-action sheet — set status or set store for the
// selection, following the shipped Groceries bulk-actions-sheet.tsx pattern.
// Bulk delete is a plain destructive Alert in the screen itself (Hearth M4),
// not this sheet.
import { View } from 'react-native';
import { Text, BottomSheet, ListGroup, ListItem, ListItemLeading, ListItemContent, ListItemTitle, cn } from '@homeup/ui';
import { STATUS_ORDER, type SetupStore, SETUP_STATUS_LABEL } from '@homeup/core';
import { STATUS_FILL } from './setup-status';

interface BulkActionsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stores: SetupStore[];
  onSetStatus: (status: (typeof STATUS_ORDER)[number]) => void;
  onSetStore: (storeId: string | null) => void;
}

export function BulkActionsSheet({ open, onOpenChange, stores, onSetStatus, onSetStore }: BulkActionsSheetProps) {
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="max-h-[80%] pb-2">
      <View className="gap-4 px-1.5 pt-1.5">
        <View className="gap-1.5">
          <Text className="px-1.5 text-micro-label uppercase text-muted-foreground">Set status</Text>
          <ListGroup>
            {STATUS_ORDER.map((s) => (
              <ListItem key={s} onPress={() => onSetStatus(s)}>
                <ListItemLeading>
                  <View className={cn('h-2.5 w-2.5 rounded-full', STATUS_FILL[s])} />
                </ListItemLeading>
                <ListItemContent>
                  <ListItemTitle>{SETUP_STATUS_LABEL[s]}</ListItemTitle>
                </ListItemContent>
              </ListItem>
            ))}
          </ListGroup>
        </View>

        {stores.length > 0 && (
          <View className="gap-1.5">
            <Text className="px-1.5 text-micro-label uppercase text-muted-foreground">Set store</Text>
            <ListGroup>
              <ListItem onPress={() => onSetStore(null)}>
                <ListItemContent>
                  <ListItemTitle>No store</ListItemTitle>
                </ListItemContent>
              </ListItem>
              {stores.map((s) => (
                <ListItem key={s.id} onPress={() => onSetStore(s.id)}>
                  <ListItemContent>
                    <ListItemTitle>{s.name}</ListItemTitle>
                  </ListItemContent>
                </ListItem>
              ))}
            </ListGroup>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}
