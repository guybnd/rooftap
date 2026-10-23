// Home Setup item: the editor form, quick add and row helpers both apps'
// Setup screens share. The apps keep their own fields, sheets and haptics.

import type { SetupItem } from '../../types';
import { envRandomUUID } from '../../data/store-environment';
import { SETUP_NO_ROOM } from './setup-list-view';

/** Rooms the editor always offers, before the ones the household made. */
export const SETUP_DEFAULT_ROOMS: readonly string[] = ['Kitchen', 'Bedroom', 'Bathroom', 'Living Room', 'Laundry', 'Outdoor', 'Garage'];

/** The editor's room choices: the defaults, then the household's own rooms. */
export function setupRoomOptions(existingRooms: readonly string[]): string[] {
  return Array.from(new Set([...SETUP_DEFAULT_ROOMS, ...existingRooms]));
}

/** True when the item's room isn't one of the choices, so the editor opens on "new room". */
export function isNewSetupRoom(room: string | null | undefined, roomOptions: readonly string[]): boolean {
  return !!room && !roomOptions.includes(room);
}

export interface SetupItemForm {
  name: string;
  room: string;
  priority: SetupItem['priority'];
  status: SetupItem['status'];
  est_price: number | null;
  actual_price: number | null;
  store_id: string | null;
  url: string;
  notes: string;
}

/** The editor's starting values: the item, or a blank one in `defaultRoom`. */
export function setupItemForm(item: SetupItem | undefined, defaultRoom = ''): SetupItemForm {
  return {
    name: item?.name || '',
    room: item?.room || defaultRoom || '',
    priority: item?.priority || 'medium',
    status: item?.status || 'needed',
    est_price: item?.est_price ?? null,
    actual_price: item?.actual_price ?? null,
    store_id: item?.store_id || null,
    url: item?.url || '',
    notes: item?.notes || '',
  };
}

/** An item needs a name and a room. */
export function canSaveSetupItemForm(form: Pick<SetupItemForm, 'name' | 'room'>): boolean {
  return form.name.trim().length > 0 && form.room.trim().length > 0;
}

/** A new row with every column set, ready for the store's writeRow (which stamps the creator). */
export function newSetupItemRow(
  groupId: string,
  fields: Partial<SetupItem> & Pick<SetupItem, 'name' | 'room'>,
  id: string = envRandomUUID(),
  now: string = new Date().toISOString(),
): SetupItem {
  return {
    id,
    group_id: groupId,
    priority: 'medium',
    status: 'needed',
    est_price: null,
    actual_price: null,
    where_to_buy: null,
    store_id: null,
    url: null,
    notes: null,
    assigned_to: null,
    private: false,
    template_key: null,
    ai_suggestion: null,
    sort_order: 0,
    created_by: null,
    created_at: now,
    updated_at: now,
    deleted: false,
    ...fields,
  };
}

/** The row the editor saves: the edited item, or a new one. Text is trimmed; blank link and notes are null. */
export function setupItemFromForm(form: SetupItemForm, item: SetupItem | undefined, groupId: string): SetupItem {
  const payload = {
    name: form.name.trim(),
    room: form.room.trim(),
    priority: form.priority,
    status: form.status,
    est_price: form.est_price,
    actual_price: form.actual_price,
    store_id: form.store_id,
    url: form.url.trim() || null,
    notes: form.notes.trim() || null,
    group_id: groupId,
  };
  return item?.id ? { ...item, ...payload } : newSetupItemRow(groupId, payload);
}

/** Quick add under a room header. Null for a blank name. Items under "Other" get no room. */
export function quickAddSetupItem(groupId: string, room: string, name: string): SetupItem | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return newSetupItemRow(groupId, { name: trimmed, room: room === SETUP_NO_ROOM ? '' : room });
}

/**
 * An inline price edit: a blank entry clears the price. Returns undefined
 * when nothing should be written (not a number, or unchanged).
 */
export function setupPriceEdit(current: number | null, input: string): number | null | undefined {
  const trimmed = input.trim();
  const next = trimmed ? parseInt(trimmed, 10) : null;
  if (next != null && Number.isNaN(next)) return undefined;
  return next === current ? undefined : next;
}

/** Over (positive) or under (negative) budget, once both prices are known. */
export function setupPriceDelta(item: Pick<SetupItem, 'est_price' | 'actual_price'>): number | null {
  return item.est_price != null && item.actual_price != null ? item.actual_price - item.est_price : null;
}

/** The comments chip names the noun it opens ("2 comments"). */
export function setupCommentChipLabel(count: number): string {
  return count > 0 ? `${count} comment${count === 1 ? '' : 's'}` : 'Comments';
}
