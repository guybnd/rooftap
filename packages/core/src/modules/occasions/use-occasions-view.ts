'use client';

// Occasions: the screen and form-sheet state both apps share. The apps pass
// the store API from useOccasions and keep their own rendering, sheets and
// how a sheet closes.

import { useMemo, useState } from 'react';
import { envRandomUUID } from '../../data/store-environment';
import { dialog } from '../../dialog-store';
import { parsePriceInput } from '../shopper/shopper';
import {
  buildGiftIdea,
  buildOccasion,
  buildWishlistItem,
  defaultHiddenFrom,
  keepFromHints,
  memberFirstName,
  revealDay,
  suggestedOccasionTitle,
  type GiftIdea,
  type GiftIdeaStatus,
  type MemberProfileMap,
  type Occasion,
  type OccasionKind,
  type WishlistItem,
} from './occasions';
import { giftIdeaCardView, nextOccasion, occasionsLede, othersWishlists, previewRows } from './occasions-view';
import type { OccasionsApi } from './use-occasions';

/**
 * The Occasions screen: the next occasion and the lede, the occasion in focus
 * (picked, else the next, else the first), your wishlist and everyone else's.
 */
export function useOccasionsScreen(api: OccasionsApi, me: string | null) {
  const { today } = api;
  const [focusId, setFocusId] = useState<string | null>(null);
  const next = useMemo(() => nextOccasion(api.occasions, today), [api.occasions, today]);
  const othersLists = useMemo(() => othersWishlists(api.wishlist, me), [api.wishlist, me]);
  const focus = (focusId ? api.occasionById.get(focusId) : null) ?? next ?? api.occasions[0] ?? null;
  const mine = api.wishlist.filter((w) => w.user_id === me);
  const lede = occasionsLede(next, api.occasions.length, today, me);
  const empty = api.occasions.length === 0 && api.wishlist.length === 0;
  return { today, next, focus, setFocusId, mine, othersLists, lede, empty };
}

/** A member's id, a typed name, or nobody (a shared day like Christmas). */
export type OccasionWho = { kind: 'member'; id: string } | { kind: 'name' } | { kind: 'nobody' };

/**
 * The occasion form: kind, who it's for, the title (suggested from both until
 * typed), the day, every year, the Calendar switch, the budget and who it's
 * kept from. `submit` saves and returns the occasion, or null when the name
 * or day is missing.
 */
export function useOccasionForm(input: {
  occasion?: Occasion;
  api: Pick<OccasionsApi, 'saveOccasion'>;
  groupId: string;
  currentUserId: string | null;
  profiles: MemberProfileMap;
  /** Offer the Calendar switch: calendar.occasions is on and the server has the column. */
  calendar: boolean;
  /** The day a new occasion starts on ('' leaves it to pick). */
  initialDate: string;
}) {
  const { occasion, api, groupId, currentUserId, profiles, calendar } = input;
  const [kind, setKind] = useState<OccasionKind>(occasion?.kind ?? 'birthday');
  const [who, setWho] = useState<OccasionWho>(
    occasion?.person_id ? { kind: 'member', id: occasion.person_id } : occasion?.person_name ? { kind: 'name' } : occasion ? { kind: 'nobody' } : { kind: 'name' },
  );
  const [personName, setPersonName] = useState(occasion?.person_name ?? '');
  const [title, setTitle] = useState(occasion?.title ?? '');
  const [titleTouched, setTitleTouched] = useState(!!occasion);
  const [date, setDate] = useState(occasion?.date ?? input.initialDate);
  const [repeats, setRepeats] = useState(occasion?.repeats ?? true);
  const [onCalendar, setOnCalendar] = useState(occasion?.on_calendar !== false);
  const [budget, setBudget] = useState(occasion?.budget_cents ? String(occasion.budget_cents / 100) : '');
  const [hidden, setHidden] = useState<string[]>(occasion?.hidden_from ?? []);
  const [tried, setTried] = useState(false);

  const person = who.kind === 'member' ? memberFirstName(who.id, profiles) : who.kind === 'name' ? personName.trim() || null : null;
  const shownTitle = titleTouched ? title : suggestedOccasionTitle(kind, person);

  const typeTitle = (value: string) => {
    setTitleTouched(true);
    setTitle(value);
  };
  const keepFrom = (userId: string, on: boolean) => setHidden((h) => (on ? [...h, userId] : h.filter((id) => id !== userId)));

  const submit = (): Occasion | null => {
    setTried(true);
    if (!shownTitle.trim() || !date) return null;
    const fields = {
      title: shownTitle.trim(),
      kind,
      date,
      repeats,
      person_id: who.kind === 'member' ? who.id : null,
      person_name: who.kind === 'name' ? personName.trim() || null : null,
      budget_cents: parsePriceInput(budget),
      hidden_from: hidden.filter((id) => id !== currentUserId),
      // Only to a server with the column (occasions.calendar).
      ...(calendar ? { on_calendar: onCalendar } : {}),
    };
    const saved: Occasion = occasion
      ? { ...occasion, ...fields }
      : { ...buildOccasion({ id: envRandomUUID(), groupId, title: fields.title, kind, date, createdBy: currentUserId }), ...fields, created_at: '', updated_at: '' };
    api.saveOccasion(saved);
    return saved;
  };

  return {
    kind,
    setKind,
    who,
    setWho,
    personName,
    setPersonName,
    shownTitle,
    typeTitle,
    date,
    setDate,
    repeats,
    setRepeats,
    onCalendar,
    setOnCalendar,
    budget,
    setBudget,
    hidden,
    keepFrom,
    tried,
    submit,
  };
}

