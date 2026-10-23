// HOUP-80: the grocery card's aisles and item library for the Groceries tab
// and the Home widget. The hook lives in core
// (modules/groceries/use-grocery-aux.ts); this binds the native client.
import { useGroceryAux as useCoreGroceryAux, type GroceryAux } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';

export type { GroceryAux };

export function useGroceryAux(groupId: string | null | undefined): GroceryAux {
  return useCoreGroceryAux(groupId, getCurrentSupabaseClient);
}
