import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  HOME_ASSISTANT_SCOPE,
  HOME_ASSISTANT_TOOL_PREFIX,
  homeAssistantMcpUrl,
  homeAssistantToolAllowed,
  homeAssistantToolKind,
  isTrustLevel,
  toolGate,
  type HomeAssistantConnection,
  type HomeAssistantToolInfo,
  type TrustLevel,
} from "@homeup/core";
import { billingMode } from "@/lib/billing";
import { decryptHouseholdKey } from "@/lib/ai/household-keys";
import type { ToolResult } from "@/lib/mcp/household-tools";
import type { AssistantTool } from "./tools";

// HOUP-449: the assistant's Home Assistant tools. Rooftap is an MCP client
// of Home Assistant's own MCP Server integration (/api/mcp), with the
// household's long-lived access token (stored encrypted in
// assistant_home_assistant, under the same secret as household AI keys).
// Home Assistant decides what is reachable (the entities exposed to Assist);
// the owner's allowlist and trust level narrow it here, and writes go
// through the same Read / Ask first / Act gate as Rooftap's own tools.

/** How long Home Assistant has to answer before the turn carries on without it. */
const HA_TIMEOUT_MS = 8_000;
/** Tool lists are kept this long per connection, so a turn doesn't wait on a listing each time. */
const TOOL_LIST_TTL_MS = 5 * 60_000;
/** After a failed listing, Home Assistant is left alone this long. */
const UNREACHABLE_TTL_MS = 60_000;

export interface HomeAssistantRow {
  group_id: string;
  url: string;
  encrypted_token: string;
  last4: string;
  trust: string;
  allowed_tools: string[] | null;
  updated_at: string;
}

export function toConnection(row: HomeAssistantRow): HomeAssistantConnection {
  return {
    url: row.url,
    last4: row.last4,
    trust: isTrustLevel(row.trust) ? row.trust : "ask",
    allowedTools: row.allowed_tools ?? null,
    updatedAt: row.updated_at,
  };
}

/** The household's connection row; none on an older server without the table. */
export async function homeAssistantRow(admin: SupabaseClient, groupId: string): Promise<HomeAssistantRow | null> {
  const { data, error } = await admin.from("assistant_home_assistant").select("*").eq("group_id", groupId).maybeSingle();
  if (error) return null;
  return (data as HomeAssistantRow | null) ?? null;
}

// ── Where the server may connect ────────────────────────────────────────

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(v);
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * A self-hosted server sits on the household's network, so it may reach
 * Home Assistant there. The hosted server must only call out to the public
 * internet: a URL that is, or resolves to, a private address is refused, so
 * the token box can't be used to probe the host's own network.
 */
export async function checkHomeAssistantHost(base: string): Promise<string | null> {
  if (billingMode() !== "on") return null;
  const { hostname, protocol } = new URL(base);
  if (protocol !== "https:") return "Use an https address. The hosted server only connects to Home Assistant over HTTPS.";
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return "That address is only reachable on your home network. Use your Home Assistant's public address (Nabu Casa, a Cloudflare tunnel or Tailscale Funnel).";
  }
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return "That address couldn't be found.";
  }
  if (addresses.some(privateAddress)) {
    return "That address is only reachable on your home network. Use your Home Assistant's public address (Nabu Casa, a Cloudflare tunnel or Tailscale Funnel).";
  }
  return null;
}

// ── Talking to Home Assistant ───────────────────────────────────────────

interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
}

function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Home Assistant didn't answer in time (${what}).`)), HA_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** How long a connection is kept open after its last use, so the next call in a turn (or the next turn) skips the handshake. */
const IDLE_CLOSE_MS = 60_000;

interface Pooled {
  client: Promise<Client>;
  timer?: ReturnType<typeof setTimeout>;
}

const pool = new Map<string, Pooled>();

