'use client';

// Occasions: birthdays, anniversaries and other days, the gift ideas for
// them, and everyone's wishlists. The lede is the next day coming up (H1);
// under it, the ideas for the occasion in focus, then every occasion, then
// the wishlists. A gift kept from someone never reaches their device (the
// database drops it), so on their own day a member sees only their wishlist.
// Native twin: apps/mobile/src/app/(tabs)/occasions/index.tsx.
import { useCallback, useState } from 'react';
import { Gift, Plus } from 'lucide-react';
import {
  confirmRemoveIdea,
  formatMoney,
  giftIdeaRowMenu,
  ideaRowMeta,
  memberFirstName,
  occasionFocusView,
  occasionSubtitle,
  occasionTitle,
  occasionWhenLabel,
  setIdeaStatus,
  takenBy,
  useModules,
  useOccasions,
  useOccasionsScreen,
  wishMeta,
  wishTakenLabel,
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
import { useRowContextMenu } from '@/components/ui/row-context-menu';
import { cn } from '@/lib/utils';
import { IdeaCard } from './idea-card';
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
  const { today, focus, setFocusId, mine, othersLists, lede, empty } = useOccasionsScreen(api, currentUserId);

  const [editingOccasion, setEditingOccasion] = useState<{ id: string | null } | null>(null);
  const [editingIdea, setEditingIdea] = useState<{ id: string | null; occasionId: string | null } | null>(null);
  const [editingWish, setEditingWish] = useState<{ id: string | null } | null>(null);
  const [openIdea, setOpenIdea] = useState<string | null>(null);
  const closeIdea = useCallback(() => setOpenIdea(null), []);

  if (cacheLoading || (!api.loaded && api.occasions.length === 0)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group || !currentUserId) return <div className="p-6 text-muted-foreground">No group selected</div>;

  const editingOccasionRow = editingOccasion?.id ? api.occasionById.get(editingOccasion.id) : undefined;
  const editingIdeaRow = editingIdea?.id ? api.ideas.find((i) => i.id === editingIdea.id) : undefined;
  const editingWishRow = editingWish?.id ? api.wishlist.find((w) => w.id === editingWish.id) : undefined;
  const ideaOccasion = editingIdea ? (editingIdea.occasionId ? api.occasionById.get(editingIdea.occasionId) ?? null : null) : null;

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
                onOpenIdea={(idea) => setOpenIdea(idea.id)}
                onEditIdea={(idea) => setEditingIdea({ id: idea.id, occasionId: idea.occasion_id })}
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

      {openIdea && (
        <IdeaCard
          key={openIdea}
          ideaId={openIdea}
          onClose={closeIdea}
          onEditAll={(idea) => {
            setOpenIdea(null);
            setEditingIdea({ id: idea.id, occasionId: idea.occasion_id });
          }}
          api={api}
          currentUserId={currentUserId}
          members={groupMembers}
          profiles={memberProfiles}
          features={features}
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
  onEditIdea,
}: {
  occasion: Occasion;
  api: OccasionsApi;
  me: string;
  profiles: MemberProfiles;
  onEditOccasion: () => void;
  onAddIdea: () => void;
  onOpenIdea: (idea: GiftIdea) => void;
  onEditIdea: (idea: GiftIdea) => void;
}) {
  const { own, ideas, allKept, heading, head } = occasionFocusView(occasion, api.ideas, me, profiles);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className={MICRO}>{heading}</p>
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
            <IdeaRow
              key={idea.id}
              idea={idea}
              meta={ideaRowMeta(idea, occasion, profiles, allKept)}
              api={api}
              onOpen={() => onOpenIdea(idea)}
              onEdit={() => onEditIdea(idea)}
            />
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

/**
 * A gift idea row: a tap opens its card; right-click (or a long press on a
 * touch screen) brings the row menu with Edit (Hearth §13.7).
 */
function IdeaRow({
  idea,
  meta,
  api,
  onOpen,
  onEdit,
}: {
  idea: GiftIdea;
  meta: string;
  api: OccasionsApi;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const rowMenu = useRowContextMenu(() =>
    giftIdeaRowMenu(idea, {
      onOpen,
      onOpenLink: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
      onStatus: (status) => setIdeaStatus(api, idea, status),
      onEdit,
      onRemove: () => void confirmRemoveIdea(api, idea),
    }),
  );
  // The menu renders beside the row: clicks inside it must not reach the row's button.
  return (
    <>
      <ListItem asChild className="cursor-pointer hover:bg-muted/50">
        <button
          type="button"
          onClick={onOpen}
          onContextMenu={(e) => {
            if (rowMenu.onContextMenu(e)) return;
            // Touch: a long press opens the full edit form.
            e.preventDefault();
            onEdit();
          }}
          className="text-left"
        >
          <ListItemContent>
            <ListItemTitle>
              <span className="truncate">{idea.title}</span>
            </ListItemTitle>
            <ListItemMeta>
              <span className="truncate">{meta}</span>
            </ListItemMeta>
          </ListItemContent>
        </button>
      </ListItem>
      {rowMenu.menu}
    </>
  );
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
          const meta = wishMeta(w);
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
                  {wishTakenLabel(taken, me, profiles)}
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
