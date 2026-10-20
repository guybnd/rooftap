'use client';

// React glue for modules.ts (.docs/modules.md). One process-wide store holds
// the household's `group_modules` rows and the modules the server offers; each
// platform's DataCacheProvider feeds it (and hydrates it from its cold-boot
// snapshot), and every surface reads it through useModules(). A plain external
// store rather than context, because web's section switcher renders outside
// DataCacheProvider.

import { useMemo, useState, useSyncExternalStore } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  availableModules,
  dependantsOf,
  isSectionEnabled,
  needsModulePicker,
  resolveEnabledModules,
  withModuleChoice,
  type GroupModuleRow,
  type ModuleDef,
  type ModuleId,
} from './modules';
import { isFeatureEnabled, type ModuleFeatureId } from './module-features';
import { missingServerFeatures, serverSupports, type ServerFeatureDef, type ServerFeatureId, type ServerSchema } from './server-features';

interface ModulesState {
  /** null = unknown (not loaded yet, or the table is missing): every offered module counts as on. */
  rows: GroupModuleRow[] | null;
  /** Modules the server offers; null = all. */
  available: string[] | null;
  /** The server's schema (server-features.ts); undefined = not known yet. */
  schema: ServerSchema;
  /** `available` minus modules newer than the server's schema, in registry order. */
  offered: ModuleDef[];
  enabled: ReadonlySet<ModuleId>;
}

function compute(rows: GroupModuleRow[] | null, available: string[] | null, schema: ServerSchema): ModulesState {
  const offered = availableModules(available, schema);
  const offeredIds = offered.map((m) => m.id);
  const enabled = rows === null ? new Set(offeredIds) : resolveEnabledModules({ available: offeredIds, rows });
  return { rows, available, schema, offered, enabled };
}

// The server render (web SSR) never knows the household, so it shows every
// module; useSyncExternalStore swaps in the client state right after hydration.
const UNKNOWN_STATE: ModulesState = compute(null, null, undefined);

let state: ModulesState = UNKNOWN_STATE;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Replace the household's switches. null = unknown (keeps every offered module on). */
export function setModuleRows(rows: GroupModuleRow[] | null): void {
  state = compute(rows, state.available, state.schema);
  emit();
}

/** Replace the list of modules the server offers. null = all. */
export function setAvailableModules(available: string[] | null): void {
  state = compute(state.rows, available, state.schema);
  emit();
}

/**
 * Record the server's schema from /api/public-config (`schemaVersion ?? null`
 * for a server that answered; null means it predates versioning). undefined
 * = not known yet.
 */
export function setServerSchema(schema: ServerSchema): void {
  state = compute(state.rows, state.available, schema);
  emit();
}

/** Apply one switch locally (optimistic write from Settings > Modules). */
export function applyModuleSwitch(row: GroupModuleRow): void {
  const rows = (state.rows ?? []).filter(
    (r) => !(r.group_id === row.group_id && r.module_id === row.module_id)
  );
  setModuleRows([...rows, row]);
}

/**
 * Owner action from Settings > Modules: flip one module for the household.
 * Applies locally at once (no Save, Hearth M4), then upserts; on failure the
 * previous state comes back and the error message is returned for a toast.
 * RLS only lets the owner write, so a member's attempt fails here too.
 */
export async function saveModuleSwitch(
  supabase: SupabaseClient,
  groupId: string,
  moduleId: ModuleId,
  enabled: boolean,
  userId: string | null,
): Promise<string | null> {
  const previous = state.rows;
  applyModuleSwitch({
    group_id: groupId,
    module_id: moduleId,
    enabled,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  });
  const { error } = await supabase
    .from('group_modules')
    .upsert({ group_id: groupId, module_id: moduleId, enabled }, { onConflict: 'group_id,module_id' });
  if (error) {
    setModuleRows(previous);
    return error.message;
  }
  return null;
}

/**
 * Owner action from the first-run module picker: one row for every offered
 * module, ticked or not, so the household has made its choice and the picker
 * doesn't come back. Applies locally at once, which closes the picker; on
 * failure the previous state comes back (reopening it) and the error message
 * is returned for a toast.
 */
export async function saveModuleChoices(
  supabase: SupabaseClient,
  groupId: string,
  chosen: ReadonlySet<ModuleId>,
  userId: string | null,
): Promise<string | null> {
  const previous = state.rows;
  const writes = state.offered.map((m) => ({
    group_id: groupId,
    module_id: m.id,
    enabled: chosen.has(m.id),
  }));
  const written = new Set<string>(writes.map((w) => w.module_id));
  const updatedAt = new Date().toISOString();
  setModuleRows([
    ...(previous ?? []).filter((r) => !(r.group_id === groupId && written.has(r.module_id))),
    ...writes.map((w) => ({ ...w, updated_by: userId, updated_at: updatedAt })),
  ]);
  const { error } = await supabase.from('group_modules').upsert(writes, { onConflict: 'group_id,module_id' });
  if (error) {
    setModuleRows(previous);
    return error.message;
  }
  return null;
}

