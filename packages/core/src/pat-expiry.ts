// Bot API key (personal access token) expiry choices, shared by both settings
// panels and the /api/pat route. Keys never expire unless the person picks a
// lifetime when generating or refreshing one.

export type PatExpiryChoice = 'never' | '30' | '90' | '365';

export const DEFAULT_PAT_EXPIRY: PatExpiryChoice = 'never';

export const PAT_EXPIRY_OPTIONS: { value: PatExpiryChoice; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

/**
 * Lifetime in days for a choice: null for "never", undefined for anything that
 * isn't one of the choices (so a route can reject it). A missing choice means
 * the default.
 */
export function patExpiryDays(choice: unknown): number | null | undefined {
  if (choice == null) choice = DEFAULT_PAT_EXPIRY;
  if (!PAT_EXPIRY_OPTIONS.some((o) => o.value === choice)) return undefined;
  return choice === 'never' ? null : Number(choice);
}
