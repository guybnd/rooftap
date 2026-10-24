// The gaps modules had when module-conformance.test.ts arrived (2026-10-23).
// It only shrinks: fix a gap and delete its line here. A new module starts
// with no entry, so it has to meet every rule.
import type { ModuleId } from "@homeup/core";

export type ModuleGap =
  | "no-core-folder"
  | "no-core-hook"
  | "no-web-screen"
  | "no-mobile-screen"
  | "web-skips-core-hook"
  | "mobile-skips-core-hook"
  | "web-no-list-item"
  | "mobile-no-list-item"
  | "web-no-row-menu"
  | "mobile-no-row-menu"
  | "web-no-settings-door"
  | "mobile-no-settings-door";

export interface ModuleBaseline {
  gaps?: ModuleGap[];
  /** Helpers or hooks declared under the same name in the web and the phone screens. */
  duplicated?: string[];
  /** Supabase queries (`.from("table")`, `.rpc(`) in screen files. */
  dataCalls?: number;
  /** Alert.alert / window.confirm / prompt / alert calls. */
  osDialogs?: number;
  /** React Native Modal imports in phone screens. */
  localModals?: number;
}

/** Modules whose logic has no core folder, and why. */
export const MODULES_WITHOUT_CORE: Partial<Record<ModuleId, string>> = {
  "google-calendar": "A sync integration: its code is the OAuth and push routes in apps/web and the Calendar screens' Google rows.",
  mcp: "The MCP server in apps/web. The tools it serves belong to the other modules.",
};

/** A platform a module ships without for now, with the ticket that adds it. */
export const PLATFORM_DEFERRALS: Partial<Record<ModuleId, { platform: "web" | "mobile"; ticket: string; why: string }>> = {};

export const MODULE_BASELINE: Partial<Record<ModuleId, ModuleBaseline>> = {
  household: { gaps: ["no-core-hook"], duplicated: ["dueMeta", "formatTime", "heroRowIcon", "useTaskSnoozeUndo"], dataCalls: 2 },
  calendar: { gaps: ["web-no-list-item"] },
  checklists: { gaps: ["mobile-skips-core-hook", "mobile-no-row-menu"], duplicated: ["checklistTypeIcon", "scheduledDateMeta"] },
  documents: { gaps: ["mobile-no-row-menu"], dataCalls: 2 },
  groceries: { duplicated: ["useGroceryAux", "useGroceryUndo", "useSuggestDismiss"], dataCalls: 15 },
  recipes: {
    gaps: ["mobile-no-row-menu"],
    duplicated: ["capitalize", "computeReviewState", "dotClass", "emptyRow", "freshName", "freshRowKey", "lineDetail", "missingPreview", "statusWord"],
  },
  costs: { duplicated: ["fillOf", "latestCategory"], dataCalls: 3 },
  setup: { duplicated: ["blank", "fromJob", "money"] },
  search: { gaps: ["web-skips-core-hook", "mobile-skips-core-hook", "web-no-list-item", "web-no-row-menu", "mobile-no-row-menu"], dataCalls: 6, localModals: 1 },
  shopper: { gaps: ["mobile-skips-core-hook", "mobile-no-row-menu"], duplicated: ["centsText", "dealToneClass", "statusWord"] },
  rewards: { gaps: ["mobile-no-row-menu"] },
  bins: { gaps: ["web-no-row-menu", "mobile-no-row-menu"] },
  assistant: { gaps: [], localModals: 1 },
};
