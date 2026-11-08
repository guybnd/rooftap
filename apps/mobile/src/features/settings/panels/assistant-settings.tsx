// HOUP-443: Settings > Assistant, three of its tabs (manifest settingsTabs).
// General: what the assistant may do in each module (Read, Ask first, Act;
// deletes always ask) and which models it uses. Helpers: who sees each
// helper's chat and the household's notes for it. Memories: the facts it
// keeps about the household. Owners change the first two; anyone in the home
// can see and edit memories. Budgets and usage live in assistant-spending.tsx
// (HOUP-444).
// Web twin: apps/web/src/components/assistant-settings.tsx.
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Bell, Brain, Cpu, ShieldCheck, Sparkles, Trash2 } from 'lucide-react-native';
import { Button, Input, SearchablePicker, SegmentedControl, Text, toast } from '@homeup/ui';
import {
  DEFAULT_TRUST,
  HELPER_INSTRUCTIONS_MAX,
  MODULE_HELPERS,
  TRUST_OPTIONS,
  helperAvailable,
  helperCanShare,
  parseHelperSettings,
  aiModelPickerOptions,
  shownModelPick,
  type AiModelChoices,
  assistantModules,
  useModules,
  type AssistantMemory,
  type AssistantNotifyPrefs,
  type AssistantSettings as Settings,
  type ModuleId,
  type TrustLevel,
} from '@homeup/core';
import { assistantApi } from '@/features/assistant/assistant-api';
import { SettingsInset, SettingsPanel, SettingsSwitchRow } from './settings-panel';

/** The household's assistant settings, shared by the General and Helpers tabs. Each tab loads its own copy. */
function useAssistantSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  // The server's model choices; missing on a server from before them, which keeps the free-text fields.
  const [choices, setChoices] = useState<AiModelChoices | null>(null);

  useEffect(() => {
    assistantApi
      .settings()
      .then((res) => {
        setSettings(res.settings);
        setIsOwner(res.isOwner);
        setChoices(res.models ?? null);
      })
      .catch(() => {});
  }, []);

  const save = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const before = settings;
    setSettings({ ...settings, ...patch, trust: { ...settings.trust, ...patch.trust } });
    try {
      setSettings((await assistantApi.saveSettings(patch)).settings);
    } catch (err) {
      setSettings(before);
      toast.error(err instanceof Error ? err.message : 'Could not save that.');
    }
  };

  return { settings, isOwner, choices, save };
}

/** General tab: what it may do, which models it uses, and your own reply pushes. */
export function AssistantSettings() {
  const modules = useModules();
  const { settings, isOwner, choices, save } = useAssistantSettings();
  // The free-text model fields while someone types; until then they show the saved models.
  const [typed, setTyped] = useState<{ chat: string; quick: string } | null>(null);
  const models = typed ?? { chat: settings?.chatModel ?? '', quick: settings?.quickModel ?? '' };

  const reachable = assistantModules(modules.enabled);

  return (
    <View className="gap-4">
      <SettingsPanel
        icon={ShieldCheck}
        title="What it may do"
        description={
          isOwner
            ? 'Read only looks things up. Ask first proposes each change for a tap. Act makes changes straight away. Deleting always asks.'
            : "Set by the household's owners. Deleting always asks."
        }
      >
        {settings && reachable.length > 0 ? (
          <SettingsInset>
            {reachable.map((m) => (
              <View key={m.id} className="gap-2 px-3.5 py-3">
                <Text className="text-sm font-medium text-foreground">{m.label}</Text>
                {m.readOnly ? (
                  <Text className="text-sm text-muted-foreground">Looks up only</Text>
                ) : (
                  <SegmentedControl<TrustLevel>
                    accessibilityLabel={`${m.label} access`}
                    value={settings.trust[m.id as ModuleId] ?? DEFAULT_TRUST}
                    options={TRUST_OPTIONS}
                    onChange={(level) => {
                      if (isOwner) void save({ trust: { [m.id]: level } });
                    }}
                  />
                )}
              </View>
            ))}
          </SettingsInset>
        ) : (
          <Text className="text-sm text-muted-foreground">Switch on a tile like Tasks, Calendar, Groceries or Recipes to give the assistant something to reach.</Text>
        )}
      </SettingsPanel>

      <SettingsPanel
        icon={Cpu}
        title="Models"
        description={
          choices
            ? "Pick from the models this server offers, or any model on your household's own AI key. Quick asks suit a cheaper model."
            : "Leave blank to use the server's default. Quick asks use the cheaper model."
        }
      >
        {settings && (
          <View className="gap-3">
            {choices ? (
              (['chat', 'quick'] as const).map((job) => {
                const field = job === 'chat' ? 'chatModel' : 'quickModel';
                const shown = shownModelPick(settings[field], choices[job]);
                const fallback = choices.defaults[job];
                const options = aiModelPickerOptions(choices[job], fallback ? `Server default (${fallback.label})` : 'Server default');
                if (shown.extra) options.push(shown.extra);
                return (
                  <View key={job} className="gap-1">
                    <Text className="px-1 text-xs text-muted-foreground">{job === 'chat' ? 'Chats and the household thread' : 'Quick asks'}</Text>
                    <SearchablePicker
                      ariaLabel={job === 'chat' ? 'Model for chats' : 'Model for quick asks'}
                      options={options}
                      value={shown.value}
                      disabled={!isOwner}
                      searchPlaceholder="Search models"
                      onChange={(ref) => void save({ [field]: ref || null })}
                    />
                  </View>
                );
              })
            ) : (
              <>
                <View className="gap-1">
                  <Text className="px-1 text-xs text-muted-foreground">Chats and the household thread</Text>
                  <Input
                    value={models.chat}
                    editable={isOwner}
                    placeholder="Server default"
                    autoCapitalize="none"
                    onChangeText={(chat) => setTyped({ ...models, chat })}
                    onEndEditing={() => {
                      if (models.chat.trim() !== (settings.chatModel ?? '')) void save({ chatModel: models.chat.trim() || null });
                    }}
                    className="h-11"
                  />
                </View>
                <View className="gap-1">
                  <Text className="px-1 text-xs text-muted-foreground">Quick asks</Text>
                  <Input
                    value={models.quick}
                    editable={isOwner}
                    placeholder="Server default"
                    autoCapitalize="none"
                    onChangeText={(quick) => setTyped({ ...models, quick })}
                    onEndEditing={() => {
                      if (models.quick.trim() !== (settings.quickModel ?? '')) void save({ quickModel: models.quick.trim() || null });
                    }}
                    className="h-11"
                  />
                </View>
              </>
            )}
            <SettingsInset>
              <SettingsSwitchRow
                title="Show cost under each reply"
                checked={settings.showCostPerReply}
                disabled={!isOwner}
                onChange={(showCostPerReply) => void save({ showCostPerReply })}
              />
            </SettingsInset>
          </View>
        )}
      </SettingsPanel>

      {modules.server('assistant.reply-notifications') && <ReplyNotifications />}
    </View>
  );
}

