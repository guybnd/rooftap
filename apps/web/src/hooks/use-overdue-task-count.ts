'use client';

// FLUX-60: Count of overdue household tasks for the current group, for the
// section nav badge. The sidebar renders outside DataCacheProvider, so this hook
// fetches independently. It stays fresh via three signals: Supabase realtime
// (when the table is enabled in the publication), window focus, and a
// `household-tasks-changed` event the tasks page dispatches after mutations
// (covers same-tab edits even if realtime isn't enabled for the table).

import { useEffect, useState } from 'react';
import { isStoreSynced, isTaskOwnerEnabled, useModules } from '@homeup/core';
import { createClient } from '@/lib/supabase/client';
import { todayISO } from '@/app/tasks/moving-tasks';

export const HOUSEHOLD_TASKS_CHANGED_EVENT = 'household-tasks-changed';

export function useOverdueTaskCount(): number {
  const [overdue, setOverdue] = useState<{ template_key: string | null }[]>([]);
  // Modules: a bill or document reminder counts only while its owning module
  // is on (task-modules.ts), so the rows' template keys come back, not a count.
  const { enabled } = useModules();
  // With Tasks, Costs and Documents all off nothing can be overdue: no query, no channel.
  const tasksSynced = isStoreSynced('household_tasks', enabled);

  useEffect(() => {
    if (!tasksSynced) {
      setOverdue([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;
    let groupId: string | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    // Tasks with a null due_date are excluded by `.lt` (correct — no date = not overdue).
    const recount = async () => {
      if (!groupId) return;
      const { data } = await supabase
        .from('household_tasks')
        .select('template_key')
        .eq('group_id', groupId)
        .eq('done', false)
        .lt('due_date', todayISO());
      if (!cancelled) setOverdue(data ?? []);
    };

    const onFocus = () => recount();
    const onChanged = () => recount();

    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: membership } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (!membership || cancelled) return;

      groupId = membership.group_id as string;
      await recount();

      window.addEventListener('focus', onFocus);
      window.addEventListener(HOUSEHOLD_TASKS_CHANGED_EVENT, onChanged);

      channel = supabase
        .channel('overdue-task-count')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'household_tasks', filter: `group_id=eq.${groupId}` },
          () => recount()
        )
        .subscribe();
    };

    load();

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(HOUSEHOLD_TASKS_CHANGED_EVENT, onChanged);
      if (channel) supabase.removeChannel(channel);
    };
  }, [tasksSynced]);

  return overdue.filter((t) => isTaskOwnerEnabled(t, enabled)).length;
}
