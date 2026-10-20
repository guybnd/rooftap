import { describe, expect, it } from 'vitest';
import {
  SCHEMA_BASELINE,
  SERVER_FEATURES,
  missingServerFeatures,
  newestMigration,
  schemaAtLeast,
  serverSupports,
  serverUpdateNote,
} from './server-features';

describe('schemaAtLeast', () => {
  it('compares migrations by their timestamp', () => {
    expect(schemaAtLeast('20261020050000_mcp_oauth', '20261020040000_group_entitlements')).toBe(true);
    expect(schemaAtLeast('20261020050000_mcp_oauth', '20261020050000_mcp_oauth')).toBe(true);
    expect(schemaAtLeast('20261020040000_group_entitlements', '20261020050000_mcp_oauth')).toBe(false);
  });

  it('treats a server without a version as the 1.0.0 baseline', () => {
    expect(schemaAtLeast(null, SCHEMA_BASELINE)).toBe(true);
    expect(schemaAtLeast(null, '20261020050000_mcp_oauth')).toBe(false);
  });

  it('assumes support while the server is unknown, so nothing flashes away on a cold start', () => {
    expect(schemaAtLeast(undefined, '20991231000000_future')).toBe(true);
  });
});

describe('server features', () => {
  it('only lists features newer than the baseline', () => {
    for (const f of Object.values(SERVER_FEATURES)) {
      expect(f.minSchema > SCHEMA_BASELINE).toBe(true);
    }
  });

  it('hides MCP connected apps on a server from before MCP sign-in', () => {
    expect(serverSupports('mcp.connected-apps', null)).toBe(false);
    expect(serverSupports('mcp.connected-apps', '20261020050000_mcp_oauth')).toBe(true);
  });

  it('lists what an update adds, and nothing for a current server', () => {
    expect(missingServerFeatures(null).map((f) => f.label)).toContain('connecting AI assistants by signing in');
    expect(missingServerFeatures('20991231000000_future')).toEqual([]);
    expect(serverUpdateNote([{ label: 'a' }, { label: 'b' }])).toBe(
      'This server runs an older version of Rooftap. Updating it adds: a, b.'
    );
  });
});

describe('newestMigration', () => {
  it('picks the latest .sql file and drops the extension', () => {
    expect(newestMigration(['20260101000000_a.sql', '20261020050000_b.sql', 'README.md', '20261019000000_c.sql'])).toBe(
      '20261020050000_b'
    );
    expect(newestMigration([])).toBeNull();
  });
});
