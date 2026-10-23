'use client';

// Bin night module: the household's bin streams, the council's changes and
// the plan, with the writes both apps' Bins screens and Home's card make.

import { useCallback, useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { binChanges$, binPlans$, binStreams$ } from '../../data/stores';
import { useReconnectSync, useStoreHelpers } from '../../data/create-group-store';
import { useStoreLoaded } from '../../data/use-store-loaded';
import { envRandomUUID } from '../../data/store-environment';
import { addDaysISO, todayISO } from '../../date-utils';
import {
  DEFAULT_BIN_PUSH_AT,
  DEFAULT_BIN_REMIND_AT,
  binNightHeroItem,
  binNightState,
  type BinChange,
  type BinChangeDraft,
  type BinPlan,
  type BinSource,
  type BinStream,
  type BinStreamDraft,
} from './bins';

function live<T extends { deleted: boolean }>(record: Record<string, T | undefined> | undefined): T[] {
  return Object.values(record ?? {}).filter((r): r is T => !!r && !r.deleted);
}

function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** What the setup sheet saves in one go. */
export interface BinSetupInput {
  streams: BinStreamDraft[];
  changes: BinChangeDraft[];
  remindAt: string;
  pushAt: string | null;
  rotation: string[];
  /** A date in rotation[0]'s week; defaults to today. */
  rotationAnchor?: string | null;
  source: BinSource;
}

/**
 * `groupId` undefined opens the inert stores (the module is off). Home passes
 * syncedGroupId's answer, the Bins screen the household's id.
 */
export function useBins(groupId: string | undefined, currentUserId: string | null | undefined) {
  const streams$ = binStreams$(groupId);
  const changes$ = binChanges$(groupId);
  const plans$ = binPlans$(groupId);
  useReconnectSync(streams$);
  useReconnectSync(changes$);
  useReconnectSync(plans$);
  const loaded = useStoreLoaded(streams$, changes$, plans$);

  const streams = use$(() => live(streams$.get()));
  const changes = use$(() => live(changes$.get()));
  const plans = use$(() => live(plans$.get()));
  // One plan per household; should two devices both create one offline, the newest wins.
  const plan = useMemo<BinPlan | null>(
    () => plans.slice().sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0] ?? null,
    [plans],
  );

  const streamHelpers = useStoreHelpers(streams$, currentUserId);
  const changeHelpers = useStoreHelpers(changes$, currentUserId);
  const planHelpers = useStoreHelpers(plans$, currentUserId);

  const today = todayISO();
  const night = useMemo(() => binNightState(streams, changes, plan, today), [streams, changes, plan, today]);
  const heroItem = useMemo(() => binNightHeroItem(night, plan, today), [night, plan, today]);

  /** Writes the plan, creating it on first use. */
  const savePlan = useCallback(
    (patch: Partial<BinPlan>) => {
      if (!groupId) return;
      if (plan) {
        planHelpers.writeRow({ ...plan, ...patch });
        return;
      }
      planHelpers.writeRow({
        id: envRandomUUID(),
        group_id: groupId,
        remind_at: DEFAULT_BIN_REMIND_AT,
        push_at: DEFAULT_BIN_PUSH_AT,
        rotation: [],
        rotation_anchor: null,
        out_for: null,
        out_by: null,
        timezone: deviceTimeZone(),
        setup_source: 'manual',
        created_by: null,
        created_at: '',
        updated_at: '',
        deleted: false,
        ...patch,
      });
    },
    [groupId, plan, planHelpers],
  );

  /** Saves the whole setup: streams and changes are replaced by the drafts, keeping ids. */
  const saveSetup = useCallback(
    (input: BinSetupInput) => {
      if (!groupId) return;
      const idByKey = new Map<string, string>();
      const keptStreams = new Set<string>();
      input.streams.forEach((draft, i) => {
        const id = draft.id ?? envRandomUUID();
        idByKey.set(draft.key, id);
        keptStreams.add(id);
        const existing = streams.find((s) => s.id === id);
        const row: BinStream = {
          id,
          group_id: groupId,
          name: draft.name.trim() || 'Bin',
          lid: draft.lid,
          weekday: draft.weekday,
          every_weeks: draft.every_weeks,
          anchor_date: draft.anchor_date,
          sort_order: i,
          created_by: existing?.created_by ?? null,
          created_at: existing?.created_at ?? '',
          updated_at: existing?.updated_at ?? '',
          deleted: false,
        };
        streamHelpers.writeRow(row);
      });
      for (const s of streams) if (!keptStreams.has(s.id)) streamHelpers.softDeleteRow(s.id);

      const keptChanges = new Set<string>();
      for (const draft of input.changes) {
        const streamId = draft.streamKey === null ? null : idByKey.get(draft.streamKey);
        if (streamId === undefined) continue;
        const id = draft.id ?? envRandomUUID();
        keptChanges.add(id);
        const existing = changes.find((c) => c.id === id);
        const row: BinChange = {
          id,
          group_id: groupId,
          stream_id: streamId,
          on_date: draft.on_date,
          moved_to: draft.moved_to,
          note: draft.note,
          source: existing?.source ?? input.source,
          created_by: existing?.created_by ?? null,
          created_at: existing?.created_at ?? '',
          updated_at: existing?.updated_at ?? '',
          deleted: false,
        };
        changeHelpers.writeRow(row);
      }
      // Past changes (which the sheet doesn't show, binDraftsFrom) stay as they were.
      const shownFrom = addDaysISO(today, -1);
      for (const c of changes) {
        if (!keptChanges.has(c.id) && (c.moved_to ?? c.on_date) >= shownFrom) changeHelpers.softDeleteRow(c.id);
      }

      savePlan({
        remind_at: input.remindAt,
        push_at: input.pushAt,
        rotation: input.rotation,
        rotation_anchor: input.rotation.length > 1 ? (input.rotationAnchor ?? plan?.rotation_anchor ?? today) : null,
        timezone: deviceTimeZone() ?? plan?.timezone ?? null,
        setup_source: input.source,
      });
    },
    [groupId, streams, changes, streamHelpers, changeHelpers, savePlan, plan, today],
  );

  /** Marks a collection's bins as out (Home's slide, the Bins page). */
  const markOut = useCallback(
    (collectionDate: string) => savePlan({ out_for: collectionDate, out_by: currentUserId ?? null }),
    [savePlan, currentUserId],
  );
  const undoOut = useCallback(() => savePlan({ out_for: null, out_by: null }), [savePlan]);

  /** Makes it someone else's turn this week: puts them first in the rotation from today. */
  const swapTurn = useCallback(
    (memberId: string) => {
      const rotation = plan?.rotation ?? [];
      if (rotation.length < 2 || !rotation.includes(memberId)) return;
      const at = rotation.indexOf(memberId);
      savePlan({ rotation: [...rotation.slice(at), ...rotation.slice(0, at)], rotation_anchor: night.collection?.date ?? today });
    },
    [plan, savePlan, night.collection, today],
  );

  const removeChange = useCallback((id: string) => changeHelpers.softDeleteRow(id), [changeHelpers]);

  return {
    loaded,
    streams,
    changes,
    plan,
    night,
    heroItem,
    savePlan,
    saveSetup,
    markOut,
    undoOut,
    swapTurn,
    removeChange,
  };
}

export type BinsApi = ReturnType<typeof useBins>;
