import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listTools = vi.fn();
const callTool = vi.fn();
const connect = vi.fn(async () => {});
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = connect;
    close = vi.fn(async () => {});
    listTools = listTools;
    callTool = callTool;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: class {} }));
vi.mock("@/lib/ai/household-keys", () => ({ decryptHouseholdKey: (s: string) => (s === "enc" ? "token" : null) }));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => [{ address: host === "lan.example.com" ? "192.168.1.5" : "93.184.216.34" }]),
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { checkHomeAssistantHost, forgetHomeAssistantTools, homeAssistantTools, privateAddress, type HomeAssistantRow } from "./home-assistant";

function adminWith(row: Partial<HomeAssistantRow> | null) {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
  return { from: () => chain } as unknown as SupabaseClient;
}

const row = (over: Partial<HomeAssistantRow> = {}): Partial<HomeAssistantRow> => ({
  group_id: "g1",
  url: "https://home.example.com",
  encrypted_token: "enc",
  last4: "oken",
  trust: "ask",
  allowed_tools: null,
  updated_at: "2026-10-21T00:00:00Z",
  ...over,
});

beforeEach(() => {
  forgetHomeAssistantTools("g1");
  connect.mockClear();
  callTool.mockReset();
  listTools.mockResolvedValue({
    tools: [
      { name: "GetLiveContext", description: "States", inputSchema: { type: "object", properties: {} } },
      { name: "HassTurnOn", description: "Turn on", inputSchema: { type: "object", properties: { name: { type: "string" } } } },
    ],
  });
  callTool.mockResolvedValue({ content: [{ type: "text", text: "done" }] });
});

afterEach(() => {
  delete process.env.ROOFTAP_BILLING;
});

