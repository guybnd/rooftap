// What the X on a "Might be running low" suggestion does, as a per-user
// preference (user_settings.grocery_suggest_dismiss). Unset means "ask": the
// first tap offers both choices and remembers the pick; Settings > Groceries
// changes it later.
//  - not_now: hide the suggestion until the item is next bought
//    (`re_add_dismissed_at`, see `isReAddDismissed` in groceries.ts).
//  - archive: take the item off the list and keep its details in the item
//    library, the same Archive the list's row menu already offers.

export const GROCERY_DISMISS_ACTIONS = ['not_now', 'archive'] as const;
export type GroceryDismissAction = (typeof GROCERY_DISMISS_ACTIONS)[number];

export const GROCERY_DISMISS_LABELS: Record<GroceryDismissAction, { title: string; detail: string }> = {
  not_now: { title: 'Not now', detail: 'Keep it in Have it; suggest again after you next buy it' },
  archive: { title: 'Archive', detail: 'Take it off the list; keep its details in your library' },
};

/** Settings choice including the unset "ask first" state. */
export type GroceryDismissSetting = GroceryDismissAction | 'ask';

export function resolveGroceryDismissAction(raw: string | null | undefined): GroceryDismissAction | null {
  return (GROCERY_DISMISS_ACTIONS as readonly string[]).includes(raw ?? '') ? (raw as GroceryDismissAction) : null;
}

export const GROCERY_DISMISS_SETTING_OPTIONS: { value: GroceryDismissSetting; label: string }[] = [
  { value: 'ask', label: 'Ask first' },
  { value: 'not_now', label: GROCERY_DISMISS_LABELS.not_now.title },
  { value: 'archive', label: GROCERY_DISMISS_LABELS.archive.title },
];

/** user_settings value for a Settings choice ('ask' is stored as null). */
export function groceryDismissSettingValue(setting: GroceryDismissSetting): GroceryDismissAction | null {
  return setting === 'ask' ? null : setting;
}
