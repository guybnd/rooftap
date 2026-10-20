// HOUP-88: native per-item store picker. Faithful port of
// apps/web/src/components/store-select.tsx's "full" variant — the compact
// inline-pill variant used on web's card row is dropped here since native
// drops all inline card-field editing in favour of the item editor sheet
// (Checklists/Costs idiom); the card shows the store name as plain text.
// `setup_stores` stays a raw-Supabase entity (not Legend), matching web and
// the shipped `setup-stores-settings.tsx` settings panel.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { Text, Input, SearchablePicker, type PickerOption } from '@homeup/ui';
import { createSetupStore, type SetupStore } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';

interface StoreSelectProps {
  groupId: string;
  value: string | null;
  stores: SetupStore[];
  onChange: (storeId: string | null) => void;
  onStoreCreated?: (store: SetupStore) => void;
}

export function StoreSelect({ groupId, value, stores, onChange, onStoreCreated }: StoreSelectProps) {
  const [adding, setAdding] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const options = React.useMemo<PickerOption[]>(
    () => [{ value: '', primary: 'No store' }, ...stores.map((s) => ({ value: s.id, primary: s.name }))],
    [stores]
  );

  const createStore = async () => {
    const name = newName.trim();
    if (!name) {
      setAdding(false);
      return;
    }
    setSaving(true);
    try {
      // Reuse an existing store with the same name if present (mirrors web).
      const existing = stores.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        onChange(existing.id);
        setAdding(false);
        setNewName('');
        return;
      }

      const store = await createSetupStore(getCurrentSupabaseClient(), groupId, { name });
      onStoreCreated?.(store);
      onChange(store.id);
      setAdding(false);
      setNewName('');
    } catch (err) {
      console.error('Failed to create store:', err);
    } finally {
      setSaving(false);
    }
  };

  if (adding) {
    return (
      <Input
        autoFocus
        value={newName}
        onChangeText={setNewName}
        onSubmitEditing={createStore}
        onBlur={createStore}
        editable={!saving}
        placeholder="Store name"
      />
    );
  }

  return (
    <View className="flex-row items-center gap-2">
      <View className="flex-1">
        <SearchablePicker
          options={options}
          value={value ?? ''}
          onChange={(v) => onChange(v || null)}
          placeholder="No store"
          searchPlaceholder="Search stores…"
          ariaLabel="Store"
        />
      </View>
      <Pressable
        onPress={() => setAdding(true)}
        hitSlop={8}
        className="flex-row items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5"
      >
        <Plus size={13} className="text-muted-foreground" />
        <Text className="text-xs font-medium text-muted-foreground">New</Text>
      </Pressable>
    </View>
  );
}
