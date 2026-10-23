'use client';

// FLUX-191: the grocery card's aisles and item library for the /groceries
// page, the Home hub widget and global search. The hook lives in core
// (modules/groceries/use-grocery-aux.ts); this binds the web client.

import { useGroceryAux as useCoreGroceryAux, type GroceryAux } from '@homeup/core';
import { createClient } from '@/lib/supabase/client';

export type { GroceryAux };

export function useGroceryAux(groupId: string | null | undefined): GroceryAux {
  return useCoreGroceryAux(groupId, createClient);
}
