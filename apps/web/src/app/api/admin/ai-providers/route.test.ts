import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanAiServerSettings } from "@homeup/core";

const store = new Map<string, string>();
const { gate } = vi.hoisted(() => ({ gate: vi.fn() }));

vi.mock("@/lib/admin-auth", () => ({ requireServerOperator: gate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/admin-config", () => ({
  getAdminConfigValue: async (k: string) => store.get(k),
  setAdminConfigValue: async (k: string, v: string) => void store.set(k, v),
  resolveServerKey: async (k: string) => store.get(k),
  resolveServerKeys: async () => async (k: string) => store.get(k),
  loadAiServerSettings: async () => cleanAiServerSettings(store.get("AI_SETTINGS")),
}));

function put(body: unknown): Request {
  return new Request("https://example.com/api/admin/ai-providers", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  store.clear();
  gate.mockReset();
  gate.mockResolvedValue({ user: { id: "u1" }, admin: {} });
});

describe("/api/admin/ai-providers", () => {
  it("is for server operators only", async () => {
    const denied = Response.json({ error: "Forbidden" }, { status: 403 });
    gate.mockResolvedValue({ error: denied });
    const { GET, PUT } = await import("./route");
    expect(await GET()).toBe(denied);
    expect(await PUT(put({ key: { provider: "openai", value: "sk-x" } }))).toBe(denied);
    expect(store.size).toBe(0);
  });

  it("shows which providers have a key, ignoring placeholders", async () => {
    store.set("GEMINI_API_KEY", "g-key");
    store.set("OPENAI_API_KEY", "your-openai-key");
    const { GET } = await import("./route");
    const json = await (await GET()).json();
    const set = Object.fromEntries(json.providers.map((p: { id: string; isSet: boolean }) => [p.id, p.isSet]));
    expect(set).toMatchObject({ gemini: true, openai: false });
  });

  it("saves settings, a custom provider's key, and drops that key with the provider", async () => {
    const { PUT } = await import("./route");
    const custom = [{ id: "custom-ollama", label: "Ollama", baseURL: "http://ollama:11434/v1" }];
    await PUT(put({ settings: { custom, defaults: { chat: "custom-ollama:qwen3:14b" }, junk: 1 } }));
    expect(JSON.parse(store.get("AI_SETTINGS")!)).toMatchObject({ custom, defaults: { chat: "custom-ollama:qwen3:14b" } });

    const res = await PUT(put({ key: { provider: "custom-ollama", value: "local-key" } }));
    expect(store.get("AI_KEY_CUSTOM_OLLAMA")).toBe("local-key");
    expect((await res.json()).providers.find((p: { id: string }) => p.id === "custom-ollama").isSet).toBe(true);

    await PUT(put({ settings: { custom: [] } }));
    expect(store.get("AI_KEY_CUSTOM_OLLAMA")).toBe("");
  });

  it("stores a built-in key under its usual name and refuses unknown providers", async () => {
    const { PUT } = await import("./route");
    await PUT(put({ key: { provider: "anthropic", value: " sk-ant " } }));
    expect(store.get("ANTHROPIC_API_KEY")).toBe("sk-ant");
    expect((await PUT(put({ key: { provider: "custom-nope", value: "x" } }))).status).toBe(400);
  });
});
