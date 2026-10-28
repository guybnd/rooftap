// A newer Rooftap release for this server, shown only to the people who run
// it (core app-release.ts, GET /api/server-update). The web twin is
// apps/web/src/components/server-update.tsx; the one-time toast lives in
// lib/use-update-toasts.ts.
import * as React from 'react';
import { Linking, View } from 'react-native';
import { Server } from 'lucide-react-native';
import { Button, Text } from '@homeup/ui';
import { SERVER_UPGRADE_COMMANDS, SERVER_UPGRADE_DOCS_URL, serverUpdateNotice, useServerUpdate } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { fetchServerUpdate } from '../server-update-api';
import { SettingsPanel } from './settings-panel';

export function ServerUpdatePanel() {
  const update = useServerUpdate(fetchServerUpdate, useDataCache().currentUserId);
  if (!update) return null;
  const notice = serverUpdateNotice(update);
  return (
    <SettingsPanel icon={Server} title={notice.title}>
      <Text className="text-body text-muted-foreground">{notice.description}</Text>
      <Text className="text-body text-muted-foreground">Back up first, then run these in the server&apos;s Rooftap folder:</Text>
      <View className="rounded-lg bg-muted px-3 py-2">
        <Text selectable className="text-data-fragment text-foreground">
          {SERVER_UPGRADE_COMMANDS.join('\n')}
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Button onPress={() => Linking.openURL(update.url).catch(() => {})} size="sm" className="px-3">
          What changed
        </Button>
        <Button onPress={() => Linking.openURL(SERVER_UPGRADE_DOCS_URL).catch(() => {})} size="sm" variant="outline" className="px-3">
          <Text className="text-[0.8rem] font-medium text-foreground">Upgrade guide</Text>
        </Button>
      </View>
    </SettingsPanel>
  );
}
