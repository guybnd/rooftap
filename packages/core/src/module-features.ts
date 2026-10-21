// Cross-module features (.docs/modules.md, sections 3 and 7). Anything one
// module shows, links to or writes in another module, and any module content
// on a platform surface (the hub, capture, share), is a named feature here
// with the modules it needs. Surfaces gate on `isFeatureEnabled` (or
// `useModules().feature(id)`), never on ad-hoc module checks, so one test can
// switch each module off and assert every feature that needs it disappears.
//
// A gate stops a feature from adding rows into a switched-off module. Rows it
// already created keep syncing (updates and removals), so the other module is
// right when it comes back.
//
// Adding a feature: add an entry, gate the surface on it, and the matrix test
// in module-features.test.ts covers it automatically.

import type { ModuleId } from './modules';

export interface ModuleFeatureDef {
  /** Every module listed must be on. */
  modules: readonly ModuleId[];
  /** One line on what disappears when any of them is off. */
  what: string;
}

export const MODULE_FEATURES = {
  // ── Calendar ─────────────────────────────────────────────────────────────
  'calendar.tasks': {
    modules: ['calendar', 'household'],
    what: 'Tasks with dates on the calendar, and adding a to-do from it.',
  },
  'calendar.viewings': {
    modules: ['calendar', 'search'],
    what: 'Viewings on the calendar, and booking one from it.',
  },
  'calendar.event-documents': {
    modules: ['calendar', 'documents'],
    what: 'Attaching documents to a calendar event.',
  },
  'calendar.budget': {
    modules: ['calendar', 'costs'],
    what: "An event's ticket cost, kept as a Going out line in the Budget.",
  },
  'calendar.google-events': {
    modules: ['calendar', 'google-calendar'],
    what: 'Pulled Google Calendar events on the calendar, sharing them, and Google setup in Calendar settings.',
  },
  'search.google-suggestions': {
    modules: ['search', 'google-calendar'],
    what: 'Viewing suggestions from Google Calendar on Appointments.',
  },

  // ── Home hub (platform surface) ─────────────────────────────────────────
  'hub.tasks': {
    modules: ['household'],
    what: 'Tasks and reminders in the hub agenda, quick add, and the Tasks link.',
  },
  'hub.viewings': {
    modules: ['search'],
    what: 'Viewings in the hub agenda.',
  },
  'hub.events': {
    modules: ['calendar'],
    what: 'Household calendar events in the hub agenda.',
  },
  'hub.calendar-events': {
    modules: ['calendar', 'google-calendar'],
    what: 'Pulled Google Calendar events in the hub agenda.',
  },
  'hub.task-checklists': {
    modules: ['household', 'checklists'],
    what: 'Checklist progress on a task in the hub agenda.',
  },
  'hub.budget': {
    modules: ['costs'],
    what: 'Budget pulse and bills due in the summary hero.',
  },
  'hub.shopping': {
    modules: ['groceries'],
    what: 'Shopping list count in the summary hero.',
  },
  'hub.setup-progress': {
    modules: ['setup'],
    what: 'Home setup progress in the summary hero.',
  },
  'hub.shopper': {
    modules: ['shopper'],
    what: 'Shopper good-deal count in the summary hero.',
  },

  // ── Tasks and checklists ─────────────────────────────────────────────────
  'tasks.checklists': {
    modules: ['household', 'checklists'],
    what: 'Attaching a checklist to a task, its chip and panel; a dated checklist creating its linked task (an existing one keeps syncing).',
  },
  'tasks.from-cost': {
    modules: ['household', 'costs'],
    what: 'The "from bill" link on a reminder task, and a bill\'s "Open reminder" link.',
  },
  'tasks.from-document': {
    modules: ['household', 'documents'],
    what: 'The "from document" link on a reminder task, and a document\'s "Open reminder" link.',
  },

  // ── Groceries and recipes ────────────────────────────────────────────────
  'recipes.groceries': {
    modules: ['recipes', 'groceries'],
    what: 'Have and need from the shopping list, "Add missing", and the recipe chip on grocery items.',
  },

  // ── Shopper ──────────────────────────────────────────────────────────────
  'shopper.tasks': {
    modules: ['shopper', 'household'],
    what: 'A "Buy it" to-do from Plan to buy on a Shopper item.',
  },
  'shopper.costs': {
    modules: ['shopper', 'costs'],
    what: 'A planned one-off cost from Plan to buy on a Shopper item.',
  },

  // ── Costs ────────────────────────────────────────────────────────────────
  'costs.from-groceries': {
    modules: ['costs', 'groceries'],
    what: 'A shopping trip adding its cost line (an existing one keeps syncing).',
  },
  'costs.from-checklists': {
    modules: ['costs', 'checklists'],
    what: 'A checklist with "log costs" adding purchase cost lines (unchecking still removes one).',
  },
  'costs.suggest-rent': {
    modules: ['costs', 'search'],
    what: 'The rent suggestion from the chosen apartment.',
  },
  'costs.suggest-setup': {
    modules: ['costs', 'setup'],
    what: 'The moving costs suggestion from Home Setup purchases.',
  },

  // ── Documents ────────────────────────────────────────────────────────────
  'documents.costs': {
    modules: ['documents', 'costs'],
    what: 'Documents-store files on a bill, bill links on a document, and legacy bill files in Documents. A bill\'s own attachments stay with Costs.',
  },
  'documents.groceries': {
    modules: ['documents', 'groceries'],
    what: 'Grocery receipts as documents, and grocery links on a document.',
  },
  'documents.setup': {
    modules: ['documents', 'setup'],
    what: 'The "Doc" chip on a setup item, and setup links on a document.',
  },
  'documents.recipes': {
    modules: ['documents', 'recipes'],
    what: 'Recipe links on a document (a scanned recipe\'s source photo).',
  },

  // ── Capture and share (platform surfaces) ────────────────────────────────
  'capture.document': {
    modules: ['documents'],
    what: 'Saving a photo or file as a document from capture or share.',
  },
  'capture.cost': {
    modules: ['costs'],
    what: 'Adding a bill or invoice from capture or share.',
  },
  'capture.grocery-bill': {
    modules: ['groceries'],
    what: 'Adding a grocery receipt from capture or share.',
  },
  'capture.listing': {
    modules: ['search'],
    what: 'Adding a listing from a shared link or file.',
  },
  'capture.calendar-file': {
    modules: ['search'],
    what: 'Importing a shared calendar (.ics) file as a viewing.',
  },
} as const satisfies Record<string, ModuleFeatureDef>;

export type ModuleFeatureId = keyof typeof MODULE_FEATURES;

export const ALL_MODULE_FEATURE_IDS = Object.keys(MODULE_FEATURES) as ModuleFeatureId[];

/** Whether every module a feature needs is on. */
export function isFeatureEnabled(id: ModuleFeatureId, enabled: ReadonlySet<string>): boolean {
  return MODULE_FEATURES[id].modules.every((m) => enabled.has(m));
}
