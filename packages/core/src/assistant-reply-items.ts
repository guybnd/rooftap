// Items a reply links to, drawn as line-item rows under the reply (Guy's pick
// A, Oct 24). The reply keeps its Markdown links; the apps read each linked
// item from the household's own stores, so a row shows what is true now
// (a ticked checklist item, a recipe kept from To try), not what the reply
// said at the time. Pure: useReplyItems (hooks/use-reply-items.ts) feeds it. It sits outside
// modules/ because it reads four modules' rows.

import type { Apartment, Checklist, ChecklistTaskItem, Recipe } from './types';
import type { ShopperWant } from './modules/shopper/shopper';
import { ITEM_LINK_MODULE, parseItemLink, type ItemLinkKind } from './modules/assistant/assistant-links';
import { parseReply } from './modules/assistant/assistant-view';
import { formatMoney } from './money-format';

/** At most this many rows under one reply; the rest stay plain links. */
export const MAX_REPLY_ITEMS = 6;

export interface ReplyItemRef {
  kind: ItemLinkKind;
  id: string;
  href: string;
}

/** The item links in a reply, in order, each once. Scout runs stay links: they have no row of their own. */
export function replyItemRefs(text: string | null | undefined): ReplyItemRef[] {
  if (!text) return [];
  const out: ReplyItemRef[] = [];
  const seen = new Set<string>();
  for (const block of parseReply(text)) {
    for (const span of block.spans) {
      if (!span.href?.startsWith('/')) continue;
      const item = parseItemLink(span.href);
      if (!item || item.kind === 'scout') continue;
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...item, href: span.href });
      if (out.length === MAX_REPLY_ITEMS) return out;
    }
  }
  return out;
}

export interface ReplyItemSources {
  recipes?: Record<string, Recipe | undefined>;
  checklists?: Record<string, Checklist | undefined>;
  checklistItems?: ChecklistTaskItem[];
  watches?: Record<string, ShopperWant | undefined>;
  listings?: Record<string, Apartment | undefined>;
}

export interface ReplyItemRow {
  key: string;
  kind: ItemLinkKind;
  id: string;
  href: string;
  /** Module and section id: the tile's hue and glyph. */
  module: (typeof ITEM_LINK_MODULE)[ItemLinkKind];
  title: string;
  meta: string | null;
  /** Shown in the success hue (a done list, a price at target). */
  good: boolean;
  /** A recipe on the To try list (its row menu offers Keep). */
  toTry?: boolean;
}

const live = <T extends { deleted?: boolean }>(row: T | undefined): T | null => (row && !row.deleted ? row : null);
const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** One row per linked item the stores still hold; a deleted or unknown one drops out (its link stays in the text). */
export function replyItemRows(refs: ReplyItemRef[], src: ReplyItemSources): ReplyItemRow[] {
  const rows: ReplyItemRow[] = [];
  for (const ref of refs) {
    const base = { key: `${ref.kind}:${ref.id}`, kind: ref.kind, id: ref.id, href: ref.href, module: ITEM_LINK_MODULE[ref.kind] };
    if (ref.kind === 'recipe') {
      const r = live(src.recipes?.[ref.id]);
      if (!r || r.draft) continue;
      const kind = (Array.isArray(r.cuisines) ? r.cuisines : []).map(capital).join(', ');
      const meta = [r.to_try ? 'To try' : null, kind || null].filter(Boolean).join(' · ');
      rows.push({ ...base, title: r.title, meta: meta || null, good: false, toTry: !!r.to_try });
    } else if (ref.kind === 'checklist') {
      const l = live(src.checklists?.[ref.id]);
      if (!l) continue;
      const items = (src.checklistItems ?? []).filter((i) => i.checklist_id === l.id && !i.deleted);
      const done = items.filter((i) => i.is_done).length;
      const finished = !!l.completed_at || (items.length > 0 && done === items.length);
      const meta = finished ? 'All done' : items.length ? `${done} of ${items.length} done` : 'No items yet';
      rows.push({ ...base, title: l.title, meta, good: finished });
    } else if (ref.kind === 'watch') {
      const w = live(src.watches?.[ref.id]);
      if (!w) continue;
      const atTarget = w.best_cents != null && w.target_cents != null && w.best_cents <= w.target_cents;
      const meta =
        w.status === 'bought'
          ? 'Bought'
          : w.best_cents != null
            ? `Best ${formatMoney(w.best_cents)}${w.target_cents != null ? ` · target ${formatMoney(w.target_cents)}` : ''}`
            : w.status === 'idea'
              ? 'Idea'
              : 'Watching';
      rows.push({ ...base, title: w.title, meta, good: atTarget });
    } else if (ref.kind === 'listing') {
      const a = live(src.listings?.[ref.id]);
      if (!a) continue;
      const meta = [a.suburb || null, a.rent_per_week != null ? `${formatMoney(a.rent_per_week * 100)}/wk` : null].filter(Boolean).join(' · ');
      rows.push({ ...base, title: a.address || a.suburb || 'Listing', meta: meta || null, good: false });
    }
  }
  return rows;
}
