'use client';

// Occasions: birthdays, anniversaries and other days, the gift ideas for
// them, and everyone's wishlists. The lede is the next day coming up (H1);
// under it, the ideas for the occasion in focus, then every occasion, then
// the wishlists. A gift kept from someone never reaches their device (the
// database drops it), so on their own day a member sees only their wishlist.
// Native twin: apps/mobile/src/app/(tabs)/occasions/index.tsx.
import { useMemo, useState } from 'react';
import { Gift, Plus } from 'lucide-react';
import {
  daysBetweenISO,
  formatMoney,
  ideaStatusLine,
  ideasForOccasion,
  isOwnOccasion,
  keptFromLabel,
  memberFirstName,
  nextOccasionDay,
  occasionSpend,
  occasionSubtitle,
  occasionTitle,
  occasionWhenLabel,
  personName,
  takenBy,
  useModules,
  useOccasions,
  weekdayDayMonthLabel,
  type GiftIdea,
  type Occasion,
  type OccasionsApi,
  type WishlistItem,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { HeroLede } from '@/components/ui/hero-lede';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle } from '@/components/ui/list-item';
import { LeadingTile } from '@/components/ui/leading-tile';
import { EmptyState } from '@/components/ui/empty-state';
import { OfflineHint } from '@/components/offline-hint';
import { useWideLayout } from '@/lib/desktop-layout';
import { cn } from '@/lib/utils';
import { IdeaFormSheet } from './idea-form-sheet';
import { OccasionFormSheet } from './occasion-form-sheet';
import { WishFormSheet } from './wish-form-sheet';

