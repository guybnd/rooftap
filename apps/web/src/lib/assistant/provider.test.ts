import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { resolveServerBrain } from "./provider";

const from = (values: Record<string, string>) => async (key: string) => values[key];

describe("resolveServerBrain", () => {
  it("is null with no keys", async () => {
    expect(await resolveServerBrain(from({}))).toBeNull();
  });

  it("picks the first configured provider, cheapest defaults first", async () => {
    const brain = await resolveServerBrain(from({ OPENAI_API_KEY: "sk", GEMINI_API_KEY: "g" }));
    expect(brain?.provider).toBe("gemini");
    expect(brain?.connection.baseURL).toContain("generativelanguage");
    expect(brain?.quickModel).toBe("gemini-2.5-flash-lite");
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
