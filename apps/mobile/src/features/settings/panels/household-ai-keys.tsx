// HOUP-436: Settings > Integrations & keys > AI keys. The household's own
// AI keys: with one, receipts, recipes, listings, events and the assistant
// run on it with no monthly limit and nothing charged to the server. Members
// see which providers have a key (last four characters only); owners add and
// remove them. Web twin: apps/web/src/components/household-ai-keys.tsx.
import * as React from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { Button, FieldRow, FormSection, Input, Text, toast } from '@homeup/ui';
import {
  AI_KEY_PROVIDER_META,
  AI_KEY_PROVIDERS,
  aiKeysUsageLine,
  useModules,
  type AiKeyProvider,
  type HouseholdAiKeysStatus,
} from '@homeup/core';
import { householdAiKeys, removeHouseholdAiKey, saveHouseholdAiKey } from '../ai-keys-api';
import { SettingsPanel } from './settings-panel';

export function HouseholdAiKeys() {
  const modules = useModules();
  const supported = modules.server('ai.household-keys');
  const [status, setStatus] = React.useState<HouseholdAiKeysStatus | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [drafts, setDrafts] = React.useState<Partial<Record<AiKeyProvider, string>>>({});
  const [busy, setBusy] = React.useState<AiKeyProvider | null>(null);
  const [rowError, setRowError] = React.useState<{ provider: AiKeyProvider; message: string } | null>(null);

  const load = React.useCallback(async () => {
    try {
      setStatus(await householdAiKeys());
    } catch {
      setFailed(true);
    }
  }, []);

  React.useEffect(() => {
    if (supported) void load();
  }, [supported, load]);

  const run = async (provider: AiKeyProvider, action: 'save' | 'remove') => {
    setBusy(provider);
    setRowError(null);
    try {
      if (action === 'save') await saveHouseholdAiKey(provider, drafts[provider] ?? '');
      else await removeHouseholdAiKey(provider);
      setDrafts((prev) => ({ ...prev, [provider]: '' }));
      toast.success(action === 'save' ? 'Key saved' : 'Key removed');
      await load();
    } catch (err) {
      setRowError({ provider, message: err instanceof Error ? err.message : 'Could not save that.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsPanel
      icon={Sparkles}
      title="AI keys"
      description="Your household's own AI keys. With one, AI reads and the assistant run on it, with no monthly limit."
    >
      {!supported ? (
        <Text className="text-sm text-muted-foreground">Update your server to use your household&apos;s own AI key.</Text>
      ) : failed ? (
        <Text className="text-sm text-muted-foreground">Couldn&apos;t load your AI keys. Check your connection and try again.</Text>
      ) : !status ? (
        <Text className="text-sm text-muted-foreground">Loading…</Text>
      ) : (
        <>
          <Text className="px-1 text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {aiKeysUsageLine(status)}
          </Text>
          <FormSection>
            {AI_KEY_PROVIDERS.map((provider) => {
              const meta = AI_KEY_PROVIDER_META[provider];
              const saved = status.keys.find((k) => k.provider === provider);
              const draft = drafts[provider]?.trim() ?? '';
              return (
                <FieldRow
                  key={provider}
                  label={meta.label}
                  hint={saved ? `Key ending ${saved.last4}` : 'No key'}
                  error={rowError?.provider === provider ? rowError.message : null}
                  action={
                    !status.isOwner ? undefined : saved ? (
                      <Button size="sm" variant="ghost" onPress={() => void run(provider, 'remove')} disabled={busy === provider}>
                        Remove
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onPress={() => void Linking.openURL(meta.keyUrl)}>
                        Get a key
                      </Button>
                    )
                  }
                >
                  {status.isOwner && status.canStore ? (
                    <View className="flex-row items-center gap-2">
                      <Input
                        className="flex-1"
                        value={drafts[provider] ?? ''}
                        onChangeText={(v) => setDrafts((prev) => ({ ...prev, [provider]: v }))}
                        placeholder={saved ? 'Replace key' : 'Paste key'}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                        editable={busy !== provider}
                      />
                      <Button
                        size="sm"
                        variant={draft ? 'default' : 'outline'}
                        onPress={() => void run(provider, 'save')}
                        disabled={busy === provider || !draft}
                      >
                        {busy === provider ? <ActivityIndicator size="small" /> : 'Save'}
                      </Button>
                    </View>
                  ) : null}
                </FieldRow>
              );
            })}
          </FormSection>
          {status.isOwner && !status.canStore && (
            <Text className="px-1 text-xs text-muted-foreground">This server isn&apos;t set up to store household keys yet.</Text>
          )}
          {!status.isOwner && <Text className="px-1 text-xs text-muted-foreground">A household owner can add or remove keys.</Text>}
        </>
      )}
    </SettingsPanel>
  );
}
