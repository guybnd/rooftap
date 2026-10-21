// @vitest-environment jsdom

// Modules (.docs/modules.md): the store every surface reads through
// useModules(). Covers the states a household can be in (unknown, loaded,
// limited by the server) and the owner's switch: applied at once, written
// with the right upsert, and rolled back when the write is refused.

import { act, renderHook } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_MODULE_IDS, MODULES, type GroupModuleRow } from './modules';
import {
  getEnabledModules,
  getModulesSnapshot,
  resetModulesStore,
  saveModuleChoices,
  saveModuleSwitch,
  setAvailableModules,
  setModuleRows,
  setServerSchema,
  useModulePicker,
  useModules,
} from './modules-store';

function row(module_id: string, enabled: boolean): GroupModuleRow {
  return { group_id: 'g1', module_id, enabled, updated_by: null, updated_at: '2026-10-18T00:00:00.000Z' };
}

/** A Supabase client whose group_modules upsert resolves with `error`, released on demand. */
function fakeClient(error: { message: string } | null = null) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const upsert = vi.fn(async () => {
    await gate;
    return { error };
  });
  const from = vi.fn(() => ({ upsert }));
  return { client: { from } as unknown as SupabaseClient, from, upsert, release };
}

afterEach(() => {
  resetModulesStore();
});

describe('useModules', () => {
  it('treats an unknown household as every module on, so nothing vanishes before the first load', () => {
    const { result } = renderHook(() => useModules());
    expect(result.current.known).toBe(false);
    expect([...result.current.enabled].sort()).toEqual([...ALL_MODULE_IDS].sort());
    expect(result.current.isSectionEnabled('home')).toBe(true);
  });

  it('follows the household rows once loaded, with defaults for modules that have none', () => {
    const { result } = renderHook(() => useModules());
    act(() => setModuleRows([row('groceries', true), row('calendar', false)]));
    expect(result.current.known).toBe(true);
    expect(result.current.isEnabled('groceries')).toBe(true);
    expect(result.current.isEnabled('calendar')).toBe(false);
    expect(result.current.isEnabled('household')).toBe(true); // default on
    expect(result.current.isEnabled('search')).toBe(false); // default off
    expect(result.current.isSectionEnabled('calendar')).toBe(false);
    expect(result.current.both('household', 'groceries')).toBe(true);
    expect(result.current.both('household', 'calendar')).toBe(false);
  });

  it('only offers, and only enables, what the server offers', () => {
    const { result } = renderHook(() => useModules());
    act(() => {
      setAvailableModules(['household', 'groceries']);
      setModuleRows([row('groceries', true), row('recipes', true)]);
    });
    expect(result.current.offered.map((m) => m.id)).toEqual(['household', 'groceries']);
    expect([...result.current.enabled].sort()).toEqual(['groceries', 'household']);
  });

  it('a server limit applies even while the household is unknown', () => {
    const { result } = renderHook(() => useModules());
    act(() => setAvailableModules(['household']));
    expect([...result.current.enabled]).toEqual(['household']);
  });

  it('answers named cross-module features, and outside React through getEnabledModules', () => {
    const { result } = renderHook(() => useModules());
    act(() => setModuleRows([row('groceries', true), row('recipes', false)]));
    expect(result.current.feature('costs.from-groceries')).toBe(false); // costs defaults off
    expect(result.current.feature('recipes.groceries')).toBe(false);
    act(() => setModuleRows([row('groceries', true), row('recipes', true)]));
    expect(result.current.feature('recipes.groceries')).toBe(true);
    expect(getEnabledModules().has('recipes')).toBe(true);
  });

  it('goes back to unknown (all offered on) when the household is cleared, e.g. on sign-out', () => {
    const { result } = renderHook(() => useModules());
    act(() => setModuleRows([row('household', false)]));
    expect(result.current.isEnabled('household')).toBe(false);
    act(() => setModuleRows(null));
    expect(result.current.known).toBe(false);
    expect(result.current.isEnabled('household')).toBe(true);
  });
});

