// HOUP-88: native port of apps/web/src/app/setup/setup-quick-add.tsx —
// inline "add item to <room>" row shown beneath each room's ListGroup.
import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import type { SetupItem } from '@homeup/core';
import { haptics } from '@homeup/ui';
import { randomUUID } from '@/lib/uuid';

interface QuickAddRowProps {
  groupId: string;
  room: string;
  onCreated: (item: SetupItem) => void;
}

export function QuickAddRow({ groupId, room, onCreated }: QuickAddRowProps) {
  const [name, setName] = React.useState('');

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    haptics.commit();
    // Offline-safe: build the row and hand it to onCreated (-> writeRow),
    // which writes to the local store and syncs.
    const now = new Date().toISOString();
    onCreated({
      id: randomUUID(),
      group_id: groupId,
      name: trimmed,
      room: room === 'Other' ? '' : room,
      priority: 'medium',
      status: 'needed',
      est_price: null,
      actual_price: null,
      where_to_buy: null,
      store_id: null,
      url: null,
      notes: null,
      assigned_to: null,
      private: false,
      template_key: null,
      ai_suggestion: null,
      sort_order: 0,
      created_by: null,
      created_at: now,
      updated_at: now,
      deleted: false,
    });
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
