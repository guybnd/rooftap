// Rooftap Assistant: the Home Assistant connection (HOUP-449).
//
// The assistant reaches a household's Home Assistant through Home
// Assistant's own MCP Server integration (/api/mcp) with a long-lived access
// token. What it can see and control is what the household exposes to Assist
// in Home Assistant; an owner can narrow that further per tool here, and sets
// one trust level (Read, Ask first, Act) for all of it. The server keeps the
// token encrypted (apps/web lib/assistant/home-assistant.ts); the apps only
// ever see its last four characters.
//
// Pure: URL cleaning, read-or-write for a Home Assistant tool, and the
// shapes the settings panels and /api/assistant/home-assistant share.

import type { ToolKind, TrustLevel } from './assistant';
import type { ModuleId } from './modules';

/** Proposals, prompts and tool lists name Home Assistant with this, where household tools name their module. */
export const HOME_ASSISTANT_SCOPE = 'home-assistant' as const;

/** What an assistant tool belongs to: a household module, or Home Assistant. */
export type AssistantScope = ModuleId | typeof HOME_ASSISTANT_SCOPE;
export const HOME_ASSISTANT_LABEL = 'Home Assistant';
/** Assistant tool names for Home Assistant tools carry this prefix, so they never clash with Rooftap's own. */
export const HOME_ASSISTANT_TOOL_PREFIX = 'ha_';

export interface HomeAssistantConnection {
  /** The base URL, e.g. https://home.example.com. */
  url: string;
  last4: string;
  trust: TrustLevel;
  /** Tool names the assistant may use; null means every tool Home Assistant offers. */
  allowedTools: string[] | null;
  updatedAt: string;
}

export interface HomeAssistantStatus {
  connection: HomeAssistantConnection | null;
  isOwner: boolean;
  /** The server can encrypt a token (HOUSEHOLD_KEYS_SECRET is set). */
  canStore: boolean;
}

export interface HomeAssistantToolInfo {
  name: string;
  description: string;
  kind: ToolKind;
}

export interface HomeAssistantSaveInput {
  url?: string;
  token?: string;
  trust?: TrustLevel;
  allowedTools?: string[] | null;
}

/**
 * Cleans what someone pasted into the URL box down to Home Assistant's base
 * URL: adds https:// when no scheme is given, and drops a trailing slash or
 * a pasted /api/mcp. Null when it isn't an http(s) URL, or carries a
 * username or password.
 */
export function homeAssistantBaseUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || !url.hostname) return null;
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/mcp$/i, '').replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** Home Assistant's MCP endpoint under a base URL. */
export function homeAssistantMcpUrl(base: string): string {
  return `${base.replace(/\/+$/, '')}/api/mcp`;
}

/**
 * Whether a Home Assistant tool only looks things up. Home Assistant marks
 * few tools with MCP annotations, so names count too: its read tools are
 * the Get* ones (GetLiveContext, GetDateTime). Anything else changes the
 * home and goes through trust like any other write.
 */
export function homeAssistantToolKind(name: string, annotations?: { readOnlyHint?: boolean } | null): ToolKind {
  if (annotations?.readOnlyHint === true) return 'read';
  return /^get[A-Z_]/.test(name) || /^Get/.test(name) ? 'read' : 'write';
}

export function homeAssistantToolAllowed(name: string, allowed: readonly string[] | null | undefined): boolean {
  return allowed == null || allowed.includes(name);
}

/** "HassTurnOn" reads "Turn on"; "HassLightSet" reads "Light set". */
export function homeAssistantToolLabel(name: string): string {
  const bare = name.replace(new RegExp(`^${HOME_ASSISTANT_TOOL_PREFIX}`), '').replace(/^Hass(?=[A-Z])/, '');
  const words = bare
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

/** The last four characters of a token, for "•••• abcd". */
export function homeAssistantTokenLast4(token: string): string {
  return token.trim().slice(-4);
}
