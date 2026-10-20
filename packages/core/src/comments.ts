// HOUP-123: shared comment CRUD for entity-comment tables. `household_task_comments`,
// `setup_item_comments`, and `cost_item_comments` all share this exact
// (id, user_id, content, created_at, <fk>) shape — promoted out of
// apps/web/src/components/entity-comments.tsx (which was the sole implementation)
// so the mobile tasks Comments portal chip doesn't fork this logic.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface EntityComment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export interface EntityCommentsTarget {
  /** Comments table, e.g. "household_task_comments" */
  table: string;
  /** Foreign-key column on that table, e.g. "household_task_id" */
  fkColumn: string;
  /** The parent entity's id. */
  entityId: string;
}

export async function listEntityComments(
  supabase: SupabaseClient,
  target: EntityCommentsTarget
): Promise<EntityComment[]> {
  const { data } = await supabase
    .from(target.table)
    .select('*')
    .eq(target.fkColumn, target.entityId)
    .order('created_at', { ascending: false });
  return (data ?? []) as EntityComment[];
}

/** HOUP-172: a head-count query (no row bodies) — for gating a "Comments" affordance on count>0 without fetching every comment just to check it's non-empty. */
export async function countEntityComments(
  supabase: SupabaseClient,
  target: EntityCommentsTarget
): Promise<number> {
  const { count } = await supabase
    .from(target.table)
    .select('id', { count: 'exact', head: true })
    .eq(target.fkColumn, target.entityId);
  return count ?? 0;
}

/**
 * HOUP-185: the list-level sibling of `countEntityComments` — one query for
 * every entity in a list instead of a per-row head-count query each. Fetches
 * only the fk column (no row bodies, no `count: 'exact'` per row) and tallies
 * client-side, so a list of N rows costs one round trip instead of N.
 */
export async function countEntityCommentsBulk(
  supabase: SupabaseClient,
  table: string,
  fkColumn: string,
  entityIds: string[]
): Promise<Record<string, number>> {
  if (entityIds.length === 0) return {};
  const { data } = await supabase.from(table).select(fkColumn).in(fkColumn, entityIds);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as unknown as Record<string, string>[]) {
    const id = row[fkColumn];
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

export async function postEntityComment(
  supabase: SupabaseClient,
  target: EntityCommentsTarget,
  userId: string,
  content: string
): Promise<EntityComment> {
  const { data, error } = await supabase
    .from(target.table)
    .insert({ [target.fkColumn]: target.entityId, user_id: userId, content })
    .select()
    .single();
  if (error) throw error;
  return data as EntityComment;
}

export async function deleteEntityComment(
  supabase: SupabaseClient,
  table: string,
  commentId: string
): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', commentId);
  if (error) throw error;
}