/** Memories tab: facts the assistant keeps about the home. Anyone in the home can add or remove them. */
export function AssistantMemories() {
  const [memories, setMemories] = useState<AssistantMemory[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    assistantApi.memories().then(setMemories).catch(() => {});
  }, []);

  const addMemory = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      const { memory } = await assistantApi.addMemory(text);
      setMemories((m) => [...m, memory]);
      setDraft('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that.');
    }
  };

  const removeMemory = async (id: string) => {
    const before = memories;
    setMemories((m) => m.filter((x) => x.id !== id));
    try {
      await assistantApi.removeMemory(id);
    } catch {
      setMemories(before);
      toast.error('Could not remove that.');
    }
  };

  return (
    <SettingsPanel icon={Brain} title="Memories" description="Facts the assistant keeps about your home. It adds its own as it learns; remove any you don't want.">
      {memories.length > 0 && (
        <SettingsInset>
          {memories.map((m) => (
            <View key={m.id} className="min-h-[48px] flex-row items-center gap-3 px-3.5 py-2">
              <View className="min-w-0 flex-1">
                <Text className="text-sm text-foreground">{m.text}</Text>
                {m.onlyYou && <Text className="text-xs text-muted-foreground">Only you</Text>}
              </View>
              {m.canRemove !== false && (
                <Pressable
                  onPress={() => void removeMemory(m.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove memory"
                  className="size-11 items-center justify-center rounded-lg"
                >
                  <Trash2 size={16} className="text-muted-foreground" />
                </Pressable>
              )}
            </View>
          ))}
        </SettingsInset>
      )}
      <View className="flex-row gap-2">
        <Input
          value={draft}
          maxLength={500}
          placeholder="e.g. Bins go out on Tuesday night"
          onChangeText={setDraft}
          onSubmitEditing={() => void addMemory()}
          className="h-11 flex-1"
        />
        <Button onPress={() => void addMemory()} disabled={!draft.trim()} className="h-11 px-3.5">
          <Text className="text-sm font-medium text-primary-foreground">Add</Text>
        </Button>
      </View>
    </SettingsPanel>
  );
}

type HelperShare = 'me' | 'home';
const SHARE_OPTIONS: { value: HelperShare; label: string }[] = [
  { value: 'me', label: 'Just me' },
  { value: 'home', label: 'Household' },
];

/**
 * Helpers tab (core module-helpers.ts): who sees each helper's chat, and the
 * household's own notes for it. Owners set both; notes only add to the
 * helper's rules, never replace them. A helper that can't be shared (Gifts)
 * always stays just you.
 */
export function AssistantHelpers() {
  const modules = useModules();
  const { settings, isOwner, save } = useAssistantSettings();
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!modules.server('assistant.shared-helpers')) return null;
  const helpers = MODULE_HELPERS.filter((h) => helperAvailable(h.id, (id) => modules.isEnabled(id)));
  if (!settings) return null;
  const stored = (id: string) => parseHelperSettings(settings.helpers[id]);
  const saveHelper = (id: string, patch: { shared?: boolean; instructions?: string }) =>
    save({ helpers: { ...settings.helpers, [id]: { ...stored(id), ...patch } } });
  return (
    <SettingsPanel
      icon={Sparkles}
      title="Helpers"
      description={
        isOwner
          ? 'Household gives everyone one chat with a helper, so anyone can chime in. Notes add to how a helper works and never change its privacy rules.'
          : "Set by the household's owners."
      }
    >
      {helpers.length === 0 ? (
        <Text className="text-sm text-muted-foreground">Switch on a tile like Groceries, Costs or Recipes to get its helper.</Text>
      ) : (
        <View className="gap-3">
          {helpers.map((h) => {
            const current = stored(h.id);
            const draft = notes[h.id] ?? current.instructions;
            const canShare = helperCanShare(h);
            return (
              <SettingsInset key={h.id}>
                <View className="gap-2.5 px-3.5 py-3">
                  <View>
                    <Text className="text-sm font-medium text-foreground">{h.label}</Text>
                    <Text className="text-xs text-muted-foreground">{canShare ? 'Who sees this chat' : 'Always just you'}</Text>
                  </View>
                  {canShare && (
                    <SegmentedControl<HelperShare>
                      accessibilityLabel={`Who sees the ${h.label} chat`}
                      value={current.shared ? 'home' : 'me'}
                      options={SHARE_OPTIONS}
                      onChange={(v) => {
                        if (isOwner) void saveHelper(h.id, { shared: v === 'home' });
                      }}
                    />
                  )}
                  <View className="gap-1">
                    <Input
                      value={draft}
                      editable={isOwner}
                      maxLength={HELPER_INSTRUCTIONS_MAX}
                      multiline
                      textAlignVertical="top"
                      accessibilityLabel={`Notes for the ${h.label}`}
                      placeholder={isOwner ? 'Notes, e.g. We shop at Aldi on Saturdays. No pork.' : 'No notes'}
                      onChangeText={(text) => setNotes((n) => ({ ...n, [h.id]: text }))}
                      onEndEditing={() => {
                        if (draft.trim() !== current.instructions) void saveHelper(h.id, { instructions: draft.trim() });
                      }}
                      className="h-auto min-h-[72px] py-2"
                    />
                    {isOwner && draft.length > HELPER_INSTRUCTIONS_MAX - 80 ? (
                      <Text className="px-1 text-[11px] tabular-nums text-muted-foreground">{HELPER_INSTRUCTIONS_MAX - draft.length} left</Text>
                    ) : null}
                  </View>
                </View>
              </SettingsInset>
            );
          })}
        </View>
      )}
    </SettingsPanel>
  );
}

