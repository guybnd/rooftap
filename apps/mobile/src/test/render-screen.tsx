// Renders a real phone screen on react-native-web with the rows a test picks,
// then waits for the stores to load them.
import * as React from 'react';
import { act, render } from '@testing-library/react';
import { setModuleRows } from '@homeup/core';
import { fakeSupabase, type Tables } from './fake-supabase';
import { screenState } from './screen-state';
// Configures the store environment (mocked in screen-setup.tsx) before any store is read.
import '@/lib/legend/environment';

let groups = 0;

export async function renderScreen(Screen: React.ComponentType, opts: { tables?: Tables; modules?: string[] } = {}) {
  // A new household per render: stores are cached per group, so no rows leak between tests.
  screenState.groupId = `group-${++groups}`;
  const tables = withGroup(opts.tables ?? {}, screenState.groupId);
  screenState.tables = tables;
  screenState.supabase = fakeSupabase(tables);
  setModuleRows((opts.modules ?? []).map((module_id) => ({ group_id: screenState.groupId, module_id, enabled: true })) as never);
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => errors.push(e.error);
  window.addEventListener('error', onError);
  const result = render(<Screen />);
  // Let the stores' first pull resolve and the screen settle.
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  window.removeEventListener('error', onError);
  return { ...result, text: () => result.container.textContent ?? '', errors };
}

function withGroup(tables: Tables, groupId: string): Tables {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of Object.entries(tables)) {
    out[name] = rows.map((r) => ({ group_id: groupId, deleted: false, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...r }));
  }
  return out;
}
