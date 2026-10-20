import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_MODULE_IDS } from "@homeup/core";

// requireModules builds its own admin client; route it to the same stub.
let rows: { module_id: string; enabled: boolean }[] | null = [];
let readError: { message: string } | null = null;
let groupId: string | null = "group-a";

function stubAdmin() {
  return {
    from: (table: string) => {
      if (table === "group_modules") {
        return { select: () => ({ eq: async () => ({ data: rows, error: readError }) }) };
      }
      if (table === "group_members") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          limit: () => builder,
          single: async () => ({ data: groupId ? { group_id: groupId } : null, error: null }),
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => stubAdmin() }));

import { getEnabledModules, requireModules } from "./server-modules";

afterEach(() => {
  rows = [];
  readError = null;
  groupId = "group-a";
  vi.unstubAllEnvs();
});

const allOn = () => ALL_MODULE_IDS.map((id) => ({ module_id: id, enabled: true }));

describe("getEnabledModules", () => {
  it("follows the household's switches", async () => {
    rows = allOn().map((r) => (r.module_id === "costs" ? { ...r, enabled: false } : r));
    const enabled = await getEnabledModules(stubAdmin(), "group-a");
    expect(enabled.has("costs")).toBe(false);
    expect(enabled.has("household")).toBe(true);
  });

  it("uses the defaults for a household with no rows, so the integrations start off", async () => {
    const enabled = await getEnabledModules(stubAdmin(), "group-a");
    expect(enabled.has("household")).toBe(true);
    expect(enabled.has("mcp")).toBe(false);
    expect(enabled.has("google-calendar")).toBe(false);
  });

  it("drops modules the server doesn't offer (HOMEUP_MODULES)", async () => {
    vi.stubEnv("HOMEUP_MODULES", "household,calendar,google-calendar");
    rows = allOn();
    expect([...(await getEnabledModules(stubAdmin(), "group-a"))].sort()).toEqual([
      "calendar",
      "google-calendar",
      "household",
    ]);
  });

  it("treats every offered module as on when the switches can't be read", async () => {
    vi.stubEnv("HOMEUP_MODULES", "household,mcp");
    readError = { message: "boom" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect([...(await getEnabledModules(stubAdmin(), "group-a"))].sort()).toEqual(["household", "mcp"]);
  });
});

describe("requireModules", () => {
  it("is null while every named module is on", async () => {
    rows = allOn();
    expect(await requireModules("user-1", "search", "google-calendar")).toBeNull();
  });

  it("answers 404 when any named module is off", async () => {
    rows = allOn().map((r) => (r.module_id === "google-calendar" ? { ...r, enabled: false } : r));
    const res = await requireModules("user-1", "search", "google-calendar");
    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "Not found" });
  });

  it("uses the defaults for a user with no household", async () => {
    groupId = null;
    expect(await requireModules("user-1", "household")).toBeNull();
    expect((await requireModules("user-1", "google-calendar"))?.status).toBe(404);
  });
});
