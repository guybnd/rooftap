import { describe, expect, it, afterEach } from "vitest";
import { MIN_APP_RUNTIME } from "@homeup/core";
import { GET } from "./route";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SUPABASE_PUBLIC_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.HOMEUP_MODULES;
  delete process.env.HOMEUP_SCHEMA_VERSION;
  delete process.env.HOMEUP_APP_VERSION;
  delete process.env.HOMEUP_APP_RUNTIME;
  delete process.env.APP_DOWNLOAD_URL;
}

describe("GET /api/public-config", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("prefers SUPABASE_PUBLIC_URL when set", async () => {
    resetEnv();
    process.env.SUPABASE_PUBLIC_URL = "https://gateway.example.com";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:8000";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({
      supabaseUrl: "https://gateway.example.com",
      supabaseAnonKey: "anon-key",
      modules: null,
      schemaVersion: null,
      version: null,
      minAppRuntime: MIN_APP_RUNTIME,
      latestApp: null,
    });
  });

  it("falls back to NEXT_PUBLIC_SUPABASE_URL when SUPABASE_PUBLIC_URL is unset", async () => {
    resetEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://official.example.com";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    const res = await GET();
    const json = await res.json();

    expect(json).toEqual({
      supabaseUrl: "https://official.example.com",
      supabaseAnonKey: "anon-key",
      modules: null,
      schemaVersion: null,
      version: null,
      minAppRuntime: MIN_APP_RUNTIME,
      latestApp: null,
    });
  });

  it("advertises the modules in HOMEUP_MODULES, dropping unknown ids", async () => {
    resetEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://official.example.com";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.HOMEUP_MODULES = "household, calendar,typo";

    const res = await GET();
    const json = await res.json();

    expect(json.modules).toEqual(["household", "calendar"]);
  });

  it("reports the schema version this build shipped with", async () => {
    resetEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://official.example.com";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.HOMEUP_SCHEMA_VERSION = "20261020050000_mcp_oauth";

    const res = await GET();
    const json = await res.json();

    expect(json.schemaVersion).toBe("20261020050000_mcp_oauth");
  });

  it("returns exactly the public fields, no service-role or other env leaks", async () => {
    resetEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://official.example.com";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    process.env.BYPASS_PASSWORD = "hunter2";

    const res = await GET();
    const json = await res.json();

    expect(Object.keys(json).sort()).toEqual(["latestApp", "minAppRuntime", "modules", "schemaVersion", "supabaseAnonKey", "supabaseUrl", "version"]);
    expect(JSON.stringify(json)).not.toContain("service-role-secret");
    expect(JSON.stringify(json)).not.toContain("hunter2");
  });

  it("is CORS-open (unauthenticated clients from any origin can read it)", async () => {
    resetEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://official.example.com";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    const res = await GET();

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("503s with no leak when neither URL var is set", async () => {
    resetEnv();
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json).toEqual({ error: "Server is not configured" });
  });
});
