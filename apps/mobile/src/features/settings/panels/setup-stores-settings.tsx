// HOUP-84: native port of apps/web's setup-stores-settings.tsx. Manage the
// household's stores — name + optional link and address. Backed by the same
// group-scoped setup_stores table (shared across the group), which also
// powers the per-item store picker in Setup.
//
// Deviations from the web version (see report): the web inline-edit form (an
// expanded <li>) and the always-visible add form become a single
// add/edit `ItemFormSheet` — per this ticket's Dialog rule, any web popup/
// inline-form pattern maps onto the shared Sheet primitives instead of a
// bespoke local form, and one sheet in add vs. edit mode avoids shipping two
// near-identical forms.
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { ExternalLink, Plus, Store } from 'lucide-react-native';
import {
  Text,
  Button,
  FieldRow,
  FormSection,
  Input,
  ItemFormSheet,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
} from '@homeup/ui';
import { createSetupStore, deleteSetupStore, listSetupStores, updateSetupStore, type SetupStore } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { SettingsInset, SettingsPanel } from './settings-panel';

function linkHref(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`;
}

/** A store link reads as its host ("bunnings.com.au"), not the full URL. */
function linkLabel(url: string): string {
  try {
    return new URL(linkHref(url)).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function SetupStoresSettings() {
  const { group } = useDataCache();
  const groupId = group?.id ?? null;
  const [stores, setStores] = useState<SetupStore[]>([]);
  const [loading, setLoading] = useState(true);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<SetupStore | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchStores = useCallback(async () => {
    if (!groupId) return;
    setStores(await listSetupStores(getCurrentSupabaseClient(), groupId));
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    void fetchStores();
  }, [fetchStores]);

  const openAdd = () => {
    setEditingStore(null);
    setName('');
    setUrl('');
    setAddress('');
    setSheetOpen(true);
  };

  const openEdit = (s: SetupStore) => {
    setEditingStore(s);
    setName(s.name);
    setUrl(s.url ?? '');
    setAddress(s.address ?? '');
    setSheetOpen(true);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || !groupId) return;
    setSaving(true);
    try {
      const supabase = getCurrentSupabaseClient();
      const fields = { name: trimmed, url, address };
      if (editingStore) {
        await updateSetupStore(supabase, editingStore.id, fields);
      } else {
        await createSetupStore(supabase, groupId, fields);
      }
      setSheetOpen(false);
      await fetchStores();
    } catch (err) {
      console.error('Failed to save store:', err);
    } finally {
      setSaving(false);
    }
  };

  const removeStore = async () => {
    if (!editingStore) return;
    setSaving(true);
    try {
      await deleteSetupStore(getCurrentSupabaseClient(), editingStore.id);
      setSheetOpen(false);
      await fetchStores();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPanel
      icon={Store}
      title="Stores"
      description="Where your household buys things for the home. Setup items can be tagged with these."
    >
      {!loading && stores.length > 0 && (
        <SettingsInset>
          {stores.map((s) => {
            const meta = [s.url ? linkLabel(s.url) : null, s.address].filter(Boolean).join(' · ');
            return (
              <ListItem
                key={s.id}
                onPress={() => openEdit(s)}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${s.name}`}
                className="min-h-[52px] items-center py-2 pl-3.5 pr-2"
              >
                <ListItemContent>
                  <ListItemTitle>{s.name}</ListItemTitle>
                  {meta ? (
                    <ListItemMeta>
                      <Text numberOfLines={1} className="text-caption text-muted-foreground">
                        {meta}
                      </Text>
                    </ListItemMeta>
                  ) : null}
                </ListItemContent>
                {s.url && (
                  <ListItemTrailing className="mt-0">
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        void Linking.openURL(linkHref(s.url!));
                      }}
                      hitSlop={4}
                      accessibilityRole="link"
                      accessibilityLabel={`Open ${s.name}'s site`}
                      className="size-9 items-center justify-center rounded-full active:bg-accent/40"
                    >
                      <ExternalLink size={16} className="text-muted-foreground" />
                    </Pressable>
                  </ListItemTrailing>
                )}
              </ListItem>
            );
          })}
        </SettingsInset>
      )}

      {!loading && stores.length === 0 && (
        <Text className="px-1 text-body text-muted-foreground">No stores yet.</Text>
      )}

      <Button variant="outline" size="sm" onPress={openAdd} disabled={!groupId} className="self-start px-3">
        <Plus size={14} className="text-foreground" />
        <Text className="text-[0.8rem] font-medium text-foreground">Add store</Text>
      </Button>

      <ItemFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={editingStore ? 'Edit store' : 'Add store'}
        icon={<Store size={18} className="text-foreground" />}
        onSubmit={save}
        canSubmit={!!name.trim()}
        saving={saving}
        onDelete={editingStore ? removeStore : undefined}
      >
        <FormSection>
          <FieldRow label="Name" required>
            <Input value={name} onChangeText={setName} placeholder="Store name" autoFocus />
          </FieldRow>
          <FieldRow label="Link" hint="Optional">
            <Input
              value={url}
              onChangeText={setUrl}
              placeholder="example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </FieldRow>
          <FieldRow label="Address" hint="Optional">
            <Input value={address} onChangeText={setAddress} placeholder="Address" />
          </FieldRow>
        </FormSection>
      </ItemFormSheet>
    </SettingsPanel>
  );
}
