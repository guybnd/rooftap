// HOUP-84: native port of apps/web/src/components/users-manager.tsx. Zero-prop
// settings panel (owner-only account creation, no email invite required) —
// mirrors group-manager.tsx's data/mutation pattern.
//
// This panel sends the Supabase access token as a Bearer header (the only
// credential native has) on fetch("/api/admin/users", ...) — apps/web's
// getSessionUser() (apps/web/src/lib/supabase/session.ts) accepts that header
// as of HOUP-100/HOUP-125, so Create works the same as web's
// cookie-session flow.
//
// Simplified vs. web: no `sonner` toast / no <Dialog> primitive on native —
// errors show inline, the "reveal password" step uses BottomSheet,
// and the copy-to-clipboard button is dropped (no clipboard dependency exists
// in apps/mobile yet, matching the caution appointment-modal.tsx already
// noted for expo-file-system) in favor of a selectable Text the user can
// long-press to copy natively.
import * as React from 'react';
import { View } from 'react-native';
import { UserPlus } from 'lucide-react-native';
import { Text, BottomSheet, Button, Input } from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';
import { SettingsPanel } from './settings-panel';

type CreatedAccount = { email: string; password: string; displayName: string };

async function callAdminUsersApi(method: 'POST', body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');

  const supabase = getCurrentSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch(`${server.origin}/api/admin/users`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Server responded ${res.status}`);
  return data as Record<string, unknown>;
}

export function UsersManager() {
  const { group, isGroupOwner, refresh } = useDataCache();
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<CreatedAccount | null>(null);

  const handleCreate = React.useCallback(async () => {
    setError(null);
    if (!identifier.trim() || password.length < 6) {
      setError('Enter a username or email, and a password of at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      const data = await callAdminUsersApi('POST', { groupId: group?.id, identifier, password, displayName });
      setCreated({
        email: data.email as string,
        password: data.password as string,
        displayName: data.displayName as string,
      });
      setIdentifier('');
      setPassword('');
      setDisplayName('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create user.');
    } finally {
      setBusy(false);
    }
  }, [group, identifier, password, displayName, refresh]);

  const closeReveal = React.useCallback(() => setCreated(null), []);

  if (!isGroupOwner) return null;

  return (
    <>
      {/* The member list lives once, in the household panel above (with its
          own remove action); this panel is just the direct-create form. */}
      <SettingsPanel
        icon={UserPlus}
        title="Create a user"
        description="Make an account for someone in your household directly, no email invite needed."
      >
        <View className="gap-2">
          <Input
            placeholder="Username or email"
            value={identifier}
            onChangeText={setIdentifier}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Username or email"
          />
          <Input
            placeholder="Display name (optional)"
            value={displayName}
            onChangeText={setDisplayName}
            editable={!busy}
            accessibilityLabel="Display name"
          />
          <Input
            placeholder="Password, 6 characters or more"
            value={password}
            onChangeText={setPassword}
            editable={!busy}
            secureTextEntry
            onSubmitEditing={handleCreate}
            returnKeyType="done"
            accessibilityLabel="Password"
          />
        </View>
        <Button
          onPress={handleCreate}
          disabled={busy || !identifier.trim() || password.length < 6}
          size="sm"
          variant="outline"
          className="self-start px-3"
        >
          <UserPlus size={14} className="text-foreground" />
          <Text className="text-sm font-medium text-foreground">Create user</Text>
        </Button>
        {error && <Text className="px-1 text-caption text-destructive">{error}</Text>}
      </SettingsPanel>

      <BottomSheet open={!!created} onOpenChange={(open) => !open && closeReveal()}>
        <View className="gap-4 px-4 pb-2 pt-1">
          <View className="gap-1">
            <Text className="font-heading text-title font-semibold text-foreground">User created</Text>
            <Text className="text-body text-muted-foreground">
              Share this password with {created?.displayName} now. It won't be shown again, and they should change it
              after signing in.
            </Text>
          </View>

          <View className="gap-2">
            <Text className="text-xs text-muted-foreground">Sign-in email</Text>
            <Text selectable className="font-mono text-sm text-foreground">
              {created?.email}
            </Text>
            <Text className="pt-1 text-xs text-muted-foreground">Password</Text>
            <View className="rounded-lg border border-border bg-muted/30 p-2.5">
              <Text selectable className="font-mono text-xs text-foreground">
                {created?.password}
              </Text>
            </View>
          </View>

          <Button variant="outline" onPress={closeReveal}>
            Done
          </Button>
        </View>
      </BottomSheet>
    </>
  );
}
