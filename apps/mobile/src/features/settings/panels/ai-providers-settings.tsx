// Settings > Integrations & keys > AI providers (server operators only): the
// server's AI keys, custom providers (anything that speaks OpenAI's chat
// API), the model for each job, and which models households may pick. The
// rules live in core ai-providers.ts; this panel only edits the settings.
// Web twin: apps/web/src/components/ai-providers-settings.tsx.
import * as React from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { Cpu, Plus, Trash2 } from 'lucide-react-native';
import { Button, Input, SearchablePicker, Switch, Text, toast } from '@homeup/ui';
import {
  AI_FEATURES,
  aiModelPickerOptions,
  aiModelPriceLine,
  modelsForFeature,
  splitModelIds,
  withCustomProvider,
  withCustomProviderStream,
  withDefault,
  withExtraModel,
  withOfferedAll,
  withOfferedToggled,
  withoutCustomProvider,
  withoutExtraModel,
  type AiProvidersStatus,
  type AiServerSettings,
} from '@homeup/core';
import { aiProviders, saveAiProviders } from '../ai-keys-api';
import { SettingsCheckbox, SettingsChoiceRow, SettingsInset, SettingsLabel, SettingsPanel } from './settings-panel';

function StatusWord({ isSet }: { isSet: boolean }) {
  return (
    <View className="shrink-0 flex-row items-center gap-1.5">
      {isSet && <View className="size-1.5 rounded-full bg-success" />}
      <Text className={isSet ? 'text-xs font-medium text-success' : 'text-xs font-medium text-muted-foreground'}>{isSet ? 'Key set' : 'No key'}</Text>
    </View>
  );
}

function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} className="size-9 items-center justify-center rounded-lg">
      <Trash2 size={16} className="text-muted-foreground" />
    </Pressable>
  );
}

