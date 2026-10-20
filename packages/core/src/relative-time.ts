/**
 * Compact relative-time label ("Just now", "5m ago", "3d ago", …).
 * Mirrors the inline formatters in apartment-card / entity-comments so grocery
 * cards read consistently (FLUX-188). Returns null for a null/unparseable input
 * so callers can render nothing rather than a bogus "NaN ago".
 */
export function timeAgo(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return null;
  const diff = Date.now() - t;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/**
 * Sort key for created_at-descending ordering. A null created_at means the
 * row was just written and hasn't synced yet (HOUP-134) — treat it as "now"
 * so the optimistic row sorts as newest instead of sinking to the bottom
 * (new Date(null).getTime() === 0).
 */
export function createdAtSortValue(dateStr: string | null | undefined): number {
  if (!dateStr) return Date.now();
  const t = new Date(dateStr).getTime();
  return isNaN(t) ? Date.now() : t;
}

/**
 * Future counterpart of timeAgo: "in 3d", "in 5h". Returns null for a missing,
 * invalid or past date so callers can render their own "expired" state.
 */
export function timeUntil(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return null;
  const diff = t - Date.now();
  if (diff <= 0) return null;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `in ${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}
