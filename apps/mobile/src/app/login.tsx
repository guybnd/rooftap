// HOUP-69: sign-in screen for the chosen server (password or Google). When
// the server allows it, "Make an account" opens /signup, and "Forgot
// password?" opens the web app's reset page in the browser, so the reset
// email's link and the new password happen in the same browser.
//
// With no stored server (a first launch) it signs in to the official server:
// it stores that choice once the server's config loads, and "Use my own
// server" under the form opens the picker.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { getQueryParams } from 'expo-auth-session/build/QueryParams';
import { fetchAuthSettings, normalizeIdentifier, type AuthSettings } from '@homeup/core';
import { Text, Button, Input, ScreenBackground, haptics } from '@homeup/ui';
import { FieldGroup, FirstRunHeader, LegalLine, ServerChip } from '@/components/first-run';
import {
  OFFICIAL_SERVER_URL,
  fetchPublicConfig,
  getStoredServer,
  normalizeServerOrigin,
  storeServer,
  type ServerSelection,
} from '@/lib/server-config';
import { getSupabaseClient, resetSupabaseClient } from '@/lib/supabase-client';
import { completeOAuthRedirect } from '@/lib/oauth-redirect';
import { useLegalLinks } from '@/lib/use-legal-links';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [server, setServer] = React.useState<ServerSelection | null | undefined>(undefined);
  // Terms and Privacy Policy links, when the server has them.
  const legal = useLegalLinks(server);
  const [hasSession, setHasSession] = React.useState<boolean | null>(null);

  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [authSettings, setAuthSettings] = React.useState<AuthSettings | null>(null);

  // Bumped by Try again when the official server couldn't be reached.
  const [attempt, setAttempt] = React.useState(0);
  const [offline, setOffline] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let stored = await getStoredServer();
      if (cancelled) return;
      if (!stored && OFFICIAL_SERVER_URL) {
        // First launch: sign in to the official server without asking.
        try {
          const origin = normalizeServerOrigin(OFFICIAL_SERVER_URL);
          const config = await fetchPublicConfig(origin, 15_000);
          if (cancelled) return;
          await storeServer(origin, config);
          resetSupabaseClient();
          stored = await getStoredServer();
        } catch {
          if (!cancelled) setOffline(true);
          return;
        }
        if (cancelled) return;
      }
      setOffline(false);
      setServer(stored);
      if (!stored) return;
      fetchAuthSettings(stored.config.supabaseUrl, stored.config.supabaseAnonKey).then((s) => {
        if (!cancelled) setAuthSettings(s);
      });
      const { data } = await getSupabaseClient(stored.config).auth.getSession();
      if (!cancelled) setHasSession(!!data.session);
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const openServerPicker = () => router.push('/server-picker?mode=switch');

  if (offline) {
    return (
      <ScreenBackground className="items-center justify-center px-6" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="w-full max-w-sm gap-6">
          <FirstRunHeader title="Welcome home" lede="Rooftap can't reach the internet right now. Check your connection and try again." />
          <Button size="lg" className="h-12" onPress={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
          <OwnServerLink onPress={() => router.push('/server-picker')} />
        </View>
      </ScreenBackground>
    );
  }
  if (server === undefined || (server && hasSession === null)) return <ScreenBackground />;
  if (server === null) return <Redirect href="/server-picker" />;
  if (hasSession) return <Redirect href="/home" />;

  const supabase = getSupabaseClient(server.config);

  async function handlePasswordSignIn() {
    setError(null);
    setLoading(true);
    try {
      const email = normalizeIdentifier(identifier);
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        console.error('Password sign-in failed:', signInError.message);
        setError(signInError.message);
        return;
      }
      if (!data.session) {
        console.error('Password sign-in returned no error but no session either');
        setError('Sign-in did not complete. Please try again.');
        return;
      }
      router.replace('/home');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setLoading(true);
    try {
      const redirectTo = makeRedirectUri({ path: '/callback' });
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (oauthError || !data?.url) {
        setError(oauthError?.message ?? 'Could not start Google sign-in');
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) return;

      const { params, errorCode } = getQueryParams(result.url);
      const outcome = await completeOAuthRedirect(supabase.auth, params, errorCode);
      if (outcome.status === 'error') {
        setError(outcome.message);
        return;
      }
      if (outcome.status === 'signed-in') {
        router.replace('/home');
      } else {
        // The redirect landed back in the app but carried neither a code nor
        // an error param — happens when Supabase's Auth → URL Configuration
        // redirect allowlist doesn't include this app's scheme, so it
        // silently redirects to the project's Site URL instead of `redirectTo`
        // (see HOUP-184). Surface it instead of leaving the user on a
        // stuck/blank sign-in.
        setError('Google sign-in did not return to the app. This is usually a server-side redirect allowlist issue. Contact support.');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenBackground className="items-center justify-center px-6" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View className="w-full max-w-sm gap-6">
        <FirstRunHeader title="Welcome home" lede="Sign in to see your household's day.">
          {!server.isOfficial && <ServerChip label={server.origin} onChange={openServerPicker} />}
        </FirstRunHeader>

        <Button variant="outline" size="lg" className="h-12" onPress={handleGoogleSignIn} disabled={loading}>
          Continue with Google
        </Button>

        <View className="flex-row items-center gap-3">
          <View className="h-px flex-1 bg-border/60" />
          <Text className="text-caption text-muted-foreground">or with email</Text>
          <View className="h-px flex-1 bg-border/60" />
        </View>

        <View className="gap-2">
          <FieldGroup>
            <Input
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="Email or username"
              autoCapitalize="none"
              autoCorrect={false}
              className={FieldGroup.input}
            />
            <Input value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry className={FieldGroup.input} />
          </FieldGroup>
          {error && <Text className="px-1 text-caption text-destructive">{error}</Text>}
        </View>

        <Button size="lg" className="h-12" onPress={handlePasswordSignIn} disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>

        {(authSettings?.signupOpen || authSettings?.sendsEmail) && (
          <View className="flex-row items-center justify-between px-1">
            {authSettings.sendsEmail ? (
              <TextLink label="Forgot password?" onPress={() => void WebBrowser.openBrowserAsync(`${server.origin}/forgot-password`)} />
            ) : (
              <View />
            )}
            {authSettings.signupOpen && <TextLink label="Make an account" onPress={() => router.push('/signup')} />}
          </View>
        )}

        {server.isOfficial && <OwnServerLink onPress={openServerPicker} />}

        <LegalLine links={legal} />
      </View>
    </ScreenBackground>
  );
}

/** For people who run their own Rooftap server: a quiet link under sign-in. */
function OwnServerLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onPress();
      }}
      accessibilityRole="link"
      hitSlop={8}
      className="items-center py-1 active:opacity-70"
    >
      <Text className="text-caption font-medium text-primary">Use my own server</Text>
    </Pressable>
  );
}

function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onPress();
      }}
      accessibilityRole="link"
      hitSlop={8}
      className="active:opacity-70"
    >
      <Text className="text-body text-muted-foreground">{label}</Text>
    </Pressable>
  );
}
