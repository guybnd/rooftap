// The phone's binding for core's useHeroModuleConfig: the same
// `user_settings` row as web, so a toggle carries over between platforms.
import { useHeroModuleConfig as useCoreHeroModuleConfig } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';

export function useHeroModuleConfig() {
  return useCoreHeroModuleConfig(useDataCache(), getCurrentSupabaseClient);
}
