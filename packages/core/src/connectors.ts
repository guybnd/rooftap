// Connectors (.docs/connectors.md): every outside data source, read from the
// module manifests' `connectors`. Settings > Connectors on both apps lists
// the panels this returns, so a new connector shows up there from its own
// manifest entry plus one line in each app's CONNECTOR_PANELS map.

import type { ConnectorManifest, ConnectorPanelId } from './connector';
import { ALL_MANIFESTS } from './module-manifests';
import type { ModuleId } from './modules';
import { SERVER_FEATURES, type ServerFeatureId } from './server-features';

/** A connector with the module whose data it fills. */
export interface RegisteredConnector extends ConnectorManifest {
  module: ModuleId;
}

/** Every connector, in module order, then in each manifest's order. */
export const CONNECTORS: readonly RegisteredConnector[] = ALL_MANIFESTS.flatMap((m) =>
  (m.connectors ?? []).map((c) => ({ ...c, module: m.id as ModuleId })),
);

/** The connector that writes rows with this `source`, if any. */
export function connectorBySource(source: string): RegisteredConnector | undefined {
  return CONNECTORS.find((c) => c.source === source);
}

/**
 * The Settings > Connectors panels for a household: connectors whose module
 * is on. A server too old for a connector still lists its panel, which then
 * says the server needs an update.
 */
export function connectorPanels(enabled: ReadonlySet<string>): ConnectorPanelId[] {
  return CONNECTORS.filter((c) => enabled.has(c.module)).map((c) => c.panel);
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** What is wrong with the connector list, for the registry test. Empty when it is fine. */
export function connectorProblems(list: readonly RegisteredConnector[] = CONNECTORS): string[] {
  const problems: string[] = [];
  const seen = { id: new Set<string>(), source: new Set<string>(), panel: new Set<string>() };
  for (const c of list) {
    if (!KEBAB.test(c.id)) problems.push(`${c.id}: the id is not kebab-case`);
    if (!KEBAB.test(c.source)) problems.push(`${c.id}: the source "${c.source}" is not lower-case letters, digits and dashes`);
    if (seen.id.has(c.id)) problems.push(`${c.id}: another connector has this id`);
    if (seen.source.has(c.source)) problems.push(`${c.id}: another connector writes source "${c.source}"`);
    if (seen.panel.has(c.panel)) problems.push(`${c.id}: another connector shows panel "${c.panel}"`);
    seen.id.add(c.id);
    seen.source.add(c.source);
    seen.panel.add(c.panel);
    if (!c.kinds.length) problems.push(`${c.id}: it needs at least one kind (pull, webhook or import)`);
    if (!c.regions.length) problems.push(`${c.id}: it needs at least one region, or '*'`);
    if (!(c.serverFeature in SERVER_FEATURES)) problems.push(`${c.id}: unknown server feature "${c.serverFeature as ServerFeatureId}"`);
    if (!c.label.trim() || !c.description.trim()) problems.push(`${c.id}: it needs a label and a description`);
    if (/[—]/.test(c.description)) problems.push(`${c.id}: no em dashes in UI copy`);
  }
  return problems;
}
