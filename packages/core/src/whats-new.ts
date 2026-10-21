// What's new (whats-new/README.md): the entries each user-facing PR adds,
// bundled by scripts/whats-new.mjs into whats-new.generated.ts, and the rules
// both apps use to pick what the launch sheet shows. Pure: the hook lives in
// hooks/use-whats-new.ts.
//
// - Batched: everything this device hasn't seen shows once, however many
//   updates landed since, grouped by release when it spans more than one.
// - Modules: an entry for a module that's off, or a section this person hid,
//   leaves no trace and stays unseen, so turning the module on later shows it.
// - A first launch shows only the last week, never the whole history.
import { daysBetweenISO } from './date-utils';
import { isSectionEnabled } from './modules';

export type WhatsNewKind = 'feature' | 'improvement' | 'fix';
export type WhatsNewPlatform = 'web' | 'mobile';

export interface WhatsNewEntry {
  /** The file name without .md, e.g. 2026-10-21-shopper-watchlist. */
  id: string;
  /** YYYY-MM-DD, from the file name. */
  date: string;
  title: string;
  body: string;
  /** A section or module id, or 'app' for app-wide changes. */
  module: string;
  kind: WhatsNewKind;
  /** In-app route the row's "Show me" opens. */
  link?: string;
  /** Only these platforms; both when absent. */
  platforms?: readonly WhatsNewPlatform[];
  /** A server-features.ts id the server must support. */
  server?: string;
  /** A big launch: gets its own full-screen card before the sheet. */
  spotlight?: boolean;
  /** The release it shipped in, or null while it's only in OTA builds since the last one. */
  version: string | null;
}

export interface WhatsNewRelease {
  version: string;
  date: string;
}

/** Device-local seen ids (getStoreEnvironment().keyValue). */
export const WHATS_NEW_SEEN_KEY = 'homeup_whats_new_seen_v1';
/** A first launch on this device shows only entries this recent. */
export const WHATS_NEW_FIRST_RUN_DAYS = 7;
/** Older entries never pop up; they stay in the history list. */
export const WHATS_NEW_MAX_AGE_DAYS = 60;
/** Rows in the sheet before "N more". */
export const WHATS_NEW_MAX_ROWS = 6;

export interface WhatsNewContext {
  platform: WhatsNewPlatform;
  /** useModules().enabled */
  enabled: ReadonlySet<string>;
  /** user_settings.hidden_sections */
  hidden?: readonly string[] | null;
  /** useModules().server, widened to any id. */
  serverSupports?: (id: string) => boolean;
}

/** Whether this person, on this platform and server, has the entry's feature at all. */
export function isEntryVisible(entry: WhatsNewEntry, ctx: WhatsNewContext): boolean {
  if (entry.platforms && !entry.platforms.includes(ctx.platform)) return false;
  if (entry.server && ctx.serverSupports && !ctx.serverSupports(entry.server)) return false;
  if (entry.module === 'app') return true;
  return isSectionEnabled(entry.module, ctx.enabled) && !(ctx.hidden ?? []).includes(entry.module);
}

/**
 * The seen set from storage. Nothing stored yet means this device has never
 * shown the sheet: everything older than the first-run window counts as seen
 * (`seeded` says to write that back), so a new install isn't handed the whole
 * history.
 */
export function resolveSeen(
  raw: string | null,
  entries: readonly WhatsNewEntry[],
  today: string
): { seen: Set<string>; seeded: boolean } {
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return { seen: new Set(parsed.filter((x): x is string => typeof x === 'string')), seeded: false };
    } catch {
      // Unreadable: seed again rather than show everything.
    }
  }
  const seen = new Set(entries.filter((e) => daysBetweenISO(e.date, today) > WHATS_NEW_FIRST_RUN_DAYS).map((e) => e.id));
  return { seen, seeded: true };
}

/** What to store after marking `ids` seen. Only ids still bundled are kept, so it never grows without bound. */
export function serializeSeen(seen: ReadonlySet<string>, ids: Iterable<string>, entries: readonly WhatsNewEntry[]): string {
  const next = new Set(seen);
  for (const id of ids) next.add(id);
  return JSON.stringify(entries.filter((e) => next.has(e.id)).map((e) => e.id));
}

