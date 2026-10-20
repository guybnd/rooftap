'use client';

// The X on a "Might be running low" suggestion. Runs the user's remembered
// choice (user_settings.grocery_suggest_dismiss); when none is stored yet the
// row's DismissMenu asks once and `dismiss` saves that pick as the default.
// Settings > Groceries changes it later. Mirrors
// apps/mobile/src/features/groceries/use-suggest-dismiss.ts.
import { useState } from 'react';
import { resolveGroceryDismissAction, type GroceryDismissAction, type GroceryItem } from '@homeup/core';
import { createClient } from '@/lib/supabase/client';
import { useDataCache } from '@/lib/data-cache';

export function useSuggestDismiss(opts: {
  /** "Not now": hide the suggestion for this have-it stint (with its Undo pill). */
  hide: (item: GroceryItem) => void;
  archive: (item: GroceryItem) => void;
}) {
  const { userSettings, refresh } = useDataCache();
  // Local override so the remembered pick applies on the very next click,
  // before the settings refresh lands.
  const [picked, setPicked] = useState<GroceryDismissAction | null>(null);
  const dismissAction = picked ?? resolveGroceryDismissAction(userSettings?.grocery_suggest_dismiss);

  const dismiss = (item: GroceryItem, action: GroceryDismissAction) => {
    if (action === 'archive') opts.archive(item);
    else opts.hide(item);
    if (!dismissAction) {
      setPicked(action);
      void (async () => {
        try {
          const supabase = createClient();
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          await supabase
            .from('user_settings')
            .upsert(
              { user_id: user.id, grocery_suggest_dismiss: action, updated_at: new Date().toISOString() },
              { onConflict: 'user_id' },
            );
          refresh();
        } catch {
          /* offline — the local pick still applies for this session */
        }
      })();
    }
  };

  return { dismissAction, dismiss };
}