export function getModulesSnapshot(): {
  rows: GroupModuleRow[] | null;
  available: string[] | null;
  schema: ServerSchema;
} {
  return { rows: state.rows, available: state.available, schema: state.schema };
}

/**
 * The enabled set right now, for code outside React render (event handlers
 * deciding whether to write into another module, background sync). Inside a
 * component use useModules() so the surface re-renders on a switch.
 */
export function getEnabledModules(): ReadonlySet<ModuleId> {
  return state.enabled;
}

/** Test-only: back to the unknown state. */
export function resetModulesStore(): void {
  state = UNKNOWN_STATE;
  emit();
}

export interface UseModules {
  /** Modules on for this household on this server. */
  enabled: ReadonlySet<ModuleId>;
  isEnabled: (id: ModuleId) => boolean;
  /** Sections that aren't modules (home, profile) are always enabled. */
  isSectionEnabled: (sectionId: string) => boolean;
  /** Both on: the gate for a feature that spans two modules. */
  both: (a: ModuleId, b: ModuleId) => boolean;
  /** A named cross-module feature (module-features.ts): every module it needs is on. */
  feature: (id: ModuleFeatureId) => boolean;
  /** Modules the server offers, in registry order (the Settings > Modules list). */
  offered: ModuleDef[];
  /** False until the household's switches have loaded at least once. */
  known: boolean;
  /** A feature that needs a newer server (server-features.ts): this server has it. */
  server: (id: ServerFeatureId) => boolean;
  /** What updating this self-hosted server would add; empty when it is current. */
  serverUpdateAdds: ServerFeatureDef[];
}

export function useModules(): UseModules {
  const s = useSyncExternalStore(subscribe, () => state, () => UNKNOWN_STATE);
  return useMemo(
    () => ({
      enabled: s.enabled,
      isEnabled: (id: ModuleId) => s.enabled.has(id),
      isSectionEnabled: (sectionId: string) => isSectionEnabled(sectionId, s.enabled),
      both: (a: ModuleId, b: ModuleId) => s.enabled.has(a) && s.enabled.has(b),
      feature: (id: ModuleFeatureId) => isFeatureEnabled(id, s.enabled),
      offered: s.offered,
      known: s.rows !== null,
      server: (id: ServerFeatureId) => serverSupports(id, s.schema),
      serverUpdateAdds: [
        ...availableModules(s.available, undefined)
          .filter((m) => m.minSchema && !s.offered.includes(m))
          .map((m) => ({ minSchema: m.minSchema as string, label: m.label })),
        ...missingServerFeatures(s.schema),
      ],
    }),
    [s]
  );
}


export interface UseModulePicker {
  /** Show the picker: the owner's household hasn't chosen (needsModulePicker) and it wasn't skipped this session. */
  open: boolean;
  /** Modules the server offers, in registry order. */
  offered: ModuleDef[];
  /** The ticks: the defaults until the owner changes one. */
  chosen: ReadonlySet<ModuleId>;
  /** What a household gets without choosing; Skip saves these. */
  defaults: ReadonlySet<ModuleId>;
  /** Ticked modules that need `id`, which keep it ticked (same lock as Settings > Modules). */
  lockedBy: (id: ModuleId) => ModuleDef[];
  toggle: (id: ModuleId, on: boolean) => void;
  /** Hide the picker for the rest of this session, whether or not its save lands. */
  dismiss: () => void;
}

/**
 * State for the first-run module picker (.docs/modules.md, section 8), shared
 * by the web and native screens. The ticks live here rather than in the
 * store, so they survive a failed save that reopens the picker.
 */
export function useModulePicker(input: { isOwner: boolean; pendingInvitations: number }): UseModulePicker {
  const s = useSyncExternalStore(subscribe, () => state, () => UNKNOWN_STATE);
  const [picked, setPicked] = useState<ReadonlySet<ModuleId> | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const defaults = useMemo(
    () => resolveEnabledModules({ available: s.offered.map((m) => m.id), rows: [] }),
    [s.offered]
  );
  const chosen = picked ?? defaults;
  return {
    open: !dismissed && needsModulePicker({ rows: s.rows, ...input }),
    offered: s.offered,
    chosen,
    defaults,
    lockedBy: (id) => dependantsOf(id, chosen),
    toggle: (id, on) => setPicked((prev) => withModuleChoice(prev ?? defaults, id, on)),
    dismiss: () => setDismissed(true),
  };
}
