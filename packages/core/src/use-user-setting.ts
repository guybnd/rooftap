'use client';

// One user_settings value for a settings panel, shared by both apps. The panel
// shows the change at once, saves it through the app's Supabase client and
// reloads the app's settings cache, so the module screen behind the sheet
// reads the new value from the same row (module-settings.ts).

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveUserSettings } from './module-settings';
import type { UserSettings } from './types';

export interface UserSettingSaver {
  /** The app's Supabase client. */
  client: () => SupabaseClient;
  /** Reloads the app's settings cache after a save. */
  refresh: () => void | Promise<void>;
}

/** Saves a patch to user_settings and reloads the cache. */
export function useSaveUserSettings({ client, refresh }: UserSettingSaver) {
  return useCallback(
    async (patch: Partial<UserSettings>) => {
      const ok = await saveUserSettings(client(), patch);
      if (ok) await refresh();
      return ok;
    },
    [client, refresh],
  );
}

/**
 * A user_settings column as local state: `stored` is what the cache holds,
 * `set` shows the new value now and saves it. `canSave` false (an older
 * server without the column) keeps the change for this visit only.
 */
export function useUserSetting<K extends keyof UserSettings>(
  key: K,
  stored: UserSettings[K] | undefined,
  saver: UserSettingSaver,
  canSave = true,
): [UserSettings[K] | undefined, (next: UserSettings[K]) => void] {
  const [value, setValue] = useState(stored);
  useEffect(() => setValue(stored), [stored]);
  const save = useSaveUserSettings(saver);
  const set = useCallback(
    (next: UserSettings[K]) => {
      setValue(next);
      if (canSave) void save({ [key]: next } as Partial<UserSettings>);
    },
    [key, save, canSave],
  );
  return [value, set];
}