/** Entries to show on launch: visible, unseen and recent. */
export function unseenEntries(
  entries: readonly WhatsNewEntry[],
  seen: ReadonlySet<string>,
  ctx: WhatsNewContext,
  today: string
): WhatsNewEntry[] {
  return entries.filter(
    (e) => !seen.has(e.id) && daysBetweenISO(e.date, today) <= WHATS_NEW_MAX_AGE_DAYS && isEntryVisible(e, ctx)
  );
}

export interface WhatsNewGroup {
  /** The release, or null for changes since the last one. */
  version: string | null;
  /** The release's date, else its newest entry's. */
  date: string;
  entries: WhatsNewEntry[];
}

export interface WhatsNewView {
  /** Feature entries marked spotlight, newest first: one full-screen card each. */
  spotlights: WhatsNewEntry[];
  /** Rows under release headers, newest release first; features lead each group. */
  groups: WhatsNewGroup[];
  /** Header the groups by release: more than one release is involved. */
  showVersions: boolean;
  /** Features and improvements past the row cap. */
  moreCount: number;
  /** Fixes, folded into one "smaller fixes" row (always all of them; empty with foldFixes: false). */
  fixes: WhatsNewEntry[];
  /** Every entry in the view, spotlights included. */
  total: number;
}

const KIND_RANK: Record<WhatsNewKind, number> = { feature: 0, improvement: 1, fix: 2 };

/**
 * Lays entries out for the sheet. `maxRows` caps the feature/improvement rows
 * (spotlights don't count; they get their own cards); fixes fold into one row.
 * The history list passes `maxRows: Infinity, spotlights: false, foldFixes: false`.
 */
export function buildWhatsNewView(
  entries: readonly WhatsNewEntry[],
  releases: readonly WhatsNewRelease[],
  opts: { maxRows?: number; spotlights?: boolean; foldFixes?: boolean } = {}
): WhatsNewView {
  const maxRows = opts.maxRows ?? WHATS_NEW_MAX_ROWS;
  const useSpotlights = opts.spotlights ?? true;
  const foldFixes = opts.foldFixes ?? true;
  const spotlights = useSpotlights ? entries.filter((e) => e.spotlight && e.kind === 'feature') : [];
  const fixes = foldFixes ? entries.filter((e) => e.kind === 'fix') : [];
  const rows = entries.filter((e) => !fixes.includes(e) && !spotlights.includes(e));

  const releaseDate = new Map(releases.map((r) => [r.version, r.date]));
  const byVersion = new Map<string | null, WhatsNewEntry[]>();
  for (const e of rows) byVersion.set(e.version, [...(byVersion.get(e.version) ?? []), e]);
  // Unreleased changes are newest; releases by date, newest first.
  const versionDate = (v: string | null, list: WhatsNewEntry[]) =>
    (v && releaseDate.get(v)) || list.reduce((max, e) => (e.date > max ? e.date : max), '');
  const ordered = [...byVersion.entries()]
    .map(([version, list]) => ({
      version,
      date: versionDate(version, list),
      entries: [...list].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    }))
    .sort((a, b) => (a.version === null ? -1 : b.version === null ? 1 : a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const groups: WhatsNewGroup[] = [];
  let left = maxRows;
  for (const g of ordered) {
    if (left <= 0) break;
    const take = g.entries.slice(0, left);
    left -= take.length;
    groups.push({ ...g, entries: take });
  }
  const shown = groups.reduce((n, g) => n + g.entries.length, 0);
  const versions = new Set(entries.map((e) => e.version));
  return {
    spotlights,
    groups,
    showVersions: versions.size > 1,
    moreCount: rows.length - shown,
    fixes,
    total: entries.length,
  };
}

/** "Today", "Yesterday", "3 days ago", "Last week", "5 weeks ago": a release header's date. */
export function whatsNewDayLabel(date: string, today: string): string {
  const days = daysBetweenISO(date, today);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/** The sheet's heading: "3 new things since you last looked", or "3 releases since you last looked". */
export function whatsNewHeadline(view: WhatsNewView): string {
  const released = new Set(view.groups.map((g) => g.version).filter((v): v is string => v !== null));
  if (view.showVersions && released.size > 1) return `${released.size} releases since you last looked`;
  if (view.total === 1) return 'One new thing since you last looked';
  return `${view.total} new things since you last looked`;
}

/** The folded fixes row: "And 4 smaller fixes". */
export function fixesLabel(count: number): string {
  return count === 1 ? 'And 1 smaller fix' : `And ${count} smaller fixes`;
}
