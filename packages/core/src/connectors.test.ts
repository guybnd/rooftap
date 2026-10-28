import { describe, expect, it } from 'vitest';
import { CONNECTORS, connectorBySource, connectorPanels, connectorProblems, type RegisteredConnector } from './connectors';

describe('connectors', () => {
  it('reads every connector from the module manifests, with its module', () => {
    const up = CONNECTORS.find((c) => c.id === 'up-bank');
    expect(up).toMatchObject({ module: 'costs', source: 'up', panel: 'up-bank', data: 'bank-transactions' });
  });

  it('has no problems', () => {
    expect(connectorProblems()).toEqual([]);
  });

  it('finds a connector by the source its rows carry', () => {
    expect(connectorBySource('up')?.id).toBe('up-bank');
    expect(connectorBySource('nope')).toBeUndefined();
  });

  it('lists a panel only while its module is on', () => {
    expect(connectorPanels(new Set(['costs']))).toContain('up-bank');
    expect(connectorPanels(new Set(['groceries']))).not.toContain('up-bank');
  });

  it('catches a clashing or malformed connector', () => {
    const up = CONNECTORS[0];
    const twin: RegisteredConnector = { ...up, id: 'Up Twin', source: 'up', kinds: [], description: 'Reads it — all' };
    const problems = connectorProblems([up, twin]);
    expect(problems.join('\n')).toMatch(/not kebab-case/);
    expect(problems.join('\n')).toMatch(/another connector writes source "up"/);
    expect(problems.join('\n')).toMatch(/at least one kind/);
    expect(problems.join('\n')).toMatch(/em dashes/);
  });
});
