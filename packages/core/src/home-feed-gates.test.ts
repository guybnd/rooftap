import { describe, expect, it } from 'vitest';
import { homeFeedGates } from './hero';

const allOn = { feature: () => true, isEnabled: () => true };

describe('homeFeedGates', () => {
  it('shows every source with nothing hidden and every module on', () => {
    expect(Object.values(homeFeedGates([], allOn)).every(Boolean)).toBe(true);
  });

  it('drops only the sources of a hidden section', () => {
    const gates = homeFeedGates(['search', 'costs'], allOn);
    expect(gates.search).toBe(false);
    expect(gates.viewings).toBe(false);
    expect(gates.costs).toBe(false);
    expect(gates.tasks).toBe(true);
    expect(gates.documents).toBe(true);
  });

  it('follows the module features and the home-care module', () => {
    const gates = homeFeedGates([], { feature: (id) => id !== 'hub.events', isEnabled: (id) => id !== 'home-care' });
    expect(gates.events).toBe(false);
    expect(gates.care).toBe(false);
    expect(gates.tasks).toBe(true);
  });
});
