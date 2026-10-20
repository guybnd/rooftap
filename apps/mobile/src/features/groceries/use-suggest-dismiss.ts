// The X on a "Might be running low" suggestion. Runs the user's remembered
// choice (user_settings.grocery_suggest_dismiss); when none is stored yet the
// section asks once and `dismiss` saves that pick as the default. Settings >
// Groceries changes it later.
import * as React from 'react';
import { resolveGroceryDismissAction, type GroceryDismissAction, type GroceryItem } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';

export async function saveGroceryDismissAction(action: GroceryDismissAction | null) {
  try {
    const supabase = getCurrentSupabaseClient();
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
    // Offline — the local pick still applies for this session.
  }
}

export function useSuggestDismiss(opts: {
  /** "Not now": hide the suggestion for this have-it stint (with its Undo pill). */
  hide: (item: GroceryItem) => void;
  archive: (item: GroceryItem) => void;
}) {
  const { userSettings, refresh } = useDataCache();
  // Local override so the remembered pick applies on the very next tap,
  // before the settings refresh lands.
  const [picked, setPicked] = React.useState<GroceryDismissAction | null>(null);
  const dismissAction = picked ?? resolveGroceryDismissAction(userSettings?.grocery_suggest_dismiss);

  const dismiss = (item: GroceryItem, action: GroceryDismissAction) => {
    if (action === 'archive') opts.archive(item);
    else opts.hide(item);
    if (!dismissAction) {
      setPicked(action);
      void saveGroceryDismissAction(action).then(() => refresh());
    }
  };

  return { dismissAction, dismiss };
}
