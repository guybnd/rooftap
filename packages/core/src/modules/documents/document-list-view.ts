// What the Documents list shows, shared by the web page and the mobile screen:
// the filters, the sort, the cost pairing, the reminder map, the Hero lede's
// document set and each row's expiry words. Each app keeps its own rendering;
// use-document-list-view.ts holds the filter state on top of these.

import type { DocType, DocumentFolder, DocumentLink } from '../../types';
import { compareStrings } from '../../sort';
import { parseReminderKey } from '../../reminders';
import { expiryDaysOf, SOON_DAYS, type UnifiedDocument } from './documents';
import { folderDescendantIds } from './document-folders';

export type DocumentExpiryFilter = 'all' | 'soon' | 'expired';
export type DocumentSort = 'recent' | 'expiry' | 'name';

export interface DocumentListFilters {
  categories: Set<DocType>;
  tags: string[];
  expiry: DocumentExpiryFilter;
}

/**
 * Browsing means "no query, no filters": folders only structure the plain
 * list. A search or filter looks across the whole tree instead, because
 * finding nothing merely for standing in the wrong folder is worse than a
 * flat result that spans folders.
 */
export function isBrowsingDocuments(search: string, f: DocumentListFilters): boolean {
  return search.trim() === '' && f.categories.size === 0 && f.tags.length === 0 && f.expiry === 'all';
}

/** The documents that pass the type, tag (all of them) and expiry filters. */
export function filterDocuments<T extends Pick<UnifiedDocument, 'docType' | 'tags' | 'expiryDate'>>(
  docs: T[],
  f: DocumentListFilters
): T[] {
  return docs.filter((d) => {
    if (f.categories.size > 0 && !f.categories.has(d.docType as DocType)) return false;
    if (f.tags.length > 0 && !f.tags.every((t) => d.tags.includes(t))) return false;
    if (f.expiry !== 'all') {
      const days = expiryDaysOf(d);
      if (days == null) return false;
      if (f.expiry === 'expired' && days >= 0) return false;
      if (f.expiry === 'soon' && (days < 0 || days > SOON_DAYS)) return false;
    }
    return true;
  });
}

/**
 * A sorted copy. 'name' sorts by title (filename when untitled), 'expiry'
 * puts the soonest first and undated last, 'recent' keeps the input order
 * (listUnifiedDocuments returns newest first).
 */
export function sortDocuments<T extends Pick<UnifiedDocument, 'title' | 'filename' | 'expiryDate'>>(
  docs: T[],
  sort: DocumentSort
): T[] {
  const arr = [...docs];
  if (sort === 'name') {
    arr.sort((a, b) => compareStrings(a.title || a.filename, b.title || b.filename));
  } else if (sort === 'expiry') {
    arr.sort((a, b) => {
      const da = expiryDaysOf(a), db = expiryDaysOf(b);
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
  }
  return arr;
}

/** Links grouped by document id. Pass visibleDocumentLinks() so links into a switched-off module drop out. */
export function documentLinksByDoc(links: DocumentLink[]): Map<string, DocumentLink[]> {
  const m = new Map<string, DocumentLink[]>();
  for (const l of links) {
    const arr = m.get(l.document_id) ?? [];
    arr.push(l);
    m.set(l.document_id, arr);
  }
  return m;
}

/** Each document's (first) linked cost, keyed by the list key, for the paired-by-cost order. */
export function documentCostIds(
  docs: Pick<UnifiedDocument, 'key' | 'storeId'>[],
  linksByDoc: Map<string, DocumentLink[]>
): Record<string, string> {
  const m: Record<string, string> = {};
  for (const d of docs) {
    const dl = d.storeId ? (linksByDoc.get(d.storeId) ?? []) : [];
    const cost = dl.find((l) => l.entity_type === 'cost_item');
    if (cost) m[d.key] = cost.entity_id;
  }
  return m;
}

/**
 * Reorder a list so documents sharing a cost sit next to each other, the
 * later ones pulled up under the first. The order is the pairing.
 */
export function groupDocumentsByCost<T extends Pick<UnifiedDocument, 'key'>>(
  list: T[],
  costIdByKey: Record<string, string>
): T[] {
  const counts: Record<string, number> = {};
  for (const d of list) {
    const c = costIdByKey[d.key];
    if (c) counts[c] = (counts[c] ?? 0) + 1;
  }
  const ordered: T[] = [];
  const placed = new Set<string>();
  for (const d of list) {
    if (placed.has(d.key)) continue;
    ordered.push(d);
    placed.add(d.key);
    const c = costIdByKey[d.key];
    if (c && counts[c] > 1) {
      for (const o of list) {
        if (!placed.has(o.key) && costIdByKey[o.key] === c) {
          ordered.push(o);
          placed.add(o.key);
        }
      }
    }
  }
  return ordered;
}

/** Document id to its expiry reminder's task id, from household_tasks rows (id, template_key). */
export function documentReminderMap(rows: { id: string; template_key: string | null }[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of rows) {
    const parsed = parseReminderKey(r.template_key);
    if (parsed?.kind === 'document') map[parsed.originId] = r.id;
  }
  return map;
}

/**
 * What the Hero lede counts: every document at the top level, or the open
 * folder's whole subtree inside one.
 */
export function documentsUnderFolder<T extends Pick<UnifiedDocument, 'folderId'>>(
  docs: T[],
  folders: DocumentFolder[],
  folderId: string | null
): T[] {
  if (folderId === null) return docs;
  const subtree = folderDescendantIds(folders, folderId);
  subtree.add(folderId);
  return docs.filter((d) => d.folderId != null && subtree.has(d.folderId));
}

/**
 * The row's expiry words (H6: relative when near, a short date when far,
 * never raw ISO). Only expired and soon take a status hue (H2): the tone
 * says which, and each app picks the class.
 */
export function documentExpiryLabel(
  days: number,
  expiryDate: string
): { text: string; tone: 'expired' | 'soon' | 'later' } {
  const date = new Date(`${expiryDate.slice(0, 10)}T00:00:00`);
  if (days < 0) {
    const ago = -days;
    return {
      text: ago <= SOON_DAYS
        ? `expired ${ago}d ago`
        : `expired ${date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`,
      tone: 'expired',
    };
  }
  if (days === 0) return { text: 'expires today', tone: 'soon' };
  if (days === 1) return { text: 'expires tomorrow', tone: 'soon' };
  if (days <= SOON_DAYS) return { text: `expires in ${days}d`, tone: 'soon' };
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return {
    text: `expires ${date.toLocaleDateString(
      'en-US',
      sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' }
    )}`,
    tone: 'later',
  };
}
