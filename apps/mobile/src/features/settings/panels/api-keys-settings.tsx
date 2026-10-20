// HOUP-84/HOUP-125: native port of apps/web's api-keys-settings.tsx.
//
// Web's panel is owner-only key management for the household's server: a
// GET/PUT against /api/admin/keys (+ /api/admin/keys/test) that stores each
// key server-side. There is no OAuth *popup* in this panel — despite the
// name, GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are just two more paste-in
// fields, tested as a pair via testGoogleOAuthPair(). (A real Google OAuth
// popup consent flow exists elsewhere, in calendar-setup.tsx, and is out of
// scope here.) So expo-web-browser/expo-auth-session — both already apps/mobile
// dependencies — aren't actually needed by this port; there's no interactive
// OAuth redirect to drive.
//
// HOUP-84 originally deferred list/save to the web app because
// /api/admin/keys's requireOwner() gate only accepted a cookie session, which
// native has no jar for. HOUP-100/HOUP-125 extended getSessionUser()
// (apps/web/src/lib/supabase/session.ts) to also accept an
// `Authorization: Bearer <access_token>` header, so this panel now sends the
// Supabase access token the same way pat-settings.tsx and users-manager.tsx
// do and drives GET (list status) + PUT (save) for real. There is still no
// delete/clear endpoint for admin keys on either platform — web's own panel
// doesn't offer one either, so this port doesn't either.
//
// KEY_VALIDATORS and testGoogleOAuthPair (@homeup/core) are plain fetches
// straight to each provider's API, no Rooftap backend involved — "paste a
// key, test it" works identically on native. NEXT_PUBLIC_VAPID_PUBLIC_KEY is
// intentionally excluded from the test list: its validator decodes with
// Node's `Buffer`, which isn't polyfilled in this RN runtime, and the key it
// validates (web push identification) has no native counterpart anyway.
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { KeyRound } from 'lucide-react-native';
import { Text, Button, FieldRow, FormSection, Input, cn } from '@homeup/ui';
import { KEY_VALIDATORS, testGoogleOAuthPair, type TestResult } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getStoredServer } from '@/lib/server-config';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { SettingsPanel } from './settings-panel';

interface KeyRow {
  key: string;
  label: string;
  purpose: string;
}

interface KeyStatus {
  key: string;
  isSet: boolean;
}

