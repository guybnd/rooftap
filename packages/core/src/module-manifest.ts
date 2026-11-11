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
import type { HomeLensKey } from './home-lens';
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
export type SlotId = 'calendar' | 'home-agenda' | 'search';

/**
 * A Space the module puts on Home, under the feed (slots/home-spaces.ts).
 * Each app draws it with its own component, listed by key in its
 * home-spaces registry; the module hides it with its section.
 */
export interface ManifestSpace {
  /** Wire id: the desk layout's module id and each app's component key. */
  key: string;
  /** The desktop grid's name for it. */
  label: string;
  /** A card spans the column; a tile sits with the other tiles (a row of them on the phone). */
  size: 'card' | 'tile';
  /** The shortcut that filters Home down to this Space, expanded. */
  lens?: HomeLensKey;
  /** The Customize sheet switch (hero-modules.ts) each person turns it off with. */
  setting?: string;
}

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

/**
 * One of a module's Ask sheet suggestions: the words it sends, and any other
 * modules it needs. `needsData` marks an ask about the module's own rows
 * ("When does the car insurance renew?"): an empty screen of the module never
 * offers it, since there is nothing yet to answer from.
 */
export type AskStarterDef = string | { text: string; with: readonly string[]; needsData?: boolean };

/**
 * A way to start an empty screen that lives on another screen (Hearth §13.9
 * "Empty screens"): "Start from a template", "Scan a recipe". The screen's own
 * add comes first and Rooftap's ask last, so they are not declared here.
 * `module` names the module whose screen it opens (its tile leads the row);
 * the step shows only while that module is on. Hearth copy rules apply.
 */
export interface FirstStepDef {
  label: string;
  /** One short line under the label. */
  meta?: string;
  /** The route it opens; it must exist on web and the phone. */
  href: string;
  /** Whose screen it opens, when not this module's own. */
  module?: string;
}

/**
 * A module helper (module-helpers.ts): Rooftap focused on one job, such as the
 * weekly shop. It opens from the module's screen on a brief built from the
 * household's own data (no AI), then chats with the module's tools plus the
 * read tools of the modules in `reads`. Only modules with a repeating
 * decision get one. Hearth copy rules apply to every string.
 */
export interface ManifestHelper {
  /** The chat's name, e.g. "Groceries helper". */
  label: string;
  /** One line under the name, e.g. "Your list, dinners and usuals". */
  subtitle: string;
  /**
   * The helper's playbook, added to the system prompt after Rooftap's own
   * persona and privacy rules: what it is for, how it works through a job,
   * and the mistakes to avoid. Plain sentences, second person.
   */
  focus: string;
  /** Other modules whose read tools it borrows while they are on. It changes only its own module. */
  reads?: readonly string[];
  /** Other modules' tools that change this module (Recipes' add_recipe_to_groceries), kept while their module is on. */
  writesVia?: readonly string[];
  /**
   * The lead ask, shown first and strongest under the brief: a short catch-up
   * the AI writes from the brief and the module's rows ("Catch me up on the shop").
   * `label` is the chip, `ask` is what it sends.
   */
  summary: { label: string; ask: string };
  /** Asks offered under the brief, in the person's own words. */
  starters: readonly string[];
  /**
   * Whether owners may make the helper's chat one the whole household shares
   * (Settings > Assistant). `never` for a helper about things kept from others,
   * such as gifts. Default `optional`.
   */
  share?: 'optional' | 'never';
}

export interface ModuleManifest {
  /** Kebab-case id, also the folder name and the `group_modules.module_id`. */
  id: string;
  label: string;
  /** One line for the Settings > Modules row. Hearth copy rules apply. */
  description: string;
  /**
   * What the tile does for the others, one short line under its row in the
   * first-run picker ("Fills Groceries from your dinners"). Hearth copy rules apply.
   */
  feeds?: string;
  /**
   * The first-run starting sets (core first-run.ts) that tick this module
   * besides the ones it is on by default in. Everyday is the defaults
   * (`defaultEnabled`), so it is never listed here.
   */
  startingSets?: readonly ('moving' | 'everything')[];
  /**
   * Asks the empty Ask Rooftap sheet offers while this module is on (core
   * askStarters). Short, in the person's own words, and worth asking: a plan,
   * a change or something that joins modules, never a lookup Home already
   * shows. `with` names other modules the ask needs; it shows only while
   * they are on too. Hearth copy rules apply.
   */
  askStarters?: readonly AskStarterDef[];
  /** Extra first steps the module's empty screen offers (core `emptyFirstSteps`). */
  firstSteps?: readonly FirstStepDef[];
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
  /** Splits a long settings list into tabs. Every panel in `settings` sits in exactly one tab, in the same order (module-settings.test.ts). */
  settingsTabs?: readonly ManifestSettingsTab[];
  /** Outside sources that fill this module's data (connectors.ts, .docs/connectors.md). Shown in Settings > Connectors while the module is on. */
  connectors?: readonly ConnectorManifest[];
  /** The shared screens it puts content on, each with a source in its folder (slots/). */
  slots?: readonly SlotId[];
  /** Its Spaces on Home, in the order they show. */
  spaces?: readonly ManifestSpace[];
  /** Its helper chat, when the module has a repeating decision worth one (module-helpers.ts). */
  helper?: ManifestHelper;
}

/** One tab of a module's settings: a short label and the panels it shows. */
export interface ManifestSettingsTab {
  label: string;
  panels: readonly SettingsPanelId[];
}

/** Declares a module. The `const` type parameter keeps the id a literal, which is how ModuleId is built. */
export function defineModule<const M extends ModuleManifest>(manifest: M): M {
  return manifest;
}
