// HOUP-88: native port of apps/web/src/app/setup/setup-quick-add.tsx —
// inline "add item to <room>" row shown beneath each room's ListGroup.
import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { quickAddSetupItem, type SetupItem } from '@homeup/core';
import { haptics } from '@homeup/ui';

interface QuickAddRowProps {
  groupId: string;
  room: string;
  onCreated: (item: SetupItem) => void;
}

export function QuickAddRow({ groupId, room, onCreated }: QuickAddRowProps) {
  const [name, setName] = React.useState('');

  const create = () => {
    const row = quickAddSetupItem(groupId, room, name);
    if (!row) return;
    haptics.commit();
    // Offline-safe: hand the row to onCreated (-> writeRow), which writes to
    // the local store and syncs; writeRow stamps created_by.
    onCreated(row);
    setName('');
  };

  return (
    <View className="min-h-11 flex-row items-center gap-2 rounded-xl border border-dashed border-border px-3 py-1.5">
      <Plus size={14} className="text-muted-foreground" />
      <TextInput
        value={name}
        onChangeText={setName}
        onSubmitEditing={create}
        onBlur={create}
        placeholder={`Add item to ${room}…`}
        className="flex-1 text-body text-foreground placeholder:text-muted-foreground"
      />
      {name.trim().length > 0 && (
        <Pressable onPress={create} hitSlop={6}>
          <Plus size={14} className="text-primary" />
        </Pressable>
      )}
    </View>
  );
}
