'use client';

// The X on a "Might be running low" suggestion, shared by both apps' Groceries
// screens. It runs the user's remembered choice
// (user_settings.grocery_suggest_dismiss). When none is stored yet, the screen
// asks once and `dismiss` saves that pick as the default. Settings > Groceries
// changes it later. Each app passes its stored setting, its settings refresh
// and its Supabase client getter.

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GroceryItem } from '../../types';
import { resolveGroceryDismissAction, type GroceryDismissAction } from './grocery-dismiss';

/** Saves the pick to user_settings. Offline it does nothing; the local pick still applies for the session. */
export async function saveGroceryDismissAction(supabase: SupabaseClient, action: GroceryDismissAction | null) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('user_settings')
      .upsert(
        { user_id: user.id, grocery_suggest_dismiss: action, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
  } catch {
    // Offline: the local pick still applies for this session.
  }
}

export function useSuggestDismiss(opts: {
  /** "Not now": hide the suggestion for this have-it stint (with its Undo pill). */
  hide: (item: GroceryItem) => void;
  archive: (item: GroceryItem) => void;
  /** user_settings.grocery_suggest_dismiss as the app's settings cache holds it. */
  stored: string | null | undefined;
  /** Reloads the app's settings cache after the save. */
  refresh: () => void;
  getClient: () => SupabaseClient;
}) {
  // Local override so the remembered pick applies on the very next tap,
  // before the settings refresh lands.
  const [picked, setPicked] = useState<GroceryDismissAction | null>(null);
  const dismissAction = picked ?? resolveGroceryDismissAction(opts.stored);

  const dismiss = (item: GroceryItem, action: GroceryDismissAction) => {
    if (action === 'archive') opts.archive(item);
    else opts.hide(item);
    if (!dismissAction) {
      setPicked(action);
      void (async () => {
        try {
          await saveGroceryDismissAction(opts.getClient(), action);
        } catch {
          // The client isn't bound yet: the local pick still applies.
          return;
        }
        opts.refresh();
      })();
    }
  };

  return { dismissAction, dismiss };
}