describe("homeAssistantTools", () => {
  it("offers nothing when Home Assistant isn't connected", async () => {
    expect(await homeAssistantTools(adminWith(null), "g1")).toBeNull();
  });

  it("prefixes tools, runs reads and holds writes under Ask first", async () => {
    const ha = (await homeAssistantTools(adminWith(row()), "g1"))!;
    expect(ha.tools.map((t) => [t.name, t.gate])).toEqual([
      ["ha_GetLiveContext", "run"],
      ["ha_HassTurnOn", "propose"],
    ]);
    const res = await ha.tools[1].run({ name: "Kitchen light" });
    expect(callTool).toHaveBeenCalledWith({ name: "HassTurnOn", arguments: { name: "Kitchen light" } });
    expect(res.content[0].text).toBe("done");
  });

  it("follows the allowlist and read-only members", async () => {
    const ha = (await homeAssistantTools(adminWith(row({ allowed_tools: ["HassTurnOn"], trust: "act" })), "g1"))!;
    expect(ha.tools.map((t) => [t.name, t.gate])).toEqual([["ha_HassTurnOn", "run"]]);
    forgetHomeAssistantTools("g1");
    const readOnly = (await homeAssistantTools(adminWith(row()), "g1", { readOnly: true }))!;
    expect(readOnly.tools.map((t) => t.name)).toEqual(["ha_GetLiveContext"]);
  });

  it("carries on without Home Assistant when it can't be reached", async () => {
    listTools.mockRejectedValue(new Error("fetch failed"));
    const ha = (await homeAssistantTools(adminWith(row()), "g1"))!;
    expect(ha.tools).toEqual([]);
    expect(ha.unavailable).toMatch(/Couldn't reach/);
  });
});

describe("the connection to Home Assistant", () => {
  it("is kept open between the listing and the calls, so a turn pays the handshake once", async () => {
    const ha = (await homeAssistantTools(adminWith(row({ trust: "act" })), "g1"))!;
    await ha.tools[0].run({});
    await ha.tools[1].run({ name: "Kitchen light" });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it("reconnects once when Home Assistant forgot the session", async () => {
    const ha = (await homeAssistantTools(adminWith(row({ trust: "act" })), "g1"))!;
    callTool.mockRejectedValueOnce(new Error("Error POSTing to endpoint (HTTP 404): Session not found"));
    const res = await ha.tools[1].run({ name: "Kitchen light" });
    expect(res.content[0].text).toBe("done");
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("doesn't repeat a change that failed some other way", async () => {
    const ha = (await homeAssistantTools(adminWith(row({ trust: "act" })), "g1"))!;
    callTool.mockRejectedValueOnce(new Error("fetch failed"));
    const res = await ha.tools[1].run({ name: "Kitchen light" });
    expect(res.isError).toBe(true);
    expect(callTool).toHaveBeenCalledTimes(1);
  });
});

describe("checkHomeAssistantHost", () => {
  it("lets a self-hosted server reach the home network", async () => {
    expect(await checkHomeAssistantHost("http://192.168.1.5:8123")).toBeNull();
  });

  it("keeps the hosted server on the public internet over https", async () => {
    process.env.ROOFTAP_BILLING = "on";
    expect(await checkHomeAssistantHost("https://home.example.com")).toBeNull();
    expect(await checkHomeAssistantHost("http://home.example.com")).toMatch(/https/);
    expect(await checkHomeAssistantHost("https://192.168.1.5")).toMatch(/home network/);
    expect(await checkHomeAssistantHost("https://lan.example.com")).toMatch(/home network/);
    expect(await checkHomeAssistantHost("https://homeassistant.local")).toMatch(/home network/);
    // IPv4 hidden in an IPv6 literal (the URL parser rewrites it as hex).
    expect(await checkHomeAssistantHost("https://[::ffff:169.254.169.254]")).toMatch(/home network/);
    expect(await checkHomeAssistantHost("https://[::ffff:7f00:1]")).toMatch(/home network/);
  });
});

describe("privateAddress", () => {
  it("refuses everything that isn't the public internet", () => {
    for (const ip of [
      "10.1.2.3", "127.0.0.1", "0.0.0.0", "169.254.169.254", "172.20.0.1", "192.168.0.1", "100.100.1.1", "198.18.0.5",
      "224.0.0.1", "255.255.255.255", "::1", "::", "fd00::1", "fe80::1", "fec0::1", "ff02::1",
      "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "2002:c0a8:0101::1", "not an ip",
    ]) expect([ip, privateAddress(ip)]).toEqual([ip, true]);
  });

  it("lets public addresses through", () => {
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:5db8:d822", "2002:5db8:d822::1"]) {
      expect([ip, privateAddress(ip)]).toEqual([ip, false]);
    }
  });
});

describe("an unreachable Home Assistant", () => {
  it("isn't retried on every turn", async () => {
    listTools.mockReset();
    listTools.mockRejectedValue(new Error("fetch failed"));
    await homeAssistantTools(adminWith(row()), "g1");
    await homeAssistantTools(adminWith(row()), "g1");
    expect(listTools).toHaveBeenCalledTimes(1);
  });
});

describe("the saved tool list", () => {
  const saved = [{ name: "HassTurnOn", description: "Turn on", inputSchema: { type: "object", properties: {} } }];

  it("answers a turn without waiting on Home Assistant, which is listed alongside", async () => {
    listTools.mockReset();
    listTools.mockReturnValue(new Promise(() => {}));
    const ha = (await homeAssistantTools(adminWith(row({ tool_list: saved, tool_list_at: new Date().toISOString() })), "g1"))!;
    expect(ha.tools.map((t) => t.name)).toEqual(["ha_HassTurnOn"]);
    await vi.waitFor(() => expect(listTools).toHaveBeenCalledTimes(1));
  });

  it("isn't used once the connection changed after it was saved", async () => {
    const ha = (await homeAssistantTools(adminWith(row({ tool_list: saved, tool_list_at: "2026-10-20T00:00:00Z" })), "g1"))!;
    expect(ha.tools.map((t) => t.name)).toContain("ha_GetLiveContext");
  });
});
