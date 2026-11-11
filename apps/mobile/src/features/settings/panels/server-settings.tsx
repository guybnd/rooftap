// Settings > Connected > Server, and About's Sign out (HOUP-616). Both were
// rows on the old Settings hub; they now sit in the tab they belong to.
import * as React from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { LogOut, Server, UserX } from 'lucide-react-native';
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemTitle, Text, haptics, toast } from '@homeup/ui';
import { DELETE_ACCOUNT_COPY, deletionPlanLines, dialog, fetchAccountDeletionPlan, useModules } from '@homeup/core';
import { OFFICIAL_SERVER_LABEL, getStoredServer, type ServerSelection } from '@/lib/server-config';
import { getCurrentSupabaseClient, signOut } from '@/lib/supabase-client';
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

/**
 * About's last row: delete the account (independent review n7; Play Store
 * asks for it in the app). The confirmation names what happens to each home;
 * the web app's POST /api/account/delete does the work, then the phone signs
 * out. Web twin: apps/web/src/components/delete-account-settings.tsx.
 */
export function DeleteAccountRow() {
  const router = useRouter();
  const server = useStoredServer();
  const modules = useModules();
  const [busy, setBusy] = React.useState(false);
  if (!modules.server('account.delete')) return null;

  const handleDelete = async () => {
    if (!server || busy) return;
    const supabase = getCurrentSupabaseClient();
    const plan = await fetchAccountDeletionPlan(supabase);
    const ok = await dialog.confirm({
      title: DELETE_ACCOUNT_COPY.confirmTitle,
      message: [DELETE_ACCOUNT_COPY.lede, ...(plan ? deletionPlanLines(plan) : [])].join('\n\n'),
      confirmLabel: DELETE_ACCOUNT_COPY.confirmLabel,
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(`${server.origin}/api/account/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ confirm: 'delete' }),
      });
      if (!res.ok) {
        toast.error(DELETE_ACCOUNT_COPY.failed);
        return;
      }
      await signOut(server.config);
      haptics.warn();
      toast.success(DELETE_ACCOUNT_COPY.done);
      router.replace('/login');
    } catch {
      toast.error(DELETE_ACCOUNT_COPY.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ListGroup>
      <ListItem onPress={handleDelete} disabled={!server || busy}>
        <ListItemLeading>
          {/* H2: danger is a word or a glyph, never a tinted block. */}
          <UserX size={16} className="text-destructive" />
        </ListItemLeading>
        <ListItemContent>
          <ListItemTitle className="text-destructive">{busy ? 'Deleting...' : DELETE_ACCOUNT_COPY.title}</ListItemTitle>
        </ListItemContent>
      </ListItem>
    </ListGroup>
  );
}