export function AiProvidersSettings() {
  const [status, setStatus] = React.useState<AiProvidersStatus | null>(null);
  const [hidden, setHidden] = React.useState(false);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [custom, setCustom] = React.useState({ label: '', baseURL: '', key: '', models: '' });
  const [extra, setExtra] = React.useState<{ provider: string; id: string }>({ provider: '', id: '' });

  React.useEffect(() => {
    aiProviders()
      .then(setStatus)
      .catch((err: { status?: number }) => {
        // 403: not an operator. 404: a server from before this panel.
        if (err.status === 403 || err.status === 404) setHidden(true);
      });
  }, []);

  const saveSettings = React.useCallback(
    async (next: AiServerSettings, what = 'settings') => {
      if (!status) return;
      const before = status;
      setStatus({ ...status, settings: next });
      setBusy(what);
      try {
        setStatus(await saveAiProviders({ settings: next }));
      } catch (err) {
        setStatus(before);
        toast.error(err instanceof Error ? err.message : 'Could not save that.');
      } finally {
        setBusy(null);
      }
    },
    [status]
  );

  const saveKey = React.useCallback(async (provider: string, value: string) => {
    setBusy(`key:${provider}`);
    try {
      setStatus(await saveAiProviders({ key: { provider, value } }));
      setDrafts((d) => ({ ...d, [provider]: '' }));
      toast.success('Key saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Key not saved');
    } finally {
      setBusy(null);
    }
  }, []);

  const keyed = React.useMemo(() => new Set(status?.providers.filter((p) => p.isSet || !p.builtIn).map((p) => p.id) ?? []), [status]);
  const ready = React.useMemo(() => status?.models.filter((m) => keyed.has(m.provider)) ?? [], [status, keyed]);

  if (hidden || !status) return null;
  const { settings } = status;

  const addCustom = async () => {
    const models = splitModelIds(custom.models);
    if (!custom.label.trim() || !/^https?:\/\//i.test(custom.baseURL.trim()) || models.length === 0) {
      toast.error('Add a name, an address starting with http, and at least one model.');
      return;
    }
    const next = withCustomProvider(settings, custom.label, custom.baseURL, models);
    const id = next.custom[next.custom.length - 1].id;
    await saveSettings(next, 'custom');
    if (custom.key.trim()) await saveKey(id, custom.key.trim());
    setCustom({ label: '', baseURL: '', key: '', models: '' });
    setAdding(false);
  };

  return (
    <SettingsPanel
      icon={Cpu}
      title="AI providers"
      description="The AI services this server uses, the model for each job, and the models households can choose. Keys work from the next request."
    >
      <View className="gap-2">
        <SettingsLabel>Providers</SettingsLabel>
        <SettingsInset>
          {status.providers.map((p) => (
            <View key={p.id} className="gap-2 px-3.5 py-3">
              <View className="flex-row items-center justify-between gap-2">
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-medium text-foreground">{p.label}</Text>
                  {p.builtIn && p.keyUrl ? (
                    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(p.keyUrl!)}>
                      <Text className="text-xs text-muted-foreground underline">Get a key</Text>
                    </Pressable>
                  ) : (
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {p.baseURL}
                    </Text>
                  )}
                </View>
                <StatusWord isSet={p.isSet} />
                {!p.builtIn && <RemoveButton label={`Remove ${p.label}`} onPress={() => void saveSettings(withoutCustomProvider(settings, p.id))} />}
              </View>
              <View className="flex-row items-center gap-2">
                <Input
                  className="h-11 flex-1"
                  value={drafts[p.id] ?? ''}
                  onChangeText={(v) => setDrafts((d) => ({ ...d, [p.id]: v }))}
                  placeholder={p.builtIn ? 'Paste a new key' : 'Key, if the server needs one'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  editable={busy !== `key:${p.id}`}
                />
                <Button
                  size="sm"
                  variant={drafts[p.id]?.trim() ? 'default' : 'outline'}
                  disabled={busy === `key:${p.id}` || !drafts[p.id]?.trim()}
                  onPress={() => void saveKey(p.id, drafts[p.id].trim())}
                >
                  {busy === `key:${p.id}` ? <ActivityIndicator size="small" /> : 'Save'}
                </Button>
              </View>
              {!p.builtIn && (
                <View className="min-h-11 flex-row items-center justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm text-foreground">Stream replies</Text>
                    <Text className="text-xs text-muted-foreground">Show answers as they're written. Turn off if this server can't stream.</Text>
                  </View>
                  <Switch
                    label={`Stream replies from ${p.label}`}
                    checked={settings.custom.find((c) => c.id === p.id)?.stream !== false}
                    disabled={busy === 'settings'}
                    onChange={(on) => void saveSettings(withCustomProviderStream(settings, p.id, on))}
                  />
                </View>
              )}
            </View>
          ))}
        </SettingsInset>

        {adding ? (
          <SettingsInset className="gap-2 p-3.5">
            <Text className="text-sm font-medium text-foreground">Custom provider</Text>
            <Text className="text-xs text-muted-foreground">Any server that speaks OpenAI&apos;s chat API, such as Ollama, LM Studio or a company gateway.</Text>
            <Input className="h-11" placeholder="Name, e.g. Home Ollama" value={custom.label} onChangeText={(label) => setCustom((c) => ({ ...c, label }))} />
            <Input
              className="h-11"
              placeholder="Address, e.g. http://ollama:11434/v1"
              autoCapitalize="none"
              autoCorrect={false}
              value={custom.baseURL}
              onChangeText={(baseURL) => setCustom((c) => ({ ...c, baseURL }))}
            />
            <Input
              className="h-11"
              placeholder="Key (optional)"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              value={custom.key}
              onChangeText={(key) => setCustom((c) => ({ ...c, key }))}
            />
            <Input
              className="h-11"
              placeholder="Models, e.g. qwen3:14b, llama3.1:8b"
              autoCapitalize="none"
              autoCorrect={false}
              value={custom.models}
              onChangeText={(models) => setCustom((c) => ({ ...c, models }))}
            />
            <View className="flex-row justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onPress={() => setAdding(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={busy === 'custom'} onPress={() => void addCustom()}>
                Add provider
              </Button>
            </View>
          </SettingsInset>
        ) : (
          <Button variant="ghost" size="sm" className="self-start" onPress={() => setAdding(true)}>
            <View className="flex-row items-center gap-1.5">
              <Plus size={16} className="text-foreground" />
              <Text className="text-sm font-medium text-foreground">Add a custom provider</Text>
            </View>
          </Button>
        )}
      </View>

      <View className="gap-2">
        <SettingsLabel>Model for each job</SettingsLabel>
        <SettingsInset>
          {AI_FEATURES.map((f) => (
            <View key={f.id} className="gap-1.5 px-3.5 py-3">
              <Text className="text-sm font-medium text-foreground">{f.label}</Text>
              <Text className="text-xs text-muted-foreground">{f.hint}</Text>
              <SearchablePicker
                ariaLabel={f.label}
                options={aiModelPickerOptions(modelsForFeature(ready, f.id), 'Automatic: the first provider with a key')}
                value={settings.defaults[f.id] ?? ''}
                onChange={(ref) => void saveSettings(withDefault(settings, f.id, ref))}
                searchPlaceholder="Search models"
              />
            </View>
          ))}
        </SettingsInset>
      </View>

      <View className="gap-2">
        <SettingsLabel>What households can choose</SettingsLabel>
        <SettingsInset role="radiogroup">
          <SettingsChoiceRow
            selected={settings.offered === null}
            onSelect={() => settings.offered !== null && void saveSettings(withOfferedAll(settings, true, ready))}
            title="Every model this server has a key for"
            description={`${ready.length} ${ready.length === 1 ? 'model' : 'models'} right now, and new ones as you add keys.`}
          />
          <SettingsChoiceRow
            selected={settings.offered !== null}
            onSelect={() => settings.offered === null && void saveSettings(withOfferedAll(settings, false, ready))}
            title="Only the models I tick"
            description="Pick them from the list below."
          />
        </SettingsInset>
        {settings.offered !== null && (
          <SettingsInset>
            {ready.length === 0 ? <Text className="px-3.5 py-3 text-xs text-muted-foreground">Add a key above to see its models.</Text> : null}
            {ready.map((m) => (
              <View key={m.ref} className="flex-row items-center">
                <View className="flex-1">
                  <SettingsCheckbox checked={settings.offered!.includes(m.ref)} onChange={() => void saveSettings(withOfferedToggled(settings, m.ref))}>
                    <Text className="text-sm font-medium text-foreground">{m.label}</Text>
                    <Text className="text-xs text-muted-foreground">
                      {m.providerLabel} · {aiModelPriceLine(m)}
                    </Text>
                  </SettingsCheckbox>
                </View>
                {!m.verified && <RemoveButton label={`Remove ${m.label}`} onPress={() => void saveSettings(withoutExtraModel(settings, m.ref))} />}
              </View>
            ))}
          </SettingsInset>
        )}
        <Text className="px-1 text-xs text-muted-foreground">
          A household with its own key for a provider can always pick that provider&apos;s verified models.
        </Text>
        <SettingsLabel className="pt-2">Add a model by name</SettingsLabel>
        <SearchablePicker
          ariaLabel="Provider for the new model"
          placeholder="Provider for a new model"
          options={status.providers.map((p) => ({ value: p.id, primary: p.label }))}
          value={extra.provider || null}
          onChange={(provider) => setExtra((x) => ({ ...x, provider }))}
        />
        <View className="flex-row items-center gap-2">
          <Input
            className="h-11 flex-1"
            placeholder="Model id"
            autoCapitalize="none"
            autoCorrect={false}
            value={extra.id}
            onChangeText={(id) => setExtra((x) => ({ ...x, id: id.trim() }))}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!extra.provider || !extra.id}
            onPress={() => {
              void saveSettings(withExtraModel(settings, extra.provider, extra.id));
              setExtra({ provider: extra.provider, id: '' });
            }}
          >
            Add model
          </Button>
        </View>
        <Text className="px-1 text-xs text-muted-foreground">
          Models you add aren&apos;t verified by Rooftap: tool calling may not work, and their spend counts at a cautious estimate unless priced in
          ASSISTANT_MODEL_PRICES.
        </Text>
      </View>
    </SettingsPanel>
  );
}
