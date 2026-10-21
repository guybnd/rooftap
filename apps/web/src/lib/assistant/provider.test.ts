import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { resolveBackupBrain, resolveHouseholdBrain, resolveServerBrain } from "./provider";

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
