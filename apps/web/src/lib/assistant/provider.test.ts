import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { resolveAssistantBrain, resolveBackupBrain, resolveHouseholdBrain, resolveServerBrain } from "./provider";

const from = (values: Record<string, string>) => async (key: string) => values[key];

describe("resolveServerBrain", () => {
  it("is null with no keys", async () => {
    expect(await resolveServerBrain(from({}))).toBeNull();
  });

  it("picks the first configured provider, cheapest defaults first", async () => {
    const brain = await resolveServerBrain(from({ OPENAI_API_KEY: "sk", GEMINI_API_KEY: "g" }));
    expect(brain?.provider).toBe("gemini");
    expect(brain?.connection.baseURL).toContain("generativelanguage");
    expect(brain?.quickModel).toBe("gemini-3.1-flash-lite");
  });

  it("honours ASSISTANT_PROVIDER and model overrides, and ignores placeholders", async () => {
    const brain = await resolveServerBrain(
      from({ ASSISTANT_PROVIDER: "OpenAI", OPENAI_API_KEY: "sk", GEMINI_API_KEY: "g", ASSISTANT_MODEL: "gpt-x" })
    );
    expect(brain).toMatchObject({ provider: "openai", chatModel: "gpt-x", quickModel: "gpt-4o-mini" });
    expect(await resolveServerBrain(from({ GEMINI_API_KEY: "your-gemini-key" }))).toBeNull();
  });

  it("uses a local OpenAI-compatible server as free", async () => {
    const brain = await resolveServerBrain(
      from({ ASSISTANT_PROVIDER: "compatible", ASSISTANT_BASE_URL: "http://ollama:11434/v1", ASSISTANT_MODEL: "qwen3:14b" })
    );
    expect(brain).toMatchObject({ provider: "compatible", free: true, chatModel: "qwen3:14b", quickModel: "qwen3:14b" });
  });
});

describe("resolveBackupBrain", () => {
  it("is the next provider with a server key, for when the first is busy", async () => {
    const lookup = from({ OPENAI_API_KEY: "sk", GEMINI_API_KEY: "g" });
    const primary = (await resolveServerBrain(lookup))!;
    expect((await resolveBackupBrain(primary, lookup))?.provider).toBe("openai");
  });

  it("is none when the operator pinned a provider, or the household pays", async () => {
    const pinned = from({ ASSISTANT_PROVIDER: "gemini", OPENAI_API_KEY: "sk", GEMINI_API_KEY: "g" });
    expect(await resolveBackupBrain((await resolveServerBrain(pinned))!, pinned)).toBeNull();
    const household = resolveHouseholdBrain(new Map([["anthropic", "k"]]))!;
    expect(household.chatModel).toBe("claude-haiku-5-5");
    expect(await resolveBackupBrain(household, from({ OPENAI_API_KEY: "sk" }))).toBeNull();
  });
});

describe("resolveAssistantBrain", () => {
  const settings = (s: object) => JSON.stringify(s);
  const none = new Map<string, string>();

  it("falls back to the environment settings when nothing is picked", async () => {
    const brain = await resolveAssistantBrain({ lookup: from({ OPENAI_API_KEY: "sk" }), householdKeys: none });
    expect(brain).toMatchObject({ provider: "openai", chatModel: "gpt-4o-mini", keySource: "server" });
  });

  it("uses the operator's model for each job, on another provider when needed", async () => {
    const lookup = from({
      GEMINI_API_KEY: "g",
      ANTHROPIC_API_KEY: "a",
      AI_SETTINGS: settings({ defaults: { chat: "anthropic:claude-sonnet-4-6", quick: "gemini:gemini-2.5-flash-lite" } }),
    });
    const brain = (await resolveAssistantBrain({ lookup, householdKeys: none }))!;
    expect(brain).toMatchObject({ provider: "anthropic", chatModel: "claude-sonnet-4-6" });
    expect(brain.quickBrain).toMatchObject({ provider: "gemini", quickModel: "gemini-2.5-flash-lite" });
  });

  it("honours a household's pick only when the operator offers it", async () => {
    const lookup = from({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o", AI_SETTINGS: settings({ offered: ["openai:gpt-5.4-mini"] }) });
    const offered = await resolveAssistantBrain({ lookup, householdKeys: none, choice: { chat: "openai:gpt-5.4-mini", quick: null } });
    expect(offered).toMatchObject({ provider: "openai", chatModel: "gpt-5.4-mini" });
    const notOffered = await resolveAssistantBrain({ lookup, householdKeys: none, choice: { chat: "openai:gpt-4o-mini", quick: null } });
    expect(notOffered).toMatchObject({ provider: "gemini" });
  });

  it("lets a household pick any verified model on its own key, and pays with it", async () => {
    const brain = await resolveAssistantBrain({
      lookup: from({ GEMINI_API_KEY: "g", AI_SETTINGS: settings({ offered: [] }) }),
      householdKeys: new Map([["anthropic", "mine"]]),
      choice: { chat: "anthropic:claude-sonnet-4-6", quick: null },
    });
    expect(brain).toMatchObject({ provider: "anthropic", chatModel: "claude-sonnet-4-6", keySource: "household", quickModel: "claude-haiku-5-5" });
    expect(brain?.connection.apiKey).toBe("mine");
  });

  it("reaches a custom provider with its stored key, free unless priced", async () => {
    const lookup = from({
      AI_SETTINGS: settings({
        custom: [{ id: "custom-ollama", label: "Ollama", baseURL: "http://ollama:11434/v1" }],
        extraModels: [{ provider: "custom-ollama", id: "qwen3:14b" }],
        defaults: { chat: "custom-ollama:qwen3:14b", quick: "custom-ollama:qwen3:14b" },
      }),
    });
    const brain = await resolveAssistantBrain({ lookup, lookupOne: from({ AI_KEY_CUSTOM_OLLAMA: "local" }), householdKeys: none });
    expect(brain).toMatchObject({ provider: "custom-ollama", chatModel: "qwen3:14b", free: true });
    expect(brain?.connection).toEqual({ wire: "openai", baseURL: "http://ollama:11434/v1", apiKey: "local" });
    expect(brain?.quickBrain).toBeUndefined();
  });

  it("keeps an older bare model name as a model override", async () => {
    const brain = await resolveAssistantBrain({ lookup: from({ GEMINI_API_KEY: "g" }), householdKeys: none, choice: { chat: "gemini-2.5-flash", quick: null } });
    expect(brain).toMatchObject({ provider: "gemini", chatModel: "gemini-2.5-flash", quickModel: "gemini-3.1-flash-lite" });
  });
});