async function connectTo(base: string, token: string): Promise<Client> {
  const client = new Client({ name: "rooftap-assistant", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(homeAssistantMcpUrl(base)), {
    // No redirects: a hop could land on an address checkHomeAssistantHost refused.
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
  });
  try {
    await withTimeout(client.connect(transport), "connecting");
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
  return client;
}

function drop(key: string) {
  const entry = pool.get(key);
  if (!entry) return;
  pool.delete(key);
  if (entry.timer) clearTimeout(entry.timer);
  void entry.client.then((c) => c.close()).catch(() => {});
}

/** A session Home Assistant answered on and then forgot (it restarted, or the session timed out): safe to retry, nothing ran. */
function staleSession(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b404\b|session/i.test(message);
}

/**
 * Runs `work` on a connection to Home Assistant. Connections are kept open
 * for a minute after use and shared, because the handshake is a round trip
 * or two of its own, and a turn that looks something up and then switches
 * a light would otherwise pay it twice. `fresh` connects just for this call
 * (a new address or token being tried).
 */
async function withHomeAssistant<T>(
  base: string,
  token: string,
  what: string,
  work: (client: Client) => Promise<T>,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<T> {
  if (fresh) {
    let client: Client | null = null;
    try {
      client = await connectTo(base, token);
      return await withTimeout(work(client), what);
    } catch (err) {
      throw new Error(friendlyError(err));
    } finally {
      await client?.close().catch(() => {});
    }
  }
  const key = `${base}\n${token}`;
  for (let attempt = 0; ; attempt++) {
    let entry = pool.get(key);
    const reused = !!entry;
    if (!entry) {
      entry = { client: connectTo(base, token) };
      pool.set(key, entry);
    }
    if (entry.timer) clearTimeout(entry.timer);
    try {
      const result = await withTimeout(work(await entry.client), what);
      entry.timer = setTimeout(() => drop(key), IDLE_CLOSE_MS);
      entry.timer.unref?.();
      return result;
    } catch (err) {
      drop(key);
      if (reused && attempt === 0 && staleSession(err)) continue;
      throw new Error(friendlyError(err));
    }
  }
}

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/didn't answer in time/.test(message)) return message;
  if (/401|403|unauthori[sz]ed|forbidden/i.test(message)) return "Home Assistant turned the token down. Make a new long-lived access token and paste it again.";
  if (/404/.test(message)) return "Home Assistant has no MCP server at that address. Add the Model Context Protocol Server integration in Home Assistant first.";
  if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|fetch failed/i.test(message)) return "Couldn't reach Home Assistant at that address.";
  return `Home Assistant: ${message.slice(0, 200)}`;
}

async function listTools(base: string, token: string, opts?: { fresh?: boolean }): Promise<ListedTool[]> {
  return withHomeAssistant(base, token, "listing tools", async (client) => (await client.listTools()).tools as ListedTool[], opts);
}

/** What Home Assistant offers, for the settings panel (and to check a new URL and token, on a connection of its own). */
export async function homeAssistantToolInfo(base: string, token: string, opts?: { fresh?: boolean }): Promise<HomeAssistantToolInfo[]> {
  const tools = await listTools(base, token, opts);
  return tools.map((t) => ({ name: t.name, description: t.description ?? "", kind: homeAssistantToolKind(t.name, t.annotations) }));
}

const listCache = new Map<string, { at: number; tools: ListedTool[] } | { at: number; error: string }>();

async function cachedTools(row: HomeAssistantRow, token: string): Promise<ListedTool[]> {
  const key = `${row.group_id}:${row.updated_at}`;
  const hit = listCache.get(key);
  if (hit && "tools" in hit && Date.now() - hit.at < TOOL_LIST_TTL_MS) return hit.tools;
  // An unreachable Home Assistant isn't retried on every turn, so asks about
  // anything else don't each wait out the timeout.
  if (hit && "error" in hit && Date.now() - hit.at < UNREACHABLE_TTL_MS) throw new Error(hit.error);
  for (const k of listCache.keys()) if (k.startsWith(`${row.group_id}:`)) listCache.delete(k);
  try {
    const tools = await listTools(row.url, token);
    listCache.set(key, { at: Date.now(), tools });
    return tools;
  } catch (err) {
    listCache.set(key, { at: Date.now(), error: err instanceof Error ? err.message : "it couldn't be reached" });
    throw err;
  }
}

/** Forgets a household's cached tool list (after a settings change). */
export function forgetHomeAssistantTools(groupId: string): void {
  for (const k of listCache.keys()) if (k.startsWith(`${groupId}:`)) listCache.delete(k);
  // Open connections go too: the address or token may have changed.
  for (const k of [...pool.keys()]) drop(k);
}

function toToolResult(result: unknown): ToolResult {
  const r = (result ?? {}) as { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown };
  const texts = (r.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => ({ type: "text" as const, text: c.text! }));
  if (texts.length === 0) texts.push({ type: "text", text: JSON.stringify(r.structuredContent ?? { ok: !r.isError }) });
  return { content: texts, isError: r.isError === true };
}

export interface HomeAssistantTools {
  tools: AssistantTool[];
  trust: TrustLevel;
  /** Why Home Assistant's tools are missing this turn, when it is connected but couldn't be reached. */
  unavailable: string | null;
}

/**
 * The assistant's Home Assistant tools for one turn: what Home Assistant
 * offers, minus what the owner switched off, gated by the connection's
 * trust. None when nothing is connected; when Home Assistant can't be
 * reached the turn goes on without it and says why.
 */
export async function homeAssistantTools(
  admin: SupabaseClient,
  groupId: string,
  { readOnly = false }: { readOnly?: boolean } = {}
): Promise<HomeAssistantTools | null> {
  const row = await homeAssistantRow(admin, groupId);
  if (!row) return null;
  const connection = toConnection(row);
  const trust: TrustLevel = readOnly ? "read" : connection.trust;
  const token = decryptHouseholdKey(row.encrypted_token);
  if (!token) return { tools: [], trust, unavailable: "the saved token can't be read on this server; an owner needs to paste it again" };
  let listed: ListedTool[];
  try {
    listed = await cachedTools(row, token);
  } catch (err) {
    return { tools: [], trust, unavailable: err instanceof Error ? err.message : "it couldn't be reached" };
  }
  const tools = listed.flatMap((t): AssistantTool[] => {
    if (!homeAssistantToolAllowed(t.name, connection.allowedTools)) return [];
    const kind = homeAssistantToolKind(t.name, t.annotations);
    const gate = toolGate(kind, trust);
    if (gate === "hidden") return [];
    const schema = t.inputSchema && typeof t.inputSchema === "object" ? { ...t.inputSchema } : { type: "object", properties: {} };
    delete (schema as { $schema?: unknown }).$schema;
    return [
      {
        name: `${HOME_ASSISTANT_TOOL_PREFIX}${t.name}`,
        description: `Home Assistant: ${t.description ?? t.name}`,
        parameters: schema,
        module: HOME_ASSISTANT_SCOPE,
        gate,
        lookup: kind === "read",
        run: async (args) => {
          try {
            return toToolResult(
              await withHomeAssistant(connection.url, token, t.name, (client) => client.callTool({ name: t.name, arguments: args }))
            );
          } catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Home Assistant failed" }) }], isError: true };
          }
        },
      },
    ];
  });
  return { tools, trust, unavailable: null };
}
