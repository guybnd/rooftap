'use client';

import { useCallback, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

export type GroupRow = { [key: string]: unknown };
export type GroupRowPayload = RealtimePostgresChangesPayload<GroupRow>;

interface Options {
  /** Postgres table name, e.g. 'grocery_items'. Must be in the supabase_realtime publication. */
  table: string;
  /** Group to scope the subscription to. Subscription is inert until this is set. */
  groupId: string | null | undefined;
  /** Set false to temporarily disable (e.g. while a section is hidden). Defaults true. */
  enabled?: boolean;
  /** Called for every insert/update/delete on `table` for rows in this group. */
  onChange: (payload: GroupRowPayload) => void;
}

// HOUP-258: monotonic suffix that makes every subscription's topic unique.
// `RealtimeClient.channel(topic)` dedupes by topic and hands back an ALREADY
// SUBSCRIBED channel when one with that topic is still registered, while
// `removeChannel()` is async (it awaits `unsubscribe()` before `teardown()`
// drops it from the registry). A component that unmounts and remounts faster
// than that teardown resolves gets the live channel back, and
// `.on('postgres_changes', …)` throws on a joined channel ("cannot add
// `postgres_changes` callbacks … after `subscribe()`"). Native hit this for real
// via react-freeze page swaps; on web the same race is reachable through
// StrictMode's double-effect and fast route remounts, so both copies of this
// hook carry the fix. It also stops two components on the same (table, groupId)
// from sharing one channel, where whichever unmounted first killed the other's
// subscription.
let subscriptionSeq = 0;

/**
 * Subscribe to realtime row changes on a group-scoped table.
 *
 * One channel per hook instance (topic suffixed with a process-unique id),
 * filtered server-side by `group_id` and additionally constrained by RLS
 * (members only receive rows they can read). The channel is torn down on
 * unmount or when table/groupId/enabled changes.
 *
 * The latest `onChange` is kept in a ref so passing a fresh closure each render
 * does NOT resubscribe — only table/groupId/enabled drive (re)subscription.
 *
 * Note: group-filtered DELETE events require the table to have
 * `replica identity full` so the old row still carries `group_id`.
 */
export function useGroupTableRealtime({ table, groupId, enabled = true, onChange }: Options): void {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });

  useEffect(() => {
    if (!enabled || !groupId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`rt:${table}:${groupId}:${++subscriptionSeq}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `group_id=eq.${groupId}` },
        (payload) => cb.current(payload as GroupRowPayload),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, groupId, enabled]);
}

interface RefetchOptions {
  table: string;
  groupId: string | null | undefined;
  enabled?: boolean;
  /** Called (debounced) whenever a group row on `table` changes. */
  refetch: () => void;
  /** Coalesce bursts of events into one refetch. Defaults to 350ms. */
  debounceMs?: number;
}

/**
 * Convenience wrapper over `useGroupTableRealtime` for pages that already have a
 * single fetch function: on any group row change, schedule a debounced refetch.
 *
 * Refetching (vs. fine-grained id reconciliation) keeps the page's existing
 * filters (e.g. mine-only) and derived data correct, and reuses the fetch's own
 * section-cache write so the offline cache stays fresh. The latest `refetch` is
 * kept in a ref, so a fresh closure each render neither resubscribes nor leaks a
 * stale fetch. The debounce timer is cleared on unmount.
 */
export function useGroupTableRefetch({
  table,
  groupId,
  enabled = true,
  refetch,
  debounceMs = 350,
}: RefetchOptions): void {
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      refetchRef.current();
    }, debounceMs);
  }, [debounceMs]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useGroupTableRealtime({ table, groupId, enabled, onChange: schedule });
}
