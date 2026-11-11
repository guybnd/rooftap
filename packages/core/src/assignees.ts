// Several people on one to-do or event (HOUP-627). `assignees` lists everyone
// it is for; `assigned_to` keeps the first of them, so apps and servers that
// predate the list still see one person. The edge functions keep a twin of
// the reading rules (supabase/functions/_shared/assignees.ts).

export interface AssigneeFields {
  assigned_to?: string | null;
  assignees?: string[] | null;
}

/**
 * Everyone a row is for. The list counts only while its first entry is still
 * `assigned_to`: an older app that changes or clears the one person leaves a
 * stale list behind, and its change wins.
 */
export function assigneesOf(row: AssigneeFields): string[] {
  const first = row.assigned_to ?? null;
  const list = row.assignees ?? [];
  if (list.length > 0 && list[0] === first) return list;
  return first ? [first] : [];
}

/** Whether `userId` is one of the people a row is for. */
export function isAssignedTo(row: AssigneeFields, userId: string | null | undefined): boolean {
  return !!userId && assigneesOf(row).includes(userId);
}

/** Add or take off one person, keeping the order people were added in. */
export function toggleAssignee(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * The fields to write for a set of people. `list` is false on a server older
 * than the assignees column ('tasks.assignees'): only the first person is kept.
 */
export function assigneePatch(ids: readonly string[], list: boolean): { assigned_to: string | null; assignees?: string[] | null } {
  const unique = [...new Set(ids)];
  const kept = list ? unique : unique.slice(0, 1);
  return list ? { assigned_to: kept[0] ?? null, assignees: kept.length > 0 ? kept : null } : { assigned_to: kept[0] ?? null };
}

/** "Sam", "Sam and Kim", "Sam +2": a short line for the people picked, or `none`. */
export function peopleLabel(names: readonly string[], none: string): string {
  if (names.length === 0) return none;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} +${names.length - 1}`;
}
