// HOUP-78: native port of apps/web/src/components/saved-search-picker.tsx.
// Web opens a DOM popover (`document` "mousedown" outside-click + Escape-key
// listeners) anchored under the trigger button, and opens each saved search
// in a new browser tab via a plain `<a target="_blank">`. Per the established
// pattern (see `packages/ui/src/components/searchable-picker.tsx`'s own
// rationale comment, also followed by `assignee-picker.tsx`), native has no
// `document` to listen on, so the trigger opens a `BottomSheet` instead — its
// backdrop press + Android hardware-back already give "dismiss without
// picking" for free — and each row opens its URL via RN `Linking.openURL`
// instead of a DOM anchor. Hostname display: no other file under apps/mobile
// uses `new URL(...)` yet, so rather than assume Hermes' `URL` global covers
// every case, the hostname is derived with a plain string parse instead.
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronDown, Search, Settings2 } from 'lucide-react-native';
import { use$ } from '@legendapp/state/react';
import { Text, Button, BottomSheet, ListItem, ListItemContent, ListItemTitle, ListItemMeta } from '@homeup/ui';
import { savedSearches$, useReconnectSync, type SavedSearch } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';

/** Strips the scheme and everything past the first `/` — avoids depending on the `URL` global. */
function hostnameOf(url: string): string {
  const withoutScheme = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  const end = withoutScheme.search(/[/?#]/);
  return end === -1 ? withoutScheme : withoutScheme.slice(0, end);
}

export function SavedSearchPicker() {
  const router = useRouter();
  const { group } = useDataCache();
  const searches$ = savedSearches$(group?.id);
  useReconnectSync(searches$);
  const savedSearches = use$(() =>
    Object.values(searches$.get() ?? {}).filter((s): s is SavedSearch => !!s && !s.deleted)
  );
  const [open, setOpen] = useState(false);

  const goToSettings = () => {
    setOpen(false);
    router.push('/settings');
  };

  // Hearth v2 pass: a neutral outline button (was a coral tint, HOUP-174 item
  // 5). The screen's one accent is the Add button (H5); a second coral
  // control beside it read as two primaries. Mirrors web's picker.
  if (savedSearches.length === 0) {
    return (
      <Button variant="outline" size="sm" className="h-10 rounded-xl border-border/60 bg-card/70 px-3.5" onPress={goToSettings}>
        <Search size={14} className="text-muted-foreground" />
        <Text className="text-sm font-medium text-foreground">Find more apartments</Text>
        <Settings2 size={13} className="text-muted-foreground" />
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" className="h-10 rounded-xl border-border/60 bg-card/70 px-3.5" onPress={() => setOpen(true)}>
        <Search size={14} className="text-muted-foreground" />
        <Text className="text-sm font-medium text-foreground">Find more apartments</Text>
        <ChevronDown size={13} className="text-muted-foreground" />
      </Button>

      <BottomSheet open={open} onOpenChange={setOpen} className="max-h-[70%]">
        <View className="px-2 pb-2">
          <Text className="px-2 py-1 text-micro-label uppercase text-muted-foreground">Saved searches</Text>
          {savedSearches.map((s) => (
            <ListItem
              key={s.id}
              onPress={() => {
                setOpen(false);
                void Linking.openURL(s.url);
              }}
            >
              <ListItemContent>
                <ListItemTitle>{s.name}</ListItemTitle>
                <ListItemMeta>
                  <Text numberOfLines={1} className="text-xs text-muted-foreground">{hostnameOf(s.url)}</Text>
                </ListItemMeta>
              </ListItemContent>
            </ListItem>
          ))}
          <ListItem onPress={goToSettings}>
            <ListItemContent>
              <ListItemTitle className="text-muted-foreground">Manage searches</ListItemTitle>
            </ListItemContent>
          </ListItem>
        </View>
      </BottomSheet>
    </>
  );
}
