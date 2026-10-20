// `setup_stores` data access, shared by both apps' setup-stores settings panel
// and store-select picker, which used to query the table inline. Stores stay
// a plain Supabase entity (no Legend store): they're small and only edited
// from these two surfaces.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SetupStore } from '../types';

export interface SetupStoreFields {
  name: string;
  url?: string | null;
  address?: string | null;
}

// Blank optional fields are stored as null, not ''.
function storeColumns(fields: SetupStoreFields) {
  return {
    name: fields.name,
    url: fields.url?.trim() || null,
    address: fields.address?.trim() || null,
  };
}

/** The group's stores, alphabetical. */
export async function listSetupStores(supabase: SupabaseClient, groupId: string): Promise<SetupStore[]> {
  const { data } = await supabase
    .from('setup_stores')
    .select('*')
    .eq('group_id', groupId)
    .order('name', { ascending: true });
  return (data as SetupStore[]) ?? [];
}

/** Create a store owned by the signed-in user. Throws on a failed insert. */
export async function createSetupStore(
  supabase: SupabaseClient,
  groupId: string,
  fields: SetupStoreFields,
): Promise<SetupStore> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('setup_stores')
    .insert({ group_id: groupId, ...storeColumns(fields), created_by: user?.id })
    .select()
    .single();
  if (error) throw error;
  return data as SetupStore;
}

export async function updateSetupStore(supabase: SupabaseClient, id: string, fields: SetupStoreFields): Promise<void> {
  await supabase.from('setup_stores').update(storeColumns(fields)).eq('id', id);
}

export async function deleteSetupStore(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from('setup_stores').delete().eq('id', id);
}
