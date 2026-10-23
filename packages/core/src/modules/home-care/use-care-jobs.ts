'use client';

// Home care: the Care view's data and actions, shared by web and mobile so
// the two screens only differ in how they draw it.

import { useCallback, useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { careJobs$ } from '../../data/stores/care-jobs-store';
import { useReconnectSync, useStoreHelpers } from '../../data/create-group-store';
import { useStoreLoaded } from '../../data/use-store-loaded';
import { envRandomUUID } from '../../data/store-environment';
import { todayISO } from '../../date-utils';
import {
  careDonePatch,
  careJobFromSuggestion,
  careSkipPatch,
  careSnoozePatch,
  careStatePatch,
  careUndoDonePatch,
  isSouthernHemisphere,
  liveCareJobs,
  newCareJobFields,
  type CareJob,
  type CareJobState,
  type CareSuggestion,
} from './home-care';

/** The fields the job editor saves. */
export type CareJobEdit = Pick<
  CareJob,
  | 'title'
  | 'area'
  | 'room'
  | 'every_n'
  | 'every_unit'
  | 'season_month'
  | 'next_due'
  | 'assigned_to'
  | 'remind'
  | 'remind_days_before'
  | 'notes'
>;

export function useCareJobs(groupId: string | null | undefined, currentUserId: string | null | undefined, region: string | null | undefined) {
  const store$ = careJobs$(groupId);
  useReconnectSync(store$);
  const loaded = useStoreLoaded(store$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(store$, currentUserId);
  const southern = isSouthernHemisphere(region);

  const raw = use$(() => Object.values(store$.get() ?? {}));
  const jobs = useMemo(() => liveCareJobs(raw as CareJob[]), [raw]);

  const insert = useCallback(
    (fields: ReturnType<typeof newCareJobFields>): string => {
      if (!groupId) return '';
      const id = envRandomUUID();
      writeRow({
        ...fields,
        id,
        group_id: groupId,
        created_by: currentUserId ?? null,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
        deleted: false,
      });
      return id;
    },
    [groupId, currentUserId, writeRow],
  );

  /** Save the picker: ticked suggestions become jobs, and areas marked "not for us" become hidden ones. */
  const addSuggestions = useCallback(
    (picked: readonly CareSuggestion[], hidden: readonly CareSuggestion[] = []) => {
      const today = todayISO();
      for (const s of picked) insert(careJobFromSuggestion(s, southern, today));
      for (const s of hidden) insert(careJobFromSuggestion(s, southern, today, 'hidden'));
    },
    [insert, southern],
  );

  const addJob = useCallback(
    (edit: CareJobEdit): string => {
      const fields = newCareJobFields(
        {
          title: edit.title,
          area: edit.area,
          room: edit.room,
          every_n: edit.every_n,
          every_unit: edit.every_unit,
          season_month: edit.season_month,
        },
        todayISO(),
      );
      return insert({
        ...fields,
        next_due: edit.next_due ?? fields.next_due,
        assigned_to: edit.assigned_to,
        remind: edit.remind,
        remind_days_before: edit.remind_days_before,
        notes: edit.notes?.trim() || null,
      });
    },
    [insert],
  );

  const saveJob = useCallback(
    (id: string, edit: CareJobEdit) => {
      patchRow(id, { ...edit, title: edit.title.trim(), room: edit.room?.trim() || null, notes: edit.notes?.trim() || null });
    },
    [patchRow],
  );

  const byId = useCallback((id: string) => jobs.find((j) => j.id === id), [jobs]);

  const markDone = useCallback(
    (id: string, doneISO: string = todayISO()) => {
      const job = byId(id);
      if (job) patchRow(id, careDonePatch(job, doneISO, currentUserId ?? null));
    },
    [byId, patchRow, currentUserId],
  );

  const undoDone = useCallback(
    (id: string) => {
      const job = byId(id);
      const patch = job ? careUndoDonePatch(job) : null;
      if (patch) patchRow(id, patch);
    },
    [byId, patchRow],
  );

  const skip = useCallback(
    (id: string) => {
      const job = byId(id);
      if (job) patchRow(id, careSkipPatch(job, todayISO()));
    },
    [byId, patchRow],
  );

  const snooze = useCallback(
    (id: string, days: number) => {
      const job = byId(id);
      if (job) patchRow(id, careSnoozePatch(job, todayISO(), days));
    },
    [byId, patchRow],
  );

  const setState = useCallback(
    (id: string, state: CareJobState) => {
      const job = byId(id);
      if (job) patchRow(id, careStatePatch(job, state, todayISO()));
    },
    [byId, patchRow],
  );

  const remove = useCallback((id: string) => softDeleteRow(id), [softDeleteRow]);

  return { jobs, loaded, southern, addSuggestions, addJob, saveJob, markDone, undoDone, skip, snooze, setState, remove };
}
