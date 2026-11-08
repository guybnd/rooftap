// Settings > Connected > Server, and About's Sign out (HOUP-616). Both were
// rows on the old Settings hub; they now sit in the tab they belong to.
import * as React from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { LogOut, Server } from 'lucide-react-native';
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemTitle, Text, haptics } from '@homeup/ui';
import { dialog } from '@homeup/core';
import { OFFICIAL_SERVER_LABEL, getStoredServer, type ServerSelection } from '@/lib/server-config';
import { signOut } from '@/lib/supabase-client';
import { SettingsPanel } from './settings-panel';

function useStoredServer(): ServerSelection | null {
  const [server, setServer] = React.useState<ServerSelection | null>(null);
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      getStoredServer().then((stored) => {
        if (!cancelled) setServer(stored);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );
  return server;
}

function serverLabel(server: ServerSelection | null): string | null {
  return server ? (server.isOfficial ? OFFICIAL_SERVER_LABEL : server.origin) : null;
}

export function ServerSettings() {
  const router = useRouter();
  const server = useStoredServer();
  return (
    <SettingsPanel icon={Server} title="Server" summary={serverLabel(server)} description="Where this phone keeps your household. Switching signs you in on the other server.">
      <ListGroup bordered={false} className="overflow-hidden rounded-xl bg-muted/30">
        <ListItem onPress={() => router.push({ pathname: '/server-picker', params: { mode: 'switch' } })} className="min-h-[52px] items-center px-3.5">
          <ListItemContent>
            <Text numberOfLines={1} className="text-sm font-medium text-foreground">
              {serverLabel(server) ?? '...'}
            </Text>
          </ListItemContent>
          <Text className="text-body font-medium text-primary">Switch</Text>
        </ListItem>
      </ListGroup>
    </SettingsPanel>
  );
}

export function SignOutRow() {
  const router = useRouter();
  const server = useStoredServer();
  const handleSignOut = () => {
    if (!server) return;
    dialog.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut(server.config);
          haptics.warn();
          router.replace('/login');
        },
      },
    ]);
  };
  return (
    <ListGroup>
      <ListItem onPress={handleSignOut} disabled={!server}>
        <ListItemLeading>
          {/* H2: danger is a word or a glyph, never a tinted block. */}
          <LogOut size={16} className="text-destructive" />
        </ListItemLeading>
        <ListItemContent>
          <ListItemTitle className="text-destructive">Sign out</ListItemTitle>
        </ListItemContent>
      </ListItem>
    </ListGroup>
  );
}
