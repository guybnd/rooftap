import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePatUser, checkPatRateLimit, resolveGroupId } from '@/lib/pat';
import type { ModuleId } from '@homeup/core';
import { MCP_TOOLS, MCP_TOOL_BY_NAME } from "@/lib/mcp-tools";
import { getMcpSettings, toolAllowed, type McpSettings } from "@/lib/mcp-settings";
import { getEnabledModules, moduleNotFound } from "@/lib/server-modules";
import { checkOAuthRateLimit, isOAuthAccessToken, resolveOAuthUser, wwwAuthenticate } from "@/lib/mcp-oauth";
import { householdTools } from "@/lib/mcp/household-tools";

// Generic, non-enumerating 401 body — identical for missing/malformed/unknown/revoked auth,
// so an external caller can never tell which of those cases they hit.
// The www-authenticate header points sign-in capable clients (Claude and
// other MCP apps) at the OAuth discovery document (lib/mcp-oauth.ts).
function unauthorized(req: Request) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": wwwAuthenticate(new URL(req.url).origin) },
  });
}

function buildServer(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  groupId: string | null,
  settings: McpSettings,
  enabled: ReadonlySet<ModuleId>
) {
  const server = new McpServer({ name: "homeup", version: "1.0.0" });
  const tools = householdTools({ admin, userId, groupId, enabled });

  // Gates every tool through the household's modules (a switched-off
  // module's tools don't exist) and the settings conjunction
  // (mcp-settings.ts's toolAllowed).
  for (const t of tools) {
    const meta = MCP_TOOL_BY_NAME[t.name];
    if (!meta) throw new Error(`Unknown MCP tool "${t.name}" — add it to its module manifest's tools (packages/core/src/modules/<id>/manifest.ts)`);
    if (!enabled.has(meta.module)) continue;
    if (!toolAllowed(settings, meta)) continue;
    server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema } as never, t.handler as never);
  }

  // Dev-only: keeps MCP_TOOLS (packages/core/src/mcp-tools.ts) — the settings UI's
  // source of truth — from drifting away from the tool handlers. `tools` lists
  // every tool regardless of settings and modules, so this checks the full set,
  // not what a particular request's settings happened to allow.
  if (process.env.NODE_ENV !== "production") {
    const expected = new Set(MCP_TOOLS.map((t) => t.name));
    const registeredNames = new Set(tools.map((t) => t.name));
    const missing = [...expected].filter((n) => !registeredNames.has(n));
    const extra = [...registeredNames].filter((n) => !expected.has(n));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `MCP_TOOLS drift: missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)} — keep the module manifests' tools in sync with householdTools() in lib/mcp/household-tools.ts.`
      );
    }
  }

  return server;
}

function rateLimited() {
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "60" },
  });
}

async function handleMcp(req: Request): Promise<Response> {
  const admin = createAdminClient();
  // A bot API key, or an access token from MCP sign-in.
  const authHeader = req.headers.get("authorization");
  let identity: { userId: string };
  if (isOAuthAccessToken(authHeader)) {
    const oauth = await resolveOAuthUser(admin, authHeader);
    if (!oauth) return unauthorized(req);
    if (!(await checkOAuthRateLimit(admin, oauth.tokenId))) return rateLimited();
    identity = oauth;
  } else {
    const pat = await resolvePatUser(admin, authHeader);
    if (!pat) return unauthorized(req);
    if (!(await checkPatRateLimit(admin, pat.patId))) return rateLimited();
    identity = pat;
  }

  const groupId = await resolveGroupId(admin, identity.userId);
  // MCP is a module (.docs/modules.md): while it's off the endpoint doesn't exist.
  const enabled = await getEnabledModules(admin, groupId);
  if (!enabled.has("mcp")) return moduleNotFound();
  const settings = await getMcpSettings(admin, identity.userId);
  const server = buildServer(admin, identity.userId, groupId, settings, enabled);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function POST(req: Request) {
  return handleMcp(req);
}

export async function GET(req: Request) {
  return handleMcp(req);
}
