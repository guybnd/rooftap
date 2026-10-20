'use client';

// HOUP-123: shared load/add/delete state for an EntityComments surface —
// optimistic insert with rollback-on-failure, optimistic delete with
// restore-on-failure. Both apps/web's entity-comments.tsx (tasks/setup/costs)
// and the new native @homeup/ui EntityComments call this hook so the two
// platforms never fork the comment-state logic, only the markup.

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listEntityComments,
  postEntityComment,
  deleteEntityComment,
  countEntityComments,
  countEntityCommentsBulk,
} from '../comments';
import type { EntityComment, EntityCommentsTarget } from '../comments';
import { envRandomUUID } from './store-environment';

export interface UseEntityCommentsResult {
  comments: EntityComment[];
  loading: boolean;
  submitting: boolean;
  error: string | null;
  /** Resolves true on success, false on failure (caller decides whether to restore input text). */
  addComment: (content: string) => Promise<boolean>;
  removeComment: (commentId: string) => Promise<void>;
}

export function useEntityComments(
  supabase: SupabaseClient,
  target: EntityCommentsTarget,
  currentUserId: string | null | undefined,
  onChanged?: () => void
): UseEntityCommentsResult {
  const [comments, setComments] = useState<EntityComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listEntityComments(supabase, target).then((rows) => {
      if (cancelled) return;
      setComments(rows);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, target.table, target.fkColumn, target.entityId]);

  const addComment = useCallback(
    async (content: string): Promise<boolean> => {
      const trimmed = content.trim();
      if (!trimmed || !currentUserId) return false;

      setSubmitting(true);
      setError(null);
      const optimistic: EntityComment = {
        id: envRandomUUID(),
        user_id: currentUserId,
        content: trimmed,
        created_at: new Date().toISOString(),
      };
      setComments((prev) => [optimistic, ...prev]);

      try {
        const saved = await postEntityComment(supabase, target, currentUserId, trimmed);
        setComments((prev) => prev.map((c) => (c.id === optimistic.id ? saved : c)));
        onChanged?.();
        return true;
      } catch {
        setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
        setError('Failed to post comment. Please try again.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [supabase, target, currentUserId, onChanged]
  );

  const removeComment = useCallback(
    async (commentId: string) => {
      const prev = comments;
      setComments((c) => c.filter((x) => x.id !== commentId));
      try {
        await deleteEntityComment(supabase, target.table, commentId);
        onChanged?.();
      } catch {
        setComments(prev);
      }
    },
    [supabase, target.table, comments, onChanged]
  );

  return { comments, loading, submitting, error, addComment, removeComment };
}

export interface UseEntityCommentCountResult {
  count: number;
  loading: boolean;
  /** Re-fetch (e.g. after the full comment list changes underneath). */
  refresh: () => void;
}

/**
 * HOUP-172: a lightweight head-count for a "Comments" affordance that should
 * only show once a row actually has comments — a count query, not the full
 * `useEntityComments` load, so a list of rows doesn't each pull every
 * comment body just to decide whether to render a chip.
 */
export function useEntityCommentCount(
  supabase: SupabaseClient,
  target: EntityCommentsTarget
): UseEntityCommentCountResult {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    countEntityComments(supabase, target).then((n) => {
      if (cancelled) return;
      setCount(n);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, target.table, target.fkColumn, target.entityId, refreshToken]);

  return { count, loading, refresh: () => setRefreshToken((t) => t + 1) };
}

export interface UseEntityCommentCountsResult {
  /** entityId -> comment count (absent id means 0, not "not loaded yet"). */
  counts: Record<string, number>;
  loading: boolean;
  /** Re-fetch (e.g. after a row's expanded panel adds/removes a comment). */
  refresh: () => void;
}

/**
 * HOUP-185: the list-level sibling of `useEntityCommentCount` — one bulk
 * query for every row a list renders, instead of each `TaskRow` firing its
 * own head-count query on mount (N rows -> N parallel queries on a
 * non-virtualized list). The list owns this hook and passes `counts[row.id]
 * ?? 0` down to each row, along with `refresh` for after a comment is
 * added/removed in a row's expanded panel.
 */
export function useEntityCommentCounts(
  supabase: SupabaseClient,
  table: string,
  fkColumn: string,
  entityIds: string[]
): UseEntityCommentCountsResult {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const idsKey = entityIds.join(',');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    countEntityCommentsBulk(supabase, table, fkColumn, entityIds).then((c) => {
      if (cancelled) return;
      setCounts(c);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, table, fkColumn, idsKey, refreshToken]);

  return { counts, loading, refresh: () => setRefreshToken((t) => t + 1) };
}
