// Email sign-up on the phone (independent review n7). Web twin:
// apps/web/src/app/(auth)/signup/page.tsx. Login shows the way here only when
// the server takes new accounts. A server that sends email asks the person to
// confirm first; the email's link opens the web sign-in page, and they then
// sign in here. A server with no mailer signs them in at once.
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_PASSWORD_LENGTH, fetchAuthSettings, normalizeIdentifier, type AuthSettings } from '@homeup/core';
import { Text, Button, Input, ScreenBackground } from '@homeup/ui';
import { FieldGroup, FirstRunHeader, LegalLine } from '@/components/first-run';
import { getStoredServer, type ServerSelection } from '@/lib/server-config';
import { getSupabaseClient } from '@/lib/supabase-client';
import { useLegalLinks } from '@/lib/use-legal-links';

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [server, setServer] = React.useState<ServerSelection | null>(null);
  const [settings, setSettings] = React.useState<AuthSettings | null | undefined>(undefined);
  const [name, setName] = React.useState('');
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  // Terms and Privacy Policy links, when the server has them.
  const legal = useLegalLinks(server);

  React.useEffect(() => {
    let live = true;
    (async () => {
      const stored = await getStoredServer();
      if (!live) return;
      setServer(stored);
      if (!stored) {
        setSettings(null);
        return;
      }
      const s = await fetchAuthSettings(stored.config.supabaseUrl, stored.config.supabaseAnonKey);
      if (live) setSettings(s);
    })();
    return () => {
      live = false;
    };
  }, []);

  async function handleSubmit() {
    if (!server) return;
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    try {
      const email = normalizeIdentifier(identifier);
      const { data, error: signUpError } = await getSupabaseClient(server.config).auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name.trim() || identifier.trim() },
          emailRedirectTo: `${server.origin}/login?confirmed=1`,
        },
      });
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (data.session) {
        router.replace('/home');
        return;
      }
      setSentTo(email);
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  if (settings === undefined) return null;

  const frame = (children: React.ReactNode) => (
    <ScreenBackground className="items-center justify-center px-6" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View className="w-full max-w-sm gap-6">{children}</View>
    </ScreenBackground>
  );

  if (!settings?.signupOpen) {
    return frame(
      <>
        <FirstRunHeader title="Join Rooftap" lede="This server does not take new sign-ups. Ask someone in your home for an invite link." />
        <Button variant="outline" size="lg" className="h-12" onPress={() => router.replace('/login')}>
          Back to sign in
        </Button>
      </>,
    );
  }

  if (sentTo) {
    return frame(
      <>
        <FirstRunHeader title="Check your email" lede={`We sent a link to ${sentTo}. Open it to confirm your account, then sign in here.`} />
        <Button size="lg" className="h-12" onPress={() => router.replace('/login')}>
          Go to sign in
        </Button>
      </>,
    );
  }

  return frame(
    <>
      <FirstRunHeader title="Make an account" lede="Your own home comes with it. You can invite people, or join theirs with an invite link." />
      <View className="gap-2">
        <FieldGroup>
          <Input value={name} onChangeText={setName} placeholder="Your name" autoComplete="name" className={FieldGroup.input} />
          <Input
            value={identifier}
            onChangeText={setIdentifier}
            placeholder={settings.sendsEmail ? 'Email' : 'Email or username'}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            className={FieldGroup.input}
          />
          <Input value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry autoComplete="new-password" className={FieldGroup.input} />
        </FieldGroup>
        {error && <Text className="px-1 text-caption text-destructive">{error}</Text>}
      </View>
      <Button size="lg" className="h-12" onPress={handleSubmit} disabled={busy}>
        {busy ? 'Making your account...' : 'Make account'}
      </Button>
      <LegalLine links={legal} />
      <Button variant="ghost" size="lg" onPress={() => router.replace('/login')}>
        I have an account
      </Button>
    </>,
  );
}
