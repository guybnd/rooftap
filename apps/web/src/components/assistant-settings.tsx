"use client";

// HOUP-443: Settings > Assistant. What the assistant may do in each module
// (Read, Ask first, Act; deletes always ask), which models it uses, and the
// facts it keeps about the household. Owners change the first two; anyone in
// the home can see and edit memories. Budgets and usage live in
// assistant-spending.tsx (HOUP-444).
// Native twin: apps/mobile/src/features/settings/panels/assistant-settings.tsx.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Brain, Cpu, ShieldCheck, Trash2 } from "lucide-react";
import {
  DEFAULT_TRUST,
  TRUST_OPTIONS,
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
} from "@homeup/core";
import { assistantApi } from "@/lib/assistant-client";
import { Input } from "@/components/ui/input";
import { SearchablePicker } from "@/components/ui/searchable-picker";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsInset, SettingsPanel, SettingsSwitchRow } from "@/components/settings-panel";

export function AssistantSettings() {
  const modules = useModules();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [memories, setMemories] = useState<AssistantMemory[]>([]);
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState({ chat: "", quick: "" });
  // The server's model choices; missing on a server from before them, which keeps the free-text fields.
  const [choices, setChoices] = useState<AiModelChoices | null>(null);

  useEffect(() => {
    assistantApi
      .settings()
      .then((res) => {
        setSettings(res.settings);
        setIsOwner(res.isOwner);
        setModels({ chat: res.settings.chatModel ?? "", quick: res.settings.quickModel ?? "" });
        setChoices(res.models ?? null);
      })
      .catch(() => {});
    assistantApi.memories().then(setMemories).catch(() => {});
  }, []);

  const save = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const before = settings;
    setSettings({ ...settings, ...patch, trust: { ...settings.trust, ...patch.trust } });
    try {
      setSettings((await assistantApi.saveSettings(patch)).settings);
    } catch (err) {
      setSettings(before);
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    }
  };

  const addMemory = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      const { memory } = await assistantApi.addMemory(text);
      setMemories((m) => [...m, memory]);
      setDraft("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    }
  };

  const removeMemory = async (id: string) => {
    const before = memories;
    setMemories((m) => m.filter((x) => x.id !== id));
    try {
      await assistantApi.removeMemory(id);
    } catch {
      setMemories(before);
      toast.error("Could not remove that.");
    }
  };

  const reachable = assistantModules(modules.enabled);

  return (
    <div className="space-y-4">
      <SettingsPanel
        icon={ShieldCheck}
        title="What it may do"
        description={
          isOwner
            ? "Read only looks things up. Ask first proposes each change for a tap. Act makes changes straight away. Deleting always asks."
            : "Set by the household's owners. Deleting always asks."
        }
      >
        {settings && reachable.length > 0 ? (
          <SettingsInset>
            {reachable.map((m) => (
              <div key={m.id} className="flex min-h-[52px] items-center gap-3 px-3.5 py-2.5">
                <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{m.label}</p>
                <SegmentedControl<TrustLevel>
                  ariaLabel={`${m.label} access`}
                  size="sm"
                  value={settings.trust[m.id as ModuleId] ?? DEFAULT_TRUST}
                  options={TRUST_OPTIONS}
                  onChange={(level) => isOwner && void save({ trust: { [m.id]: level } })}
                />
              </div>
            ))}
          </SettingsInset>
        ) : (
          <p className="text-sm text-muted-foreground">Switch on a module like Tasks, Calendar, Groceries or Recipes to give the assistant something to reach.</p>
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
          <div className="space-y-3">
            {choices ? (
              (["chat", "quick"] as const).map((job) => {
                const field = job === "chat" ? "chatModel" : "quickModel";
                const shown = shownModelPick(settings[field], choices[job]);
                const fallback = choices.defaults[job];
                const options = aiModelPickerOptions(choices[job], fallback ? `Server default (${fallback.label})` : "Server default");
                if (shown.extra) options.push(shown.extra);
                return (
                  <label key={job} className="block space-y-1">
                    <span className="px-1 text-xs text-muted-foreground">{job === "chat" ? "Chats and the household thread" : "Quick asks"}</span>
                    <SearchablePicker
                      ariaLabel={job === "chat" ? "Model for chats" : "Model for quick asks"}
                      options={options}
                      value={shown.value}
                      disabled={!isOwner}
                      searchPlaceholder="Search models"
                      onChange={(ref) => void save({ [field]: ref || null })}
                    />
                  </label>
                );
              })
            ) : (
              <>
                <label className="block space-y-1">
                  <span className="px-1 text-xs text-muted-foreground">Chats and the household thread</span>
                  <Input
                    value={models.chat}
                    disabled={!isOwner}
                    placeholder="Server default"
                    onChange={(e) => setModels((m) => ({ ...m, chat: e.target.value }))}
                    onBlur={() => models.chat.trim() !== (settings.chatModel ?? "") && void save({ chatModel: models.chat.trim() || null })}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="px-1 text-xs text-muted-foreground">Quick asks</span>
                  <Input
                    value={models.quick}
                    disabled={!isOwner}
                    placeholder="Server default"
                    onChange={(e) => setModels((m) => ({ ...m, quick: e.target.value }))}
                    onBlur={() => models.quick.trim() !== (settings.quickModel ?? "") && void save({ quickModel: models.quick.trim() || null })}
                  />
                </label>
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
          </div>
        )}
      </SettingsPanel>

      {modules.server("assistant.reply-notifications") && <ReplyNotifications />}

      <SettingsPanel icon={Brain} title="Memories" description="Facts the assistant keeps about your home. It adds its own as it learns; remove any you don't want.">
        {memories.length > 0 && (
          <SettingsInset>
            {memories.map((m) => (
              <div key={m.id} className="flex min-h-[48px] items-center gap-3 px-3.5 py-2">
                <p className="min-w-0 flex-1 text-sm text-foreground">{m.text}</p>
                <button
                  type="button"
                  aria-label="Remove memory"
                  onClick={() => void removeMemory(m.id)}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </SettingsInset>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addMemory();
          }}
        >
          <Input value={draft} maxLength={500} placeholder="e.g. Bins go out on Tuesday night" onChange={(e) => setDraft(e.target.value)} />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="inline-flex h-10 shrink-0 items-center rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-40"
          >
            Add
          </button>
        </form>
      </SettingsPanel>
    </div>
  );
}

/** Your own say over pushes for replies that land after you left (not the household's). */
function ReplyNotifications() {
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
      toast.error(err instanceof Error ? err.message : "Could not save that.");
    }
  };

  return (
    <SettingsPanel icon={Bell} title="When it answers after you leave" description="Just for you. Only sent if you weren't looking at the chat.">
      {prefs && (
        <SettingsInset>
          <SettingsSwitchRow title="Send a notification" checked={prefs.replies} onChange={(replies) => void save({ replies })} />
          <SettingsSwitchRow
            title="Include the answer"
            description={'Off shows only "Rooftap answered".'}
            checked={prefs.preview}
            disabled={!prefs.replies}
            onChange={(preview) => void save({ preview })}
          />
        </SettingsInset>
      )}
    </SettingsPanel>
  );
}