/** Your own say over pushes for replies that land after you left (not the household's). */
function ReplyNotifications() {
  return (
    <SettingsPanel icon={Bell} title="When it answers after you leave" description="Just for you. Only sent if you weren't looking at the chat.">
      <ReplyNotificationRows />
    </SettingsPanel>
  );
}

/**
 * The two assistant_notify_prefs switches. Also shown in Settings > Notifications,
 * so every switch for a push lives in one place too.
 */
export function ReplyNotificationRows({ description }: { description?: string }) {
  const [prefs, setPrefs] = useState<AssistantNotifyPrefs | null>(null);
  useEffect(() => {
    assistantApi
      .notifyPrefs()
      .then((res) => setPrefs(res.prefs))
      .catch(() => {});
  }, []);

  const save = async (patch: Partial<AssistantNotifyPrefs>) => {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, ...patch });
    try {
      setPrefs((await assistantApi.saveNotifyPrefs(patch)).prefs);
    } catch (err) {
      setPrefs(before);
      toast.error(err instanceof Error ? err.message : 'Could not save that.');
    }
  };

  if (!prefs) return null;
  return (
    <SettingsInset>
      <SettingsSwitchRow title="Send a notification" description={description} checked={prefs.replies} onChange={(replies) => void save({ replies })} />
      <SettingsSwitchRow
        title="Include the answer"
        description={'Off shows only "Rooftap answered".'}
        checked={prefs.preview}
        disabled={!prefs.replies}
        onChange={(preview) => void save({ preview })}
      />
    </SettingsInset>
  );
}
