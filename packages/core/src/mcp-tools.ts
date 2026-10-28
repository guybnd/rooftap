import type { ModuleId } from './modules';
import { ALL_MANIFESTS } from './module-manifests';

export type McpToolKind = 'read' | 'write';

export interface McpToolMeta {
  name: string;
  kind: McpToolKind;
  /** The module whose data the tool reads or writes; it registers only while that module is on. */
  module: ModuleId;
}

// Every tool the Rooftap MCP server can expose, from each module's manifest
// (`tools`), in registry order. `kind` gates registration in buildServer()
// (apps/web/src/app/api/mcp/route.ts) and renders the settings allowlist on
// web and native (mcp-settings.tsx in each app), so the registered set and the
// UI checklist are the same list by construction. A dev-time assertion in
// route.ts keeps this list and the actual registerTool call sites from
// drifting apart. `module` gates registration and the checklist the same way
// (.docs/modules.md): a switched-off module's tools don't exist.
export const MCP_TOOLS: McpToolMeta[] = ALL_MANIFESTS.flatMap((m) =>
  (m.tools ?? []).map((t) => ({ name: t.name, kind: t.kind, module: m.id as ModuleId })),
);

export const MCP_TOOL_BY_NAME: Record<string, McpToolMeta> = Object.fromEntries(
  MCP_TOOLS.map((t) => [t.name, t])
);

/** The tools a household's modules allow, in MCP_TOOLS order. */
export function mcpToolsForModules(enabled: ReadonlySet<string>): McpToolMeta[] {
  return MCP_TOOLS.filter((t) => enabled.has(t.module));
}
