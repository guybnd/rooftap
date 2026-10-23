'use client';

// Archive and delete with Undo, for Assistant chats and Scout searches. Both
// apps call these from a row's swipe or menu and from a thread's header, so
// the words, the order of the calls and the Undo behave the same everywhere.
// An archived item leaves its list and waits under "Archived"; a deleted one
// is gone once the toast's Undo has passed. The Household thread is never
// archived or deleted: it belongs to everyone.

import { useSyncExternalStore } from 'react';
import type { AssistantApi, AssistantConversation } from './modules/assistant/assistant-api';
import { forgetThread } from './modules/assistant/assistant-thread';
import type { ShopperSearch } from './modules/shopper/shopper-scout';

/** The toast each app shows: a line with an Undo button, a plain line, and an error. */
export interface UndoToast {
  undo: (message: string, onUndo: () => void) => void;
  message: (message: string) => void;
  error: (message: string) => void;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Runs a change, then offers to take it back. `onChange` runs after the
 * change and after an Undo, so the screen reloads its list. False when the
 * change failed (the toast already said why).
 */
export async function changeWithUndo(
  toast: UndoToast,
  step: { run: () => Promise<unknown>; undo: () => Promise<unknown>; message: string; failed: string; onChange?: () => void }
): Promise<boolean> {
  try {
    await step.run();
  } catch (err) {
    toast.error(errorText(err, step.failed));
    return false;
  }
  step.onChange?.();
  toast.undo(step.message, () => {
    step.undo().then(
      () => step.onChange?.(),
      (err) => toast.error(errorText(err, 'Could not undo that.'))
    );
  });
  return true;
}

// ── Assistant chats ──────────────────────────────────────────────────────

const listeners = new Set<() => void>();

/** Calls `fn` whenever a chat is archived, restored or deleted anywhere in the app. */
export function onConversationsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function conversationsChanged(): void {
  for (const fn of [...listeners]) fn();
}

type ConversationUpdater = Pick<AssistantApi, 'updateConversation'>;

/** Whether a chat can be archived or deleted: everything but the Household thread. */
export function canArchiveConversation(c: Pick<AssistantConversation, 'kind'> | null | undefined): boolean {
  return !!c && c.kind !== 'household';
}

export function archiveConversation(api: ConversationUpdater, c: AssistantConversation, toast: UndoToast): Promise<boolean> {
  return changeWithUndo(toast, {
    run: async () => {
      await api.updateConversation(c.id, { archived: true });
      forgetThread(c.id);
    },
    undo: () => api.updateConversation(c.id, { archived: false }),
    message: 'Chat archived.',
    failed: 'Could not archive that chat.',
    onChange: conversationsChanged,
  });
}

/** Back from Archived into the list. */
export async function unarchiveConversation(api: ConversationUpdater, c: AssistantConversation, toast: UndoToast): Promise<boolean> {
  try {
    await api.updateConversation(c.id, { archived: false });
  } catch (err) {
    toast.error(errorText(err, 'Could not bring that chat back.'));
    return false;
  }
  conversationsChanged();
  toast.message('Back in your chats.');
  return true;
}

/** Deletes a chat with Undo. Servers before archiving can't take a delete back, so the app confirms first there instead. */
export function deleteConversation(api: ConversationUpdater, c: AssistantConversation, toast: UndoToast): Promise<boolean> {
  return changeWithUndo(toast, {
    run: async () => {
      await api.updateConversation(c.id, { deleted: true });
      forgetThread(c.id);
    },
    undo: () => api.updateConversation(c.id, { deleted: false }),
    message: 'Chat deleted.',
    failed: 'Could not delete that chat.',
    onChange: conversationsChanged,
  });
}

// ── Scout searches ───────────────────────────────────────────────────────

/** Each app's PATCH /api/shopper/scout/:id. */
export type ScoutRunUpdater = (id: string, patch: { archived?: boolean; deleted?: boolean }) => Promise<void>;

export function archiveScoutRun(update: ScoutRunUpdater, id: string, toast: UndoToast, onChange?: () => void): Promise<boolean> {
  return changeWithUndo(toast, {
    run: () => update(id, { archived: true }),
    undo: () => update(id, { archived: false }),
    message: 'Search archived.',
    failed: 'Could not archive that search.',
    onChange,
  });
}

export async function unarchiveScoutRun(update: ScoutRunUpdater, id: string, toast: UndoToast, onChange?: () => void): Promise<boolean> {
  try {
    await update(id, { archived: false });
  } catch (err) {
    toast.error(errorText(err, 'Could not bring that search back.'));
    return false;
  }
  onChange?.();
  toast.message('Back in Shopper.');
  return true;
}

export function deleteScoutRun(update: ScoutRunUpdater, id: string, toast: UndoToast, onChange?: () => void): Promise<boolean> {
  return changeWithUndo(toast, {
    run: () => update(id, { deleted: true }),
    undo: () => update(id, { deleted: false }),
    message: 'Search deleted.',
    failed: 'Could not delete that search.',
    onChange,
  });
}

// Scout runs reach the apps through sync, which can trail the API by a few
// seconds. A change made here shows at once through these overrides; each
// one drops away when the synced row agrees with it.
type ScoutOverride = { archived?: boolean; deleted?: boolean };
const scoutOverrides = new Map<string, ScoutOverride>();
const scoutListeners = new Set<() => void>();
let scoutVersion = 0;

/** Records a change the server took, until sync brings the row. */
export function overrideScoutRun(id: string, patch: ScoutOverride): void {
  scoutOverrides.set(id, { ...scoutOverrides.get(id), ...patch });
  scoutVersion += 1;
  for (const fn of [...scoutListeners]) fn();
}

/** Re-renders when a Scout run changes here (for the lists below). */
export function useScoutOverrides(): number {
  return useSyncExternalStore(
    (fn) => {
      scoutListeners.add(fn);
      return () => {
        scoutListeners.delete(fn);
      };
    },
    () => scoutVersion,
    () => scoutVersion
  );
}

/**
 * The household's Scout searches for Shopper's lists, newest first: the
 * first run of each thread (a refined search lives inside its thread), split
 * into the ones on show and the archived ones.
 */
export function scoutRunLists(runs: readonly (ShopperSearch | null | undefined)[]): { recent: ShopperSearch[]; archived: ShopperSearch[] } {
  const shown: ShopperSearch[] = [];
  for (const run of runs) {
    if (!run || run.thread_id) continue;
    const over = scoutOverrides.get(run.id);
    let archived = !!run.archived_at;
    let deleted = run.deleted;
    if (over) {
      // Sync caught up: the row says the same as the change made here.
      const agrees = (over.archived === undefined || over.archived === archived) && (over.deleted === undefined || over.deleted === deleted);
      if (agrees) scoutOverrides.delete(run.id);
      archived = over.archived ?? archived;
      deleted = over.deleted ?? deleted;
    }
    if (deleted) continue;
    shown.push(archived === !!run.archived_at ? run : { ...run, archived_at: archived ? new Date().toISOString() : null });
  }
  shown.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { recent: shown.filter((r) => !r.archived_at), archived: shown.filter((r) => !!r.archived_at) };
}
