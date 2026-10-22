// One menu grammar for every line item (Hearth §13.7 "Row menu", Guy,
// 2026-10-22). A row declares what it can do as RowActions; the platform
// draws them: web as a right-click context menu, native as the long-press
// sheet. Every menu reads the same way, top to bottom:
//
//   open    Open, and anything else that takes you to the item
//   state   the row's main verb: Done, Got it, Paid, Check
//   set     quick settings that open a list to the side: Due, Snooze, Assign
//   share   Share, Copy, Duplicate, Add to calendar
//   edit    Edit details
//   danger  Archive, Delete: always last, alone in their group
//
// Rows never order their own groups; arrangeRowActions does.

export type RowActionGroup = 'open' | 'state' | 'set' | 'share' | 'edit' | 'danger';

export const ROW_ACTION_GROUPS: readonly RowActionGroup[] = ['open', 'state', 'set', 'share', 'edit', 'danger'];

/** Icon names the platforms map to their own glyphs (web: lucide). */
export type RowActionIcon =
  | 'open'
  | 'done'
  | 'undo'
  | 'due'
  | 'snooze'
  | 'repeat'
  | 'assign'
  | 'priority'
  | 'move'
  | 'status'
  | 'checklist'
  | 'comment'
  | 'note'
  | 'star'
  | 'share'
  | 'copy'
  | 'duplicate'
  | 'calendar'
  | 'cost'
  | 'directions'
  | 'hide'
  | 'select'
  | 'edit'
  | 'archive'
  | 'delete';

export interface RowActionOption {
  id: string;
  label: string;
  /** The current value: drawn with a check. */
  checked?: boolean;
  /** A small trailing note, e.g. the date a snooze lands on. */
  hint?: string;
  /** A small dot before the label: a CSS colour, or the dot class the domain already uses (an aisle's `bg-*`). */
  swatch?: string;
  run: () => void;
}

export interface RowAction {
  id: string;
  label: string;
  group: RowActionGroup;
  icon?: RowActionIcon;
  /** A leaf action. Ignored when `options` is set. */
  run?: () => void;
  /** Turns the action into a submenu of choices. */
  options?: RowActionOption[];
  /** The current value, shown after the label (Due: Tomorrow). */
  value?: string;
  /** A keyboard hint drawn at the end of the row, e.g. "Del". */
  shortcut?: string;
  disabled?: boolean;
  /** Red, for Delete and friends. Implied for the danger group. */
  danger?: boolean;
}

/** A row's menu: the actions plus the name drawn at the top. */
export interface RowMenu {
  title: string;
  /** What kind of thing it is, under the title: Task, Grocery item. */
  kind?: string;
  /** In any order; empty entries (a falsy action) are dropped, so a row can write `cond && {...}`. */
  actions: readonly (RowAction | null | undefined | false)[];
}

/**
 * The actions in menu order: one list per non-empty group, groups in
 * ROW_ACTION_GROUPS order, a row's own order kept inside a group. Actions
 * that can do nothing (no run and no options) drop out.
 */
export function arrangeRowActions(actions: readonly (RowAction | null | undefined | false)[]): RowAction[][] {
  const live = actions.filter(
    (a): a is RowAction => !!a && (a.options ? a.options.length > 0 : typeof a.run === 'function')
  );
  return ROW_ACTION_GROUPS.map((g) => live.filter((a) => a.group === g)).filter((list) => list.length > 0);
}

/** Whether a menu would show anything at all. */
export function hasRowActions(actions: readonly (RowAction | null | undefined | false)[]): boolean {
  return arrangeRowActions(actions).length > 0;
}