/**
 * The gift idea form. Who it's kept from follows who it's for until a switch
 * is touched; picking an occasion for a new idea picks its person too.
 * `submit` saves (with its Budget line and price watch) and returns false
 * when the idea has no name.
 */
export function useIdeaForm(input: {
  idea?: GiftIdea;
  /** The occasion a new idea goes under. */
  occasion: Occasion | null;
  api: Pick<OccasionsApi, 'occasionById' | 'today' | 'linkedCostOf' | 'linkedWantOf' | 'saveIdea'>;
  groupId: string;
  currentUserId: string | null;
  memberIds: readonly string[];
  profiles: MemberProfileMap;
  features: { costs: boolean; shopper: boolean };
}) {
  const { idea, occasion, api, groupId, currentUserId, memberIds, profiles, features } = input;
  const startFor = idea ? idea.for_user_id : occasion?.person_id ?? null;
  const [title, setTitle] = useState(idea?.title ?? '');
  const [occasionId, setOccasionId] = useState<string | null>(idea ? idea.occasion_id : occasion?.id ?? null);
  const [forUserId, setForUserId] = useState<string | null>(startFor);
  const [forName, setForName] = useState(idea ? idea.for_name ?? '' : occasion?.person_name ?? '');
  const [status, setStatus] = useState<GiftIdeaStatus>(idea?.status ?? 'idea');
  const [price, setPrice] = useState(idea?.price_cents ? String(idea.price_cents / 100) : '');
  const [url, setUrl] = useState(idea?.url ?? '');
  const [notes, setNotes] = useState(idea?.notes ?? '');
  const [hidden, setHidden] = useState<string[]>(idea ? idea.hidden_from : defaultHiddenFrom(startFor, currentUserId, memberIds));
  const [hiddenTouched, setHiddenTouched] = useState(!!idea);
  const [inBudget, setInBudget] = useState(!!api.linkedCostOf(idea));
  const [watch, setWatch] = useState(false);
  const [tried, setTried] = useState(false);

  const chosen = occasionId ? api.occasionById.get(occasionId) ?? null : null;
  const priceCents = parsePriceInput(price);
  const hasWant = !!api.linkedWantOf(idea);
  const hints = keepFromHints({
    names: hidden.map((id) => memberFirstName(id, profiles)),
    revealOn: revealDay(chosen, api.today),
    budget: features.costs && inBudget,
  });

  const pickFor = (userId: string | null) => {
    setForUserId(userId);
    if (!hiddenTouched) setHidden(defaultHiddenFrom(userId, currentUserId, memberIds));
  };

  const pickOccasion = (o: Occasion | null) => {
    setOccasionId(o?.id ?? null);
    if (!idea && o) {
      if (o.person_id) pickFor(o.person_id);
      else if (o.person_name) {
        pickFor(null);
        setForName(o.person_name);
      }
    }
  };

  const keepFrom = (userId: string, on: boolean) => {
    setHiddenTouched(true);
    setHidden((h) => (on ? [...h, userId] : h.filter((id) => id !== userId)));
  };

  const submit = (): boolean => {
    setTried(true);
    if (!title.trim()) return false;
    const fields = {
      title: title.trim(),
      occasion_id: occasionId,
      for_user_id: forUserId,
      for_name: forUserId ? null : forName.trim() || null,
      status,
      price_cents: priceCents,
      url: url.trim() || null,
      notes: notes.trim() || null,
      // Never kept from yourself: you would lose it too.
      hidden_from: hidden.filter((id) => id !== currentUserId),
    };
    const next: GiftIdea = idea
      ? { ...idea, ...fields }
      : { ...buildGiftIdea({ id: envRandomUUID(), groupId, title: fields.title, occasionId, hiddenFrom: [], createdBy: currentUserId }), ...fields, created_at: '', updated_at: '' };
    api.saveIdea(next, { inBudget, watch });
    return true;
  };

  return {
    title,
    setTitle,
    occasionId,
    pickOccasion,
    forUserId,
    pickFor,
    forName,
    setForName,
    status,
    setStatus,
    price,
    setPrice,
    priceCents,
    url,
    setUrl,
    notes,
    setNotes,
    hidden,
    keepFrom,
    hints,
    hasWant,
    inBudget,
    setInBudget,
    watch,
    setWatch,
    tried,
    submit,
  };
}