const MICRO = 'px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export default function OccasionsPage() {
  const { group, groupMembers, memberProfiles, currentUserId, isOnline, loading: cacheLoading } = useDataCache();
  const modules = useModules();
  const features = { costs: modules.feature('occasions.costs'), shopper: modules.feature('occasions.shopper') };
  const api = useOccasions(group?.id, currentUserId, features);
  const wide = useWideLayout();
  const { today } = api;

  const [focusId, setFocusId] = useState<string | null>(null);
  const [editingOccasion, setEditingOccasion] = useState<{ id: string | null } | null>(null);
  const [editingIdea, setEditingIdea] = useState<{ id: string | null; occasionId: string | null } | null>(null);
  const [editingWish, setEditingWish] = useState<{ id: string | null } | null>(null);

  const next = useMemo(() => api.occasions.find((o) => nextOccasionDay(o, today)) ?? null, [api.occasions, today]);
  const focus = (focusId ? api.occasionById.get(focusId) : null) ?? next ?? api.occasions[0] ?? null;
  const mine = api.wishlist.filter((w) => w.user_id === currentUserId);
  const othersLists = useMemo(() => {
    const byUser = new Map<string, WishlistItem[]>();
    for (const w of api.wishlist) {
      if (w.user_id === currentUserId) continue;
      byUser.set(w.user_id, [...(byUser.get(w.user_id) ?? []), w]);
    }
    return [...byUser.entries()];
  }, [api.wishlist, currentUserId]);

  if (cacheLoading || (!api.loaded && api.occasions.length === 0)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group || !currentUserId) return <div className="p-6 text-muted-foreground">No group selected</div>;

  const nextDay = next ? nextOccasionDay(next, today) : null;
  const days = nextDay ? daysBetweenISO(today, nextDay) : null;
  const lede = next && nextDay && days !== null
    ? { value: days === 0 ? 'Today' : days, label: days === 0 ? undefined : days === 1 ? 'day' : 'days', caption: `${occasionTitle(next, currentUserId)} · ${weekdayDayMonthLabel(nextDay)}` }
    : { value: api.occasions.length, label: api.occasions.length === 1 ? 'occasion' : 'occasions', caption: 'Nothing coming up' };

  const editingOccasionRow = editingOccasion?.id ? api.occasionById.get(editingOccasion.id) : undefined;
  const editingIdeaRow = editingIdea?.id ? api.ideas.find((i) => i.id === editingIdea.id) : undefined;
  const editingWishRow = editingWish?.id ? api.wishlist.find((w) => w.id === editingWish.id) : undefined;
  const ideaOccasion = editingIdea ? (editingIdea.occasionId ? api.occasionById.get(editingIdea.occasionId) ?? null : null) : null;

  const empty = api.occasions.length === 0 && api.wishlist.length === 0;

  return (
    <div className={cn('mx-auto space-y-4 p-4 md:p-6 pb-24', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-3xl')}>
      <HeroLede
        layout="inline"
        value={lede.value}
        label={lede.label}
        caption={lede.caption}
        trailing={
          <>
            {!isOnline && <OfflineHint />}
            <button
              type="button"
              onClick={() => setEditingOccasion({ id: null })}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </>
        }
      />

      {empty ? (
        <EmptyState
          icon={Gift}
          title="No occasions yet"
          description="Add birthdays and other days to plan gifts for. A gift idea can be kept from the person it's for, so the surprise holds."
          action={{ label: 'Add an occasion', onClick: () => setEditingOccasion({ id: null }), icon: <Plus className="h-4 w-4" /> }}
        />
      ) : (
        <div className={cn(wide ? 'grid grid-cols-2 items-start gap-6' : 'space-y-5')}>
          <div className="space-y-5">
            {focus && (
              <FocusBlock
                occasion={focus}
                api={api}
                me={currentUserId}
                profiles={memberProfiles}
                onEditOccasion={() => setEditingOccasion({ id: focus.id })}
                onAddIdea={() => setEditingIdea({ id: null, occasionId: focus.id })}
                onOpenIdea={(idea) => setEditingIdea({ id: idea.id, occasionId: idea.occasion_id })}
              />
            )}

            {api.occasions.length > 0 && (
              <div className="space-y-1.5">
                <p className={MICRO}>Occasions</p>
                <ListGroup>
                  {api.occasions.map((o) => (
                    <ListItem key={o.id} asChild className={cn('cursor-pointer hover:bg-muted/50', focus?.id === o.id && 'bg-muted/40')}>
                      <button type="button" onClick={() => setFocusId(o.id)} className="text-left" aria-current={focus?.id === o.id ? 'true' : undefined}>
                        <LeadingTile sectionId="occasions" Icon={Gift} size="md" />
                        <ListItemContent>
                          <ListItemTitle>
                            <span className="truncate">{occasionTitle(o, currentUserId)}</span>
                          </ListItemTitle>
                          <ListItemMeta>
                            <span className="truncate">{occasionSubtitle(o, api.ideas, currentUserId, memberProfiles)}</span>
                          </ListItemMeta>
                        </ListItemContent>
                        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{occasionWhenLabel(o, today)}</span>
                      </button>
                    </ListItem>
                  ))}
                </ListGroup>
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className={MICRO}>My wishlist</p>
                <span className="px-1 text-[11px] text-muted-foreground">Everyone can see this</span>
              </div>
              <ListGroup>
                {mine.map((w) => (
                  <ListItem key={w.id} asChild className="cursor-pointer hover:bg-muted/50">
                    <button type="button" onClick={() => setEditingWish({ id: w.id })} className="text-left">
                      <ListItemContent>
                        <ListItemTitle>
                          <span className="truncate">{w.title}</span>
                        </ListItemTitle>
                        {w.notes && (
                          <ListItemMeta>
                            <span className="truncate">{w.notes}</span>
                          </ListItemMeta>
                        )}
                      </ListItemContent>
                      {w.price_cents ? <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{formatMoney(w.price_cents)}</span> : null}
                    </button>
                  </ListItem>
                ))}
                <ListItem asChild className="cursor-pointer hover:bg-muted/50">
                  <button type="button" onClick={() => setEditingWish({ id: null })} className="text-left text-primary">
                    <Plus className="size-[18px] shrink-0" />
                    <ListItemContent className="self-center">
                      <ListItemTitle>{mine.length ? 'Add to your wishlist' : 'Start your wishlist'}</ListItemTitle>
                    </ListItemContent>
                  </button>
                </ListItem>
              </ListGroup>
            </div>

            {othersLists.map(([userId, items]) => (
              <OtherWishlist key={userId} userId={userId} items={items} api={api} me={currentUserId} profiles={memberProfiles} />
            ))}
          </div>
        </div>
      )}

      {editingOccasion && (
        <OccasionFormSheet
          key={editingOccasion.id ?? 'new'}
          isOpen
          onClose={() => setEditingOccasion(null)}
          occasion={editingOccasionRow}
          api={api}
          groupId={group.id}
          currentUserId={currentUserId}
          members={groupMembers}
          profiles={memberProfiles}
          onSaved={(o) => setFocusId(o.id)}
          calendar={modules.feature('calendar.occasions') && modules.server('occasions.calendar')}
        />
      )}

      {editingIdea && (
        <IdeaFormSheet
          key={editingIdea.id ?? 'new'}
          isOpen
          onClose={() => setEditingIdea(null)}
          idea={editingIdeaRow}
          occasion={ideaOccasion}
          api={api}
          groupId={group.id}
          currentUserId={currentUserId}
          members={groupMembers}
          profiles={memberProfiles}
          features={features}
        />
      )}

      {editingWish && (
        <WishFormSheet
          key={editingWish.id ?? 'new'}
          isOpen
          onClose={() => setEditingWish(null)}
          item={editingWishRow}
          api={api}
          groupId={group.id}
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
}

/** The occasion in focus: its ideas and budget, or on your own day only a note. */
function FocusBlock({
  occasion,
  api,
  me,
  profiles,
  onEditOccasion,
  onAddIdea,
  onOpenIdea,
}: {
  occasion: Occasion;
  api: OccasionsApi;
  me: string;
  profiles: MemberProfiles;
  onEditOccasion: () => void;
  onAddIdea: () => void;
  onOpenIdea: (idea: GiftIdea) => void;
}) {
  const own = isOwnOccasion(occasion, me);
  const ideas = ideasForOccasion(api.ideas, occasion.id);
  const who = personName({ userId: occasion.person_id, name: occasion.person_name }, profiles);
  // "Kept from Tegan" heads the list when every idea is kept from the person it's for.
  const person = occasion.person_id && occasion.person_id !== me ? occasion.person_id : null;
  const allKept = !!person && ideas.length > 0 && ideas.every((i) => i.hidden_from.includes(person));
  const kept = allKept ? keptFromLabel([person], profiles) : null;
  const { spent } = occasionSpend(ideas);
  const budget = occasion.budget_cents
    ? spent
      ? `${formatMoney(spent)} of ${formatMoney(occasion.budget_cents)}`
      : `${formatMoney(occasion.budget_cents)} budget`
    : null;
  const head = [kept, budget].filter(Boolean).join(' · ');

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className={MICRO}>{own ? occasionTitle(occasion, me) : who ? `Ideas for ${who}` : occasion.title}</p>
        <button type="button" onClick={onEditOccasion} className="min-h-9 px-1 text-[12.5px] font-medium text-primary hover:underline">
          Edit
        </button>
      </div>
      {own ? (
        <div className="space-y-1 rounded-xl bg-muted/30 px-4 py-6 text-center">
          <Gift className="mx-auto size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nothing to see here. Your wishlist is where you can drop hints.</p>
        </div>
      ) : (
        <ListGroup>
          {head && (
            <div className="px-3.5 py-2 text-xs text-muted-foreground">{head}</div>
          )}
          {ideas.map((idea) => (
            <ListItem key={idea.id} asChild className="cursor-pointer hover:bg-muted/50">
              <button type="button" onClick={() => onOpenIdea(idea)} className="text-left">
                <ListItemContent>
                  <ListItemTitle>
                    <span className="truncate">{idea.title}</span>
                  </ListItemTitle>
                  <ListItemMeta>
                    <span className="truncate">
                      {[ideaStatusLine(idea, (c) => formatMoney(c)), forLabel(idea, occasion, profiles), allKept ? null : keptFromLabel(idea.hidden_from, profiles)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </ListItemMeta>
                </ListItemContent>
              </button>
            </ListItem>
          ))}
          <ListItem asChild className="cursor-pointer hover:bg-muted/50">
            <button type="button" onClick={onAddIdea} className="text-left text-primary">
              <Plus className="size-[18px] shrink-0" />
              <ListItemContent className="self-center">
                <ListItemTitle>Add a gift idea</ListItemTitle>
              </ListItemContent>
            </button>
          </ListItem>
        </ListGroup>
      )}
    </div>
  );
}

/** Only when the idea is for someone other than the occasion's person (Christmas lists). */
function forLabel(idea: GiftIdea, occasion: Occasion, profiles: MemberProfiles): string | null {
  if (idea.for_user_id && idea.for_user_id === occasion.person_id) return null;
  const name = personName({ userId: idea.for_user_id, name: idea.for_name }, profiles);
  return name ? `for ${name}` : null;
}

/** Another member's wishlist, with "I'll get this" on each wish nobody has taken. */
function OtherWishlist({
  userId,
  items,
  api,
  me,
  profiles,
}: {
  userId: string;
  items: WishlistItem[];
  api: OccasionsApi;
  me: string;
  profiles: MemberProfiles;
}) {
  const name = memberFirstName(userId, profiles);
  return (
    <div className="space-y-1.5">
      <p className={MICRO}>{name}&apos;s wishlist</p>
      <ListGroup>
        {items.map((w) => {
          const taken = takenBy(w, api.ideas);
          const meta = [w.price_cents ? formatMoney(w.price_cents) : null, w.notes].filter(Boolean).join(' · ');
          return (
            <ListItem key={w.id}>
              <ListItemContent>
                <ListItemTitle>
                  {w.url ? (
                    <a href={w.url} target="_blank" rel="noreferrer" className="truncate hover:underline">
                      {w.title}
                    </a>
                  ) : (
                    <span className="truncate">{w.title}</span>
                  )}
                </ListItemTitle>
                {meta && (
                  <ListItemMeta>
                    <span className="truncate">{meta}</span>
                  </ListItemMeta>
                )}
              </ListItemContent>
              {taken ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {taken.created_by === me ? "You're getting it" : `${memberFirstName(taken.created_by ?? '', profiles)} is getting it`}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => api.takeWish(w)}
                  className="min-h-9 shrink-0 rounded-full bg-muted px-3 text-[12.5px] font-medium text-foreground hover:bg-muted/70"
                >
                  I&apos;ll get this
                </button>
              )}
            </ListItem>
          );
        })}
      </ListGroup>
      <p className="px-1 text-[11px] text-muted-foreground">{name} won&apos;t see who is getting what.</p>
    </div>
  );
}