describe('saveModuleSwitch', () => {
  it('applies the switch before the write lands, then keeps it', async () => {
    setModuleRows([]);
    const { client, from, upsert, release } = fakeClient();
    const { result } = renderHook(() => useModules());

    let saved!: Promise<string | null>;
    act(() => {
      saved = saveModuleSwitch(client, 'g1', 'groceries', true, 'u1');
    });
    expect(result.current.isEnabled('groceries')).toBe(true);

    release();
    await act(async () => {
      expect(await saved).toBeNull();
    });
    expect(result.current.isEnabled('groceries')).toBe(true);
    expect(from).toHaveBeenCalledWith('group_modules');
    expect(upsert).toHaveBeenCalledWith(
      { group_id: 'g1', module_id: 'groceries', enabled: true },
      { onConflict: 'group_id,module_id' }
    );
  });

  it('rolls back and returns the error when the write is refused (a member, or offline)', async () => {
    setModuleRows([row('groceries', true)]);
    const { client, release } = fakeClient({ message: 'new row violates row-level security policy' });
    const { result } = renderHook(() => useModules());

    let saved!: Promise<string | null>;
    act(() => {
      saved = saveModuleSwitch(client, 'g1', 'groceries', false, 'u1');
    });
    expect(result.current.isEnabled('groceries')).toBe(false);

    release();
    await act(async () => {
      expect(await saved).toMatch(/row-level security/);
    });
    expect(result.current.isEnabled('groceries')).toBe(true);
    expect(getModulesSnapshot().rows).toEqual([row('groceries', true)]);
  });

  it('a refused write while the household is still unknown leaves every module on', async () => {
    const { client, release } = fakeClient({ message: 'offline' });
    let saved!: Promise<string | null>;
    act(() => {
      saved = saveModuleSwitch(client, 'g1', 'household', false, 'u1');
    });
    release();
    await act(async () => {
      await saved;
    });
    expect(getModulesSnapshot().rows).toBeNull();
  });

  it('switch off then Undo ends with the module on', async () => {
    setModuleRows([]);
    const off = fakeClient();
    const undo = fakeClient();
    const { result } = renderHook(() => useModules());

    let first!: Promise<string | null>;
    let second!: Promise<string | null>;
    act(() => {
      first = saveModuleSwitch(off.client, 'g1', 'household', false, 'u1');
    });
    expect(result.current.isEnabled('household')).toBe(false);
    act(() => {
      second = saveModuleSwitch(undo.client, 'g1', 'household', true, 'u1');
    });
    off.release();
    undo.release();
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(result.current.isEnabled('household')).toBe(true);
    expect(getModulesSnapshot().rows?.filter((r) => r.module_id === 'household')).toHaveLength(1);
  });
});

describe('saveModuleChoices', () => {
  it('writes one row per offered module, ticked or not, and applies them before the write lands', async () => {
    setAvailableModules(['household', 'calendar', 'groceries']);
    setModuleRows([]);
    const { client, upsert, release } = fakeClient();
    const { result } = renderHook(() => useModules());

    let saved!: Promise<string | null>;
    act(() => {
      saved = saveModuleChoices(client, 'g1', new Set(['household', 'groceries']), 'u1');
    });
    expect([...result.current.enabled].sort()).toEqual(['groceries', 'household']);

    release();
    await act(async () => {
      expect(await saved).toBeNull();
    });
    expect(upsert).toHaveBeenCalledWith(
      [
        { group_id: 'g1', module_id: 'household', enabled: true },
        { group_id: 'g1', module_id: 'calendar', enabled: false },
        { group_id: 'g1', module_id: 'groceries', enabled: true },
      ],
      { onConflict: 'group_id,module_id' }
    );
    expect(getModulesSnapshot().rows).toHaveLength(3);
  });

  it('rolls back to no rows when the write is refused, so the picker comes back', async () => {
    setModuleRows([]);
    const { client, release } = fakeClient({ message: 'offline' });
    let saved!: Promise<string | null>;
    act(() => {
      saved = saveModuleChoices(client, 'g1', new Set(['household']), 'u1');
    });
    expect(getModulesSnapshot().rows).toHaveLength(MODULES.length);
    release();
    await act(async () => {
      expect(await saved).toBe('offline');
    });
    expect(getModulesSnapshot().rows).toEqual([]);
  });
});

