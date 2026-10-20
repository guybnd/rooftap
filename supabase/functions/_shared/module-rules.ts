// Modules (.docs/modules.md): the Deno twin of packages/core's modules.ts
// (resolveEnabledModules, parseModuleList) and task-modules.ts (which module a
// task belongs to, where it opens, and what Google Calendar push may carry). Deno can't resolve the core package
// graph, so the rules are restated here, pure and import-free;
// packages/core/src/task-modules.test.ts imports this file and checks it
// against core for every module combination, so the two can't drift.

/** id → defaultEnabled and hard requirements, in registry order (core MODULES). */
export const MODULE_DEFAULTS: ReadonlyArray<{ id: string; defaultEnabled: boolean; requires: readonly string[] }> = [
  { id: "household", defaultEnabled: true, requires: [] },
  { id: "calendar", defaultEnabled: true, requires: [] },
  { id: "checklists", defaultEnabled: true, requires: [] },
  { id: "documents", defaultEnabled: true, requires: [] },
  { id: "groceries", defaultEnabled: false, requires: [] },
  { id: "recipes", defaultEnabled: false, requires: [] },
  { id: "costs", defaultEnabled: false, requires: [] },
  { id: "setup", defaultEnabled: false, requires: [] },
  { id: "search", defaultEnabled: false, requires: [] },
  { id: "google-calendar", defaultEnabled: false, requires: ["calendar"] },
  { id: "mcp", defaultEnabled: false, requires: [] },
];

const KNOWN = new Set(MODULE_DEFAULTS.map((m) => m.id));

/** The server's HOMEUP_MODULES value: null (unset or blank) means every module; unknown ids are dropped. */
export function parseModuleList(raw: string | null | undefined): string[] | null {
  if (raw == null || raw.trim() === "") return null;
  return Array.from(new Set(raw.split(",").map((s) => s.trim()).filter((s) => KNOWN.has(s))));
}

/** What the server offers, intersected with the household's switches (a missing row is the default), minus unmet requirements. */
export function resolveEnabledModules(input: {
  available: readonly string[] | null;
  rows: readonly { module_id: string; enabled: boolean }[];
}): Set<string> {
  const available = input.available ? new Set(input.available) : null;
  const switched = new Map(input.rows.map((r) => [r.module_id, r.enabled]));
  const on = new Set<string>();
  for (const m of MODULE_DEFAULTS) {
    if (available && !available.has(m.id)) continue;
    if (switched.get(m.id) ?? m.defaultEnabled) on.add(m.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of MODULE_DEFAULTS) {
      if (on.has(m.id) && m.requires.some((r) => !on.has(r))) {
        on.delete(m.id);
        changed = true;
      }
    }
  }
  return on;
}

// Reminder template_key prefixes (core reminders.ts) and the module that owns each.
const REMINDER_OWNER: Record<string, string> = {
  "cost-reminder": "costs",
  "doc-reminder": "documents",
  "tracked-item-reminder": "household",
  "lease-reminder": "household",
};

const OWNER_HREF: Record<string, string> = {
  costs: "/costs",
  documents: "/documents",
};

/** The module a task belongs to: a bill or document reminder's origin, otherwise Tasks. */
export function taskOwnerModule(task: { template_key: string | null }): string {
  const key = task.template_key ?? "";
  const idx = key.indexOf(":");
  // A reminder key is `<prefix>:<originId>:<sub>`; anything else is a plain task.
  if (idx < 0 || key.lastIndexOf(":") === idx) return "household";
  return REMINDER_OWNER[key.slice(0, idx)] ?? "household";
}

/** Where a task's push opens: the task while Tasks is on, else its owner's screen; null when its owner is off. */
export function taskOpenHref(task: { id: string; template_key: string | null }, enabled: ReadonlySet<string>): string | null {
  if (enabled.has("household")) return `/tasks?focus=${task.id}`;
  const owner = taskOwnerModule(task);
  if (!enabled.has(owner)) return null;
  return OWNER_HREF[owner] ?? null;
}

/** Whether Google Calendar push may carry this item: Google Calendar is on, and so is the item's module (a task's owner, Home Search for a viewing). */
export function isGoogleCalendarPushEnabled(
  entityType: "task" | "appointment",
  task: { template_key: string | null } | null,
  enabled: ReadonlySet<string>,
): boolean {
  if (!enabled.has("google-calendar")) return false;
  if (entityType === "appointment") return enabled.has("search");
  return task ? enabled.has(taskOwnerModule(task)) : false;
}