/** Your own wishlist item. `submit` saves and returns false when it has no name. */
export function useWishForm(input: { item?: WishlistItem; api: Pick<OccasionsApi, 'saveWish'>; groupId: string; currentUserId: string }) {
  const { item, api, groupId, currentUserId } = input;
  const [title, setTitle] = useState(item?.title ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [price, setPrice] = useState(item?.price_cents ? String(item.price_cents / 100) : '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [tried, setTried] = useState(false);

  const submit = (): boolean => {
    setTried(true);
    if (!title.trim()) return false;
    const fields = { title: title.trim(), url: url.trim() || null, price_cents: parsePriceInput(price), notes: notes.trim() || null };
    const saved: WishlistItem = item
      ? { ...item, ...fields }
      : { ...buildWishlistItem({ id: envRandomUUID(), groupId, userId: currentUserId, title: fields.title }), ...fields, created_at: '', updated_at: '' };
    api.saveWish(saved);
    return true;
  };

  return { title, setTitle, url, setUrl, price, setPrice, notes, setNotes, tried, submit };
}

/** Move an idea along (Mark bought from its row menu), keeping its Budget line. */
export function setIdeaStatus(api: Pick<OccasionsApi, 'saveIdea' | 'linkedCostOf'>, idea: GiftIdea, status: GiftIdeaStatus): void {
  if (idea.status !== status) api.saveIdea({ ...idea, status }, { inBudget: !!api.linkedCostOf(idea), watch: false });
}

/** Ask, then remove an idea (and its Budget line). Resolves true when it went. */
export async function confirmRemoveIdea(api: Pick<OccasionsApi, 'deleteIdea' | 'linkedCostOf'>, idea: GiftIdea): Promise<boolean> {
  const ok = await dialog.confirm({
    title: `Remove ${idea.title}?`,
    message: api.linkedCostOf(idea) ? 'Its budget line goes too.' : undefined,
    confirmLabel: 'Remove',
    destructive: true,
  });
  if (ok) api.deleteIdea(idea);
  return ok;
}

/**
 * A gift idea's card (Guy, 2026-10-23: "each section should be interactable"):
 * the view plus one editor per part, each saving as soon as it changes, with
 * its Budget line and price watch. Keeping it from someone new replaces the
 * row (saveIdea), so the card follows the idea's id as saves return it.
 * `idea` is null once it is gone.
 */
export function useGiftIdeaCard(input: {
  ideaId: string;
  api: Pick<OccasionsApi, 'ideas' | 'occasionById' | 'today' | 'linkedCostOf' | 'linkedWantOf' | 'saveIdea'>;
  currentUserId: string | null;
  memberIds: readonly string[];
  profiles: MemberProfileMap;
  features: { costs: boolean; shopper: boolean };
}) {
  const { ideaId, api, currentUserId, memberIds, profiles, features } = input;
  const [id, setId] = useState(ideaId);
  const idea = api.ideas.find((i) => i.id === id) ?? null;
  const occasion = idea?.occasion_id ? api.occasionById.get(idea.occasion_id) ?? null : null;
  const want = api.linkedWantOf(idea);
  const inBudget = !!api.linkedCostOf(idea);

  const view = useMemo(
    () => (idea ? giftIdeaCardView({ idea, occasion, ideas: api.ideas, want, me: currentUserId, profiles, today: api.today }) : null),
    [idea, occasion, api.ideas, want, currentUserId, profiles, api.today],
  );

  const save = (patch: Partial<GiftIdea>, opts?: { inBudget?: boolean; watch?: boolean }) => {
    if (!idea) return;
    const next = api.saveIdea({ ...idea, ...patch }, { inBudget: opts?.inBudget ?? inBudget, watch: opts?.watch ?? false });
    if (next.id !== id) setId(next.id);
  };

  /** False when the text isn't a price; an empty field clears it. */
  const setPrice = (text: string): boolean => {
    const cents = text.trim() ? parsePriceInput(text) : null;
    if (text.trim() && cents === null) return false;
    if (cents !== idea?.price_cents) save({ price_cents: cents }, { inBudget: inBudget && !!cents });
    return true;
  };

  const setText = (field: 'title' | 'url' | 'notes', text: string) => {
    const value = text.trim() || null;
    if (field === 'title' && !value) return;
    if (idea && (idea[field] ?? null) !== value) save({ [field]: value });
  };

  const hidden = idea?.hidden_from ?? [];
  return {
    idea,
    occasion,
    view,
    inBudget,
    hasWant: !!want,
    /** Everyone but you: the "Keep it from" switches. */
    others: memberIds.filter((m) => m !== currentUserId),
    hints: keepFromHints({
      names: hidden.map((m) => memberFirstName(m, profiles)),
      revealOn: revealDay(occasion, api.today),
      budget: features.costs && inBudget,
    }),
    setTitle: (text: string) => setText('title', text),
    setUrl: (text: string) => setText('url', text),
    setNotes: (text: string) => setText('notes', text),
    setPrice,
    setStatus: (status: GiftIdeaStatus) => idea?.status !== status && save({ status }),
    // Never kept from yourself: you would lose it too.
    keepFrom: (userId: string, on: boolean) => {
      if (userId === currentUserId) return;
      save({ hidden_from: on ? [...new Set([...hidden, userId])] : hidden.filter((m) => m !== userId) });
    },
    setInBudget: (on: boolean) => features.costs && save({}, { inBudget: on }),
    watchPrice: () => features.shopper && !want && save({}, { watch: true }),
  };
}

/**
 * Which Occasions lists are open past their preview. `rows(key, list, limit)`
 * gives the rows to draw and how many "Show all" would add; `toggle(key)`
 * opens or folds a list.
 */
export function useListPreviews() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  return {
    rows: <T,>(key: string, list: readonly T[], limit: number) => ({
      ...previewRows(list, limit, open.has(key)),
      open: open.has(key),
      /** Long enough to fold: draw the Show all / Show less row. */
      foldable: previewRows(list, limit, false).more > 0,
    }),
    toggle: (key: string) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
  };
}
