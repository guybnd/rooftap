'use client';

// FLUX-253: web's binding for core's useHeroModuleConfig: the same
// `user_settings` row as the phone, so a toggle carries over between platforms.

import { useHeroModuleConfig as useCoreHeroModuleConfig } from '@homeup/core';
import { createClient } from '@/lib/supabase/client';
import { useDataCache } from '@/lib/data-cache';

export function useHeroModuleConfig() {
  return useCoreHeroModuleConfig(useDataCache(), createClient);
}
