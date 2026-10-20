// HOUP-84: native port of apps/web's saved-searches-settings.tsx — reuses
// @homeup/core's savedSearches$ Legend store + useReconnectSync/useStoreHelpers
// verbatim (HOUP-73), same import names as web's own panel, so this never
// forks the sync/write path. The web "Add saved search" affordance is an
// inline expanding form (not a modal), so per the DIALOG RULE there's nothing
// to convert to a Sheet here — it ports straight to an inline list + form
// section. As on web, tapping a row opens the search (via React Native's
// Linking instead of a web <a target="_blank">) and remove is the one
// trailing verb.
import * as React from 'react';
import { Linking, View } from 'react-native';
import { use$ } from '@legendapp/state/react';
import { Bookmark, ExternalLink, Plus, Trash2 } from 'lucide-react-native';
import {
  Text,
  Button,
  FieldRow,
  FormSection,
  Input,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
} from '@homeup/ui';
import { savedSearches$, useReconnectSync, useStoreHelpers, type SavedSearch } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { randomUUID } from '@/lib/uuid';
import { SettingsInset, SettingsPanel } from './settings-panel';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function SavedSearchesSettings() {
  const { group, currentUserId } = useDataCache();
  const searches$ = savedSearches$(group?.id);
  useReconnectSync(searches$);
  const { writeRow, softDeleteRow } = useStoreHelpers(searches$, currentUserId);
  const savedSearches = use$(() =>
    Object.values(searches$.get() ?? {}).filter((s): s is SavedSearch => !!s && !s.deleted)
  );

  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const handleAdd = () => {
    if (!name.trim() || !url.trim() || !group || !currentUserId) return;
    setSaving(true);

    writeRow({
      id: randomUUID(),
      group_id: group.id,
      created_by: currentUserId,
      name: name.trim(),
      url: url.trim(),
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    });

    setName('');
    setUrl('');
    setAdding(false);
    setSaving(false);
  };

  const handleRemove = (id: string) => softDeleteRow(id);

  return (
    <SettingsPanel
      icon={Bookmark}
      title="Saved searches"
      description="Listing searches everyone in the household can check for new places."
    >
      {savedSearches.length > 0 && (
        <SettingsInset>
          {savedSearches.map((s) => (
            <ListItem
              key={s.id}
              onPress={() => void Linking.openURL(s.url)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${s.name}`}
              className="min-h-[52px] items-center py-2 pl-3.5 pr-2"
            >
              <ListItemContent>
                <ListItemTitle>
                  <Text numberOfLines={1} className="shrink font-medium text-foreground">
                    {s.name}
                  </Text>
                  <ExternalLink size={12} className="shrink-0 text-muted-foreground" />
                </ListItemTitle>
                <ListItemMeta>
                  <Text numberOfLines={1} className="text-caption text-muted-foreground">
                    {hostOf(s.url)}
                  </Text>
                </ListItemMeta>
              </ListItemContent>
              <ListItemTrailing className="mt-0">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  accessibilityLabel={`Remove ${s.name}`}
                  onPress={() => handleRemove(s.id)}
                >
                  <Trash2 size={16} className="text-muted-foreground" />
                </Button>
              </ListItemTrailing>
            </ListItem>
          ))}
        </SettingsInset>
      )}

      {adding ? (
        <View className="gap-3">
          <FormSection>
            <FieldRow label="Name">
              <Input value={name} onChangeText={setName} placeholder="Inner West 2BR under $600" autoFocus />
            </FieldRow>
            <FieldRow label="Link">
              <Input
                value={url}
                onChangeText={setUrl}
                placeholder="https://www.realestate.com.au/rent/..."
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </FieldRow>
          </FormSection>
          <View className="flex-row items-center gap-2">
            <Button size="sm" className="px-3" onPress={handleAdd} disabled={!name.trim() || !url.trim() || saving}>
              {saving ? 'Saving…' : 'Save search'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="px-3"
              onPress={() => {
                setAdding(false);
                setName('');
                setUrl('');
              }}
            >
              Cancel
            </Button>
          </View>
        </View>
      ) : (
        <Button size="sm" variant="outline" onPress={() => setAdding(true)} className="self-start px-3">
          <Plus size={14} className="text-foreground" />
          <Text className="text-[0.8rem] font-medium text-foreground">Add saved search</Text>
        </Button>
      )}
    </SettingsPanel>
  );
}