async function adminKeysRequest(method: 'GET' | 'PUT', body?: Record<string, unknown>): Promise<Response> {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');
  const supabase = getCurrentSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in.');
  return fetch(`${server.origin}/api/admin/keys`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

// Mirrors apps/web/src/lib/admin-keys.ts's RUNTIME_KEYS (that file lives in
// apps/web, not @homeup/core, so it can't be imported here — the labels are
// duplicated, the actual validators are shared via KEY_VALIDATORS).
const KEY_ROWS: KeyRow[] = [
  { key: 'OPENAI_API_KEY', label: 'OpenAI API key', purpose: 'Parses listings, receipts, and recipes from photos or pasted text (default parsing provider).' },
  { key: 'GEMINI_API_KEY', label: 'Gemini API key', purpose: 'Parses recipes from photos (default provider for recipes).' },
  { key: 'OPENROUTER_API_KEY', label: 'OpenRouter API key', purpose: 'Alternate parsing provider for listings, receipts, and recipes.' },
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', purpose: 'Alternate parsing provider for listings, receipts, and recipes.' },
  { key: 'SCRAPER_API_KEY', label: 'ScraperAPI key', purpose: 'Fetches listing pages that block direct requests.' },
];

// Build-time keys are inlined at `next build` and rejected by the PUT route
// (BUILD_TIME_KEY_NAMES), so this row is test-and-view only, never savable.
// VAPID is deliberately omitted — see file header.
const MAPBOX_ROW: KeyRow = {
  key: 'NEXT_PUBLIC_MAPBOX_TOKEN',
  label: 'Mapbox token',
  purpose: 'Renders maps in listings, itineraries, and the setup checklist.',
};

type Tone = 'success' | 'warning' | 'destructive' | 'muted';

// H2: status is a small dot + word, never a tinted chip.
function StatusWord({ tone, label }: { tone: Tone; label: string }) {
  const text = cn(
    'text-xs font-medium',
    tone === 'success' && 'text-success',
    tone === 'warning' && 'text-warning',
    tone === 'destructive' && 'text-destructive',
    tone === 'muted' && 'text-muted-foreground'
  );
  return (
    <View className="shrink-0 flex-row items-center gap-1.5">
      {tone !== 'muted' && (
        <View
          className={cn(
            'size-1.5 rounded-full',
            tone === 'success' && 'bg-success',
            tone === 'warning' && 'bg-warning',
            tone === 'destructive' && 'bg-destructive'
          )}
        />
      )}
      <Text className={text}>{label}</Text>
    </View>
  );
}

const RESULT_TONE: Record<Exclude<TestResult['status'], 'unsupported'>, Tone> = {
  valid: 'success',
  invalid: 'destructive',
  'no-credit': 'warning',
  unreachable: 'warning',
};
const RESULT_LABEL: Record<Exclude<TestResult['status'], 'unsupported'>, string> = {
  valid: 'Valid',
  invalid: 'Invalid',
  'no-credit': 'No credit',
  unreachable: 'Unreachable',
};

// Falls back to the server's stored isSet status until a test is run in this
// session — mirrors apps/web's ResultChip (StatusWord-or-TestResult).
function ResultChip({ result, isSet }: { result: TestResult | undefined; isSet: boolean }) {
  if (!result || result.status === 'unsupported') {
    return isSet ? <StatusWord tone="success" label="Set" /> : <StatusWord tone="muted" label="Not set" />;
  }
  return <StatusWord tone={RESULT_TONE[result.status]} label={RESULT_LABEL[result.status]} />;
}

export function ApiKeysSettings() {
  // HOUP-242: operator status is server-env-only (SERVER_OPERATOR_EMAILS),
  // so it can't be derived client-side — isGroupOwner used to gate this
  // panel, but a group owner is no longer guaranteed to be a server
  // operator. Instead treat a 403 from the GET this panel already performs
  // as "not an operator" (null = not yet known).
  const { isOnline } = useDataCache();
  const [isOperator, setIsOperator] = React.useState<boolean | null>(null);
  const [keys, setKeys] = React.useState<KeyStatus[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [results, setResults] = React.useState<Record<string, TestResult>>({});
  const [testingKey, setTestingKey] = React.useState<string | null>(null);
  const [savingKey, setSavingKey] = React.useState<string | null>(null);

  const loadKeys = React.useCallback(async () => {
    try {
      const res = await adminKeysRequest('GET');
      if (res.status === 403) {
        setIsOperator(false);
        return;
      }
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setIsOperator(true);
      const data = await res.json();
      setKeys(data.keys);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load key status.');
    }
  }, []);

  React.useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const setDraft = React.useCallback((key: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isSetFor = React.useCallback((key: string) => keys?.find((k) => k.key === key)?.isSet ?? false, [keys]);

  const saveKey = React.useCallback(
    async (key: string) => {
      const value = drafts[key]?.trim();
      if (!value) return;
      setFieldErrors((prev) => ({ ...prev, [key]: '' }));
      setSavingKey(key);
      try {
        const res = await adminKeysRequest('PUT', { key, value });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `Server responded ${res.status}`);
        setDrafts((prev) => ({ ...prev, [key]: '' }));
        await loadKeys();
      } catch (err) {
        setFieldErrors((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : 'Could not save key.' }));
      } finally {
        setSavingKey(null);
      }
    },
    [drafts, loadKeys]
  );

  const testKey = React.useCallback(async (key: string) => {
    const value = drafts[key]?.trim();
    const validator = KEY_VALIDATORS[key];
    if (!value || !validator) return;
    setTestingKey(key);
    try {
      const result = await validator(value);
      setResults((prev) => ({ ...prev, [key]: result }));
    } catch {
      setResults((prev) => ({ ...prev, [key]: { status: 'unreachable' } }));
    } finally {
      setTestingKey(null);
    }
  }, [drafts]);

  const testGooglePair = React.useCallback(async () => {
    const clientId = drafts.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = drafts.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return;
    setTestingKey('GOOGLE_CLIENT_ID');
    try {
      const result = await testGoogleOAuthPair(clientId, clientSecret);
      setResults((prev) => ({ ...prev, GOOGLE_CLIENT_ID: result }));
    } catch {
      setResults((prev) => ({ ...prev, GOOGLE_CLIENT_ID: { status: 'unreachable' } }));
    } finally {
      setTestingKey(null);
    }
  }, [drafts]);

  if (isOperator === false) return null;

  return (
    <SettingsPanel
      icon={KeyRound}
      title="API keys"
      description="Third-party keys this household's server uses. A saved key works from the next request, no restart needed."
    >
      {loadError && <Text className="px-1 text-caption text-destructive">{loadError}</Text>}
      {!isOnline && (
        <Text className="px-1 text-caption text-muted-foreground">You&apos;re offline. Reconnect to test or save keys.</Text>
      )}

      <FormSection>
        {KEY_ROWS.map((row) => (
          <FieldRow
            key={row.key}
            label={row.label}
            hint={row.purpose}
            error={fieldErrors[row.key] || null}
            action={<ResultChip result={results[row.key]} isSet={isSetFor(row.key)} />}
          >
            <View className="flex-row items-center gap-2">
              <Input
                className="flex-1"
                value={drafts[row.key] ?? ''}
                onChangeText={(v) => setDraft(row.key, v)}
                placeholder="New value"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={testingKey !== row.key && savingKey !== row.key}
              />
              <Button
                size="sm"
                variant="ghost"
                onPress={() => testKey(row.key)}
                disabled={!isOnline || testingKey === row.key || savingKey === row.key || !drafts[row.key]?.trim()}
              >
                {testingKey === row.key ? <ActivityIndicator size="small" /> : 'Test'}
              </Button>
              <Button
                size="sm"
                variant={drafts[row.key]?.trim() ? 'default' : 'outline'}
                onPress={() => saveKey(row.key)}
                disabled={!isOnline || savingKey === row.key || testingKey === row.key || !drafts[row.key]?.trim()}
              >
                {savingKey === row.key ? <ActivityIndicator size="small" /> : 'Save'}
              </Button>
            </View>
          </FieldRow>
        ))}
      </FormSection>

      <FormSection title="Google Calendar">
        <FieldRow
          label="Client ID + secret"
          hint="Refreshes access tokens for connected Google Calendars."
          error={fieldErrors.GOOGLE_CLIENT_ID || fieldErrors.GOOGLE_CLIENT_SECRET || null}
          action={<ResultChip result={results.GOOGLE_CLIENT_ID} isSet={isSetFor('GOOGLE_CLIENT_ID')} />}
        >
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <Input
                className="flex-1"
                value={drafts.GOOGLE_CLIENT_ID ?? ''}
                onChangeText={(v) => setDraft('GOOGLE_CLIENT_ID', v)}
                placeholder="Client ID"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={testingKey !== 'GOOGLE_CLIENT_ID' && savingKey !== 'GOOGLE_CLIENT_ID'}
              />
              <Button
                size="sm"
                variant={drafts.GOOGLE_CLIENT_ID?.trim() ? 'default' : 'outline'}
                onPress={() => saveKey('GOOGLE_CLIENT_ID')}
                disabled={!isOnline || savingKey === 'GOOGLE_CLIENT_ID' || !drafts.GOOGLE_CLIENT_ID?.trim()}
              >
                {savingKey === 'GOOGLE_CLIENT_ID' ? <ActivityIndicator size="small" /> : 'Save'}
              </Button>
            </View>
            <View className="flex-row items-center gap-2">
              <Input
                className="flex-1"
                value={drafts.GOOGLE_CLIENT_SECRET ?? ''}
                onChangeText={(v) => setDraft('GOOGLE_CLIENT_SECRET', v)}
                placeholder="Client secret"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={testingKey !== 'GOOGLE_CLIENT_ID' && savingKey !== 'GOOGLE_CLIENT_SECRET'}
              />
              <Button
                size="sm"
                variant={drafts.GOOGLE_CLIENT_SECRET?.trim() ? 'default' : 'outline'}
                onPress={() => saveKey('GOOGLE_CLIENT_SECRET')}
                disabled={!isOnline || savingKey === 'GOOGLE_CLIENT_SECRET' || !drafts.GOOGLE_CLIENT_SECRET?.trim()}
              >
                {savingKey === 'GOOGLE_CLIENT_SECRET' ? <ActivityIndicator size="small" /> : 'Save'}
              </Button>
            </View>
            <Button
              size="sm"
              variant="ghost"
              onPress={testGooglePair}
              className="self-start"
              disabled={
                !isOnline ||
                testingKey === 'GOOGLE_CLIENT_ID' ||
                !drafts.GOOGLE_CLIENT_ID?.trim() ||
                !drafts.GOOGLE_CLIENT_SECRET?.trim()
              }
            >
              {testingKey === 'GOOGLE_CLIENT_ID' ? <ActivityIndicator size="small" /> : 'Test pair'}
            </Button>
          </View>
        </FieldRow>
      </FormSection>

      <FormSection title="Build-time keys">
        <FieldRow
          label={MAPBOX_ROW.label}
          hint={MAPBOX_ROW.purpose}
          action={<ResultChip result={results[MAPBOX_ROW.key]} isSet={isSetFor(MAPBOX_ROW.key)} />}
        >
          <View className="flex-row items-center gap-2">
            <Input
              className="flex-1"
              value={drafts[MAPBOX_ROW.key] ?? ''}
              onChangeText={(v) => setDraft(MAPBOX_ROW.key, v)}
              placeholder="Paste a key to test"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              editable={testingKey !== MAPBOX_ROW.key}
            />
            <Button
              size="sm"
              variant="ghost"
              onPress={() => testKey(MAPBOX_ROW.key)}
              disabled={!isOnline || testingKey === MAPBOX_ROW.key || !drafts[MAPBOX_ROW.key]?.trim()}
            >
              {testingKey === MAPBOX_ROW.key ? <ActivityIndicator size="small" /> : 'Test'}
            </Button>
          </View>
        </FieldRow>
      </FormSection>
      <Text className="-mt-2 px-1 text-caption text-muted-foreground">
        Baked into the app when it&apos;s built, so changing one needs a rebuild. Testing here doesn&apos;t save it.
      </Text>
    </SettingsPanel>
  );
}
