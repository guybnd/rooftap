// Several people on one to-do or event. `assignees` lists everyone it is for;
// `assigned_to` keeps the first of them, so apps and servers that predate the
// list still see one person. Pure and import-free so core's vitest suite checks
// it next to core's copy (packages/core/src/assignees.ts).

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

/** People on `next` who were not on `prev`: who to tell they were added. */
export function addedAssignees(prev: AssigneeFields | null | undefined, next: AssigneeFields): string[] {
  const before = new Set(prev ? assigneesOf(prev) : []);
  return assigneesOf(next).filter((id) => !before.has(id));
}
