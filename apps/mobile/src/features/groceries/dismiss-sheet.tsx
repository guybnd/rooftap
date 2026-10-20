// First tap on a running-low suggestion's X, before a default is stored:
// pick Not now or Archive. The pick runs now and becomes the default for the
// X (see use-suggest-dismiss.ts); web's equivalent is the DismissMenu in
// apps/web/src/app/groceries/suggest-re-add-section.tsx.
import * as React from 'react';
import { View } from 'react-native';
import { BottomSheet, ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, Text } from '@homeup/ui';
import { GROCERY_DISMISS_ACTIONS, GROCERY_DISMISS_LABELS, type GroceryDismissAction } from '@homeup/core';

interface DismissSheetProps {
  itemName: string | null;
  onOpenChange: (open: boolean) => void;
  onPick: (action: GroceryDismissAction) => void;
}

export function DismissSheet({ itemName, onOpenChange, onPick }: DismissSheetProps) {
  return (
    <BottomSheet open={!!itemName} onOpenChange={onOpenChange} className="pb-2">
      <View className="px-4 pt-2">
        <Text className="text-[15px] font-semibold text-foreground">Stop suggesting {itemName}</Text>
      </View>
      <ListGroup className="mx-1.5 mt-1.5 border-0 bg-transparent">
        {GROCERY_DISMISS_ACTIONS.map((action) => (
          <ListItem key={action} onPress={() => onPick(action)}>
            <ListItemContent>
              <ListItemTitle>{GROCERY_DISMISS_LABELS[action].title}</ListItemTitle>
              <ListItemMeta>
                <Text className="text-caption text-muted-foreground">{GROCERY_DISMISS_LABELS[action].detail}</Text>
              </ListItemMeta>
            </ListItemContent>
          </ListItem>
        ))}
      </ListGroup>
      <Text className="px-4 pb-2 text-caption text-muted-foreground">
        Your pick becomes what the X does. Change it in Settings, Groceries.
      </Text>
    </BottomSheet>
  );
}
