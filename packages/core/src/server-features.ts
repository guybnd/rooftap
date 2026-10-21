// Server features: what a self-hosted server is too old for.
//
// The store app follows `main` through OTA updates, but a self-hosted server
// only changes when its owner pulls and rebuilds (.docs/self-hosting.md). So
// the app can be newer than the server it talks to, and new app code would
// call a table or API route that server doesn't have yet. The server reports
// its schema version (the newest file in supabase/migrations/ it was built
// from) in /api/public-config, and every feature that needs something newer
// than the 1.0.0 baseline is listed here with the migration it needs. Surfaces
// gate on `useModules().server(id)`, and a module with `minSchema` drops out
// of the offered list like a module the server doesn't offer, so the "no
// trace" rules in .docs/modules.md apply unchanged.
//
// Adding a feature that needs a new migration or API route: add an entry
// naming the migration that ships with it, and gate the surface on it.
// apps/web's server-features test checks every entry names a real migration.

/**
 * The schema 1.0.0 shipped with. A server that doesn't report a version
 * predates this file, so it is treated as this baseline.
 */
export const SCHEMA_BASELINE = '20261020010000_documents_bucket_50mb';

export interface ServerFeatureDef {
  /** The migration (file name without .sql) the feature needs. */
  minSchema: string;
  /** What updating adds, read mid-sentence in the Settings > Modules note (lower case). */
  label: string;
}

export const SERVER_FEATURES = {
  'mcp.connected-apps': {
    minSchema: '20261020050000_mcp_oauth',
    label: 'connecting AI assistants by signing in',
  },
  'shopper.source-switches': {
    minSchema: '20261021050000_shopper_source_switches',
    label: 'switching Shopper price sources on and off',
  },
  'ai.household-keys': {
    minSchema: '20261021061000_household_ai_keys',
    label: "using your household's own AI key",
  },
} as const satisfies Record<string, ServerFeatureDef>;

export type ServerFeatureId = keyof typeof SERVER_FEATURES;

/**
 * The server's schema as the client knows it:
 * - undefined: not known yet (no config loaded). Everything counts as
 *   supported, so the official server never flashes features away on a cold
 *   start; the same optimism as unknown module rows.
 * - null: the server answered without a version, so it predates this file.
 * - a migration name: what the server was built from.
 */
export type ServerSchema = string | null | undefined;

// Migration names start with a 14-digit UTC timestamp, so comparing those
// orders them; the rest of the name is ignored.
function stamp(version: string): string {
  return version.slice(0, 14);
}

/** Whether a server on `schema` has everything a feature needing `minSchema` uses. */
export function schemaAtLeast(schema: ServerSchema, minSchema: string): boolean {
  if (schema === undefined) return true;
  return stamp(schema ?? SCHEMA_BASELINE) >= stamp(minSchema);
}

export function serverSupports(id: ServerFeatureId, schema: ServerSchema): boolean {
  return schemaAtLeast(schema, SERVER_FEATURES[id].minSchema);
}

/** Features this server is too old for, for the "update your server" note. */
export function missingServerFeatures(schema: ServerSchema): ServerFeatureDef[] {
  return (Object.values(SERVER_FEATURES) as ServerFeatureDef[]).filter((f) => !schemaAtLeast(schema, f.minSchema));
}

/** The Settings > Modules line for a server that's behind; same copy on both platforms. */
export function serverUpdateNote(adds: readonly Pick<ServerFeatureDef, 'label'>[]): string {
  return `This server runs an older version of Rooftap. Updating it adds: ${adds.map((f) => f.label).join(', ')}.`;
}

/** The newest migration among `.sql` file names, without the extension; null if none. */
export function newestMigration(fileNames: readonly string[]): string | null {
  const versions = fileNames.filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -'.sql'.length));
  if (versions.length === 0) return null;
  return versions.sort()[versions.length - 1];
}
