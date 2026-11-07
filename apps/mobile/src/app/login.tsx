// HOUP-69: sign-in screen for the chosen server (password or Google). Native
// account creation isn't in scope here — new accounts are created on the
// web app; this mirrors the plan's step 5/6 (password + native Google OAuth
// only).
import * as React from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { getQueryParams } from 'expo-auth-session/build/QueryParams';
import { normalizeIdentifier } from '@homeup/core';
import { Text, Button, Input, ScreenBackground } from '@homeup/ui';
import { FieldGroup, FirstRunHeader, ServerChip } from '@/components/first-run';
import { getStoredServer, type ServerSelection } from '@/lib/server-config';
import { getSupabaseClient } from '@/lib/supabase-client';
import { completeOAuthRedirect } from '@/lib/oauth-redirect';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [server, setServer] = React.useState<ServerSelection | null | undefined>(undefined);
  const [hasSession, setHasSession] = React.useState<boolean | null>(null);

  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getStoredServer();
      if (cancelled) return;
      setServer(stored);
      if (!stored) return;
      const { data } = await getSupabaseClient(stored.config).auth.getSession();
      if (!cancelled) setHasSession(!!data.session);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (server === undefined || (server && hasSession === null)) return null;
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
          <ServerChip label={server.isOfficial ? 'Official server' : server.origin} onChange={() => router.push('/server-picker?mode=switch')} />
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
      </View>
    </ScreenBackground>
  );
}
