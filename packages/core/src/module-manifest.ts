// The module manifest (.docs/modules.md, section 15): one file per module,
// packages/core/src/modules/<id>/manifest.ts, that says everything the shared
// registries need to know about it. modules.ts, sections.ts, section-hues.ts,
// store-modules.ts, mcp-tools.ts, assistant-reach.ts and module-settings.ts
// all read the manifests (through module-manifests.ts), so adding a module
// means writing its manifest and listing it once, not editing each registry.
//
// This file is a leaf: types and constants only, with type-only imports, so a
// manifest can import it without pulling in the registries that read it.

import type { NavItem } from './sections';
import type { SectionHue } from './section-hues';
import type { SettingsPanelId } from './module-settings';
import type { ConnectorManifest } from './connector';

/** How the Assistant reaches a table: the household tools that read or change it, or why none do. */
export type Reach = { tools: readonly string[] } | { none: string };

/** Reasons several tables share for having no Assistant tool. */
export const REACH_REASONS = {
  comments: 'Comments are members talking to each other about an item, not household state to act on.',
  server: 'Server bookkeeping, not something a person reads or changes.',
  account: 'Accounts, sign-in and access, kept out of the Assistant on purpose.',
} as const;

/** A module's own entry in the app's section switcher (sidebar, tab bar, Home tiles). */
export interface ManifestSection {
  label: string;
  /** Compact label for tight switcher surfaces (tiles, tab bar). */
  shortLabel: string;
  /** Lucide icon name; defaults to the module's iconId. */
  iconId?: string;
  basePath: string;
  /** Whether the share sheet offers this section as a target. */
  acceptsShares: boolean;
  navItems: readonly NavItem[];
  /**
   * The section's own colour: a curated hue ('mint') or any `#rrggbb`, whose
   * tile, glyph and glow shades are worked out per scheme. Spaces show
   * sections side by side, so no two sections share one.
   */
  hue: SectionHue;
  /** Phone tab routes besides basePath, for nav items that are tabs of their own. */
  tabRoutes?: readonly string[];
}

/**
 * A shared screen a module can put its own content on (.docs/modules.md,
 * section 17). The module lists the slots it fills here and keeps each slot's
 * source in its own folder; packages/core/src/slots/ lists the sources and the
 * shared screen loops over them.
 */
export type SlotId = 'calendar' | 'home-agenda';

/** A database table the module owns. Every table in supabase/migrations belongs to a module or to the platform list in assistant-reach.ts. */
export interface ManifestTable {
  reach: Reach;
  /**
   * For a synced group store: the modules whose being on syncs the table
   * (store-modules.ts). Usually just this module; a table other modules
   * show too lists them all. Synced tables are also cached in the web app's
   * IndexedDB.
   */
  sync?: readonly string[];
}

/** A household tool the Assistant and MCP clients can call (mcp-tools.ts); its handler lives in apps/web/src/lib/mcp/. */
export interface ManifestTool {
  name: string;
  kind: 'read' | 'write';
}

export interface ModuleManifest {
  /** Kebab-case id, also the folder name and the `group_modules.module_id`. */
  id: string;
  label: string;
  /** One line for the Settings > Modules row. Hearth copy rules apply. */
  description: string;
  /** Lucide icon name, resolved per platform. */
  iconId: string;
  /** On for a new household with no `group_modules` row for this module. */
  defaultEnabled: boolean;
  /** Hard dependencies: can't be on unless these are on. */
  requires?: readonly string[];
  /** Soft dependencies: cross-module features appear only when both are on. */
  enhances?: readonly string[];
  /** For a module added after 1.0.0: the migration it needs (server-features.ts). */
  minSchema?: string;
  /** Its section, when it has a screen of its own. Integrations (Google Calendar, MCP) have none. */
  section?: ManifestSection;
  tables?: Readonly<Record<string, ManifestTable>>;
  tools?: readonly ManifestTool[];
  /** Why the module has no household tool. A module needs tools or this reason (assistant-reach.test.ts). */
  noTools?: string;
  /** Its settings panels, in the order Settings and the screen's settings sheet show them (module-settings.ts). */
  settings?: readonly SettingsPanelId[];
  /** Outside sources that fill this module's data (connectors.ts, .docs/connectors.md). Shown in Settings > Connectors while the module is on. */
  connectors?: readonly ConnectorManifest[];
  /** The shared screens it puts content on, each with a source in its folder (slots/). */
  slots?: readonly SlotId[];
}

/** Declares a module. The `const` type parameter keeps the id a literal, which is how ModuleId is built. */
export function defineModule<const M extends ModuleManifest>(manifest: M): M {
  return manifest;
}
