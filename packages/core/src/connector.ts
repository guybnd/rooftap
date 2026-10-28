// The connector manifest (.docs/connectors.md): one outside data source that
// fills a module's data, either on its own (it pulls, or the outside service
// pushes to a webhook) or when a person imports a file by hand. Up Bank is
// the first; a CSV bank statement is the second. A connector is declared next
// to the module whose data it fills (packages/core/src/modules/<id>/connectors/)
// and listed in that module's manifest under `connectors`; connectors.ts reads
// them all from there.
//
// This file is a leaf: types only, with type-only imports, so a manifest can
// import it without pulling in the registries that read it.

import type { ServerFeatureId } from './server-features';

/**
 * How data arrives. 'pull': the server reads the outside service (on open, or
 * on a schedule). 'webhook': the outside service pushes to the server.
 * 'import': a person hands over a file.
 */
export type ConnectorKind = 'pull' | 'webhook' | 'import';

/** The rows a connector writes. Each kind has one shared write path on the server. */
export type ConnectorData = 'bank-transactions';

/**
 * A connector's Settings > Connectors panel. Each app maps every id to its
 * component (apps/*\/settings-registry.ts, typed against this union, so a
 * panel can't be missing on one platform).
 */
export type ConnectorPanelId = 'up-bank' | 'bank-import';

/** A key a connector needs before it works. */
export interface ConnectorKey {
  /** A server env var name, or a short name for what a person pastes. */
  id: string;
  /** Who supplies it: each person in Settings, or the server's operator in its environment. */
  from: 'person' | 'server';
  /** What it is, for people and operators. */
  label: string;
}

export interface ConnectorManifest {
  /** Kebab-case, unique across all connectors. */
  id: string;
  label: string;
  /** One line for the Settings > Connectors panel. Hearth copy rules apply. */
  description: string;
  /** Lucide icon name, resolved per platform. */
  iconId: string;
  kinds: readonly ConnectorKind[];
  data: ConnectorData;
  /**
   * The value the connector writes in its rows' `source` column, so its rows
   * can be told apart and removed together. Lower case letters, digits and
   * dashes; unique across connectors.
   */
  source: string;
  keys?: readonly ConnectorKey[];
  /**
   * Who may use it on the hosted server (ROOFTAP_BILLING=on). 'everyone', or
   * 'operator' when the outside service allows personal use only, so only the
   * operator's own (billing exempt) household may. Self-hosted servers
   * belong to the household that runs them, so everyone there may.
   */
  hosted: 'everyone' | 'operator';
  /** ISO country codes where the outside service works, or '*'. */
  regions: readonly string[];
  /** The server feature that has its tables and routes (server-features.ts). The panel shows only on servers that have it. */
  serverFeature: ServerFeatureId;
  panel: ConnectorPanelId;
  homepage?: string;
}

/** Declares a connector. The `const` type parameter keeps the ids literal. */
export function defineConnector<const C extends ConnectorManifest>(manifest: C): C {
  return manifest;
}