describe('useModulePicker', () => {
  const owner = { isOwner: true, pendingInvitations: 0 };
  const defaults = MODULES.filter((m) => m.defaultEnabled).map((m) => m.id).sort();

  it('opens for the owner of a household with no rows, with the defaults ticked', () => {
    setModuleRows([]);
    const { result } = renderHook(() => useModulePicker(owner));
    expect(result.current.open).toBe(true);
    expect([...result.current.chosen].sort()).toEqual(defaults);
    expect([...result.current.defaults].sort()).toEqual(defaults);
  });

  it('stays shut while the household is unknown or has made its choice', () => {
    const { result } = renderHook(() => useModulePicker(owner));
    expect(result.current.open).toBe(false);
    act(() => setModuleRows([row('household', true)]));
    expect(result.current.open).toBe(false);
  });

  it('only ticks and offers what the server offers', () => {
    setAvailableModules(['household', 'groceries']);
    setModuleRows([]);
    const { result } = renderHook(() => useModulePicker(owner));
    expect(result.current.offered.map((m) => m.id)).toEqual(['household', 'groceries']);
    expect([...result.current.chosen]).toEqual(['household']);
  });

  it('toggles a tick, and locks Calendar while Google Calendar is ticked', () => {
    setModuleRows([]);
    const { result } = renderHook(() => useModulePicker(owner));
    act(() => result.current.toggle('google-calendar', true));
    expect(result.current.chosen.has('google-calendar')).toBe(true);
    expect(result.current.lockedBy('calendar').map((m) => m.id)).toEqual(['google-calendar']);
    act(() => result.current.toggle('household', false));
    expect(result.current.chosen.has('household')).toBe(false);
    expect([...result.current.defaults].sort()).toEqual(defaults);
  });

  it('dismiss hides it for the session', () => {
    setModuleRows([]);
    const { result } = renderHook(() => useModulePicker(owner));
    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);
  });

  it('keeps the ticks through a refused save that reopens it', async () => {
    setModuleRows([]);
    const { result } = renderHook(() => useModulePicker(owner));
    act(() => result.current.toggle('groceries', true));
    const { client, release } = fakeClient({ message: 'offline' });
    let saved!: Promise<string | null>;
    act(() => {
      saved = saveModuleChoices(client, 'g1', result.current.chosen, 'u1');
    });
    expect(result.current.open).toBe(false);
    release();
    await act(async () => {
      await saved;
    });
    expect(result.current.open).toBe(true);
    expect(result.current.chosen.has('groceries')).toBe(true);
  });
});

describe('server schema', () => {
  it('hides a feature the server is too old for, and lists it as what updating adds', () => {
    const { result } = renderHook(() => useModules());
    expect(result.current.server('mcp.connected-apps')).toBe(true);
    expect(result.current.serverUpdateAdds).toEqual([]);

    act(() => setServerSchema(null));
    expect(result.current.server('mcp.connected-apps')).toBe(false);
    // Shopper is a module newer than the baseline, so it is listed too.
    expect(result.current.serverUpdateAdds.map((f) => f.label)).toEqual(['Shopper', 'connecting AI assistants by signing in']);

    act(() => setServerSchema('20261020050000_mcp_oauth'));
    expect(result.current.server('mcp.connected-apps')).toBe(true);
    expect(getModulesSnapshot().schema).toBe('20261020050000_mcp_oauth');
  });

  it('drops a module newer than the server from the offered list, like one the server does not offer', () => {
    const mcp = MODULES.find((m) => m.id === 'mcp')!;
    mcp.minSchema = '20991231000000_future';
    try {
      const { result } = renderHook(() => useModules());
      act(() => setModuleRows([row('mcp', true)]));
      expect(result.current.isEnabled('mcp')).toBe(true);

      act(() => setServerSchema('20261020050000_mcp_oauth'));
      expect(result.current.isEnabled('mcp')).toBe(false);
      expect(result.current.offered.some((m) => m.id === 'mcp')).toBe(false);
      expect(result.current.serverUpdateAdds.map((f) => f.label)).toEqual(['Shopper', 'AI assistants (MCP)']);
    } finally {
      delete mcp.minSchema;
    }
  });
});
