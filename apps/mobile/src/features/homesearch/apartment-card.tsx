// HOUP-78: native port of apps/web/src/components/apartment-card.tsx — the
// media-rich apartment listing card shown in the grid. Built on @homeup/ui's
// `Card` (not `ListItem`/`ListGroup`: a photo carousel + overlaid score
// badges + inline scoring/comments don't fit the three-slot line-item
// anatomy — checked apps/mobile/src/features/costs/cost-card.tsx, the one
// other "rich card in a list" in this app, and it's actually a plain
// `ListItem` row, so there's no precedent to follow here). Card's own `py-4`
// vertical padding is overridden to `py-0` so the header photo/map tile can
// bleed edge-to-edge; every section below adds its own `px-4`/`pt-*` instead
// (the ported Card dropped web's `:has(>img:first-child)` CSS trick, per its
// own header comment, so this replaces it).
//
// Deliberate differences from the web original:
// - Drops `showMap` — `MapPlaceholderTile` fills the web original's "static
//   map preview" branch (photo missing, lat/lng present). HOUP-233
//   reinstated the third "neither" branch (badge-only strip, no media tile)
//   that a prior pass (HOUP-78) had collapsed into an unconditional
//   MapPlaceholderTile fallback — see the three-branch split in this file's
//   JSX for the header area. The real native map surface still lands in the
//   sibling ticket HOUP-109.
// - HOUP-174 (item 6) reinstates a compact "Booked" image overlay badge:
//   the embedded `<ApartmentAppointment>` block further down still carries
//   the full scheduled/viewed detail, but that block sits below the fold on
//   longer cards, so a small badge on the header photo now gives an
//   at-a-glance signal without scrolling. HOUP-233 restyled it from a solid
//   `bg-primary` fill to `bg-black/70` + primary text/icon, matching web's
//   apartment-card.tsx:251-258 (no `expo-blur` dependency added for the
//   backdrop-blur, and no `ring` utility — see ScoreBadge's own header
//   comment for why this codebase's NativeWind setup drops `ring`).
// - HOUP-233 adds a footer appointment-status chip (Booked/Visited/Skipped/
//   Rebook/Optional, parity with web's apartment-card.tsx:530-549) and an
//   explicit triage "Clear" affordance next to the disposition pill row.
// - Booking reuses `<ApartmentAppointment apartmentId={apartment.id} />`
//   wholesale instead of a compact icon + a locally-wired `AppointmentModal`
//   — it already resolves apartment/agent/agents/groupId itself, so this
//   card doesn't need its own appointments$/agents$ subscriptions either.
// - Swaps the web original's 🛒/🚉 nearby-POI emoji for `ShoppingCart`/
//   `TrainFront` icons — Hearth's "no emoji in chrome" rule (HA).
// - Drops the `sonner` toast on archive/delete (no toast primitive is
//   ported to native yet); a `haptics` cue substitutes, matching the
//   feedback convention already used by e.g. app/setup/index.tsx.
// - Reuses `@homeup/core`'s `timeAgo()` instead of porting web's local
//   `timeAgo` helper (same relative-time convention `apartment-comments.tsx`
//   already uses here).
// - The inline comment composer is a trimmed `Input` + send `Button` (mirrors
//   the web original's own inline form, not the full `ApartmentComments`
//   thread component, which is too much UI for a card) — full commenting
//   stays on the detail screen.
// - Hearth v2 pass: the rent-position left rail (a retired "coloured rail")
//   is now a status dot before the rent, score pills are tinted values on a
//   glass chip instead of filled blocks (H2), agents are identity dot + name,
//   and the footer status reads a relative day ("Booked tomorrow"). Mirrors
//   web's apartment-card.tsx.
import * as React from 'react';
import { Image, Linking, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { use$ } from '@legendapp/state/react';
import {
  Archive,
  ArchiveRestore,
  Bath,
  Bed,
  CalendarDays,
  Car,
  Clock,
  ExternalLink,
  MapPin,
  MessageSquare,
  Send,
  ShoppingCart,
  Trash2,
  TrainFront,
} from 'lucide-react-native';
import { Text, Button, Card, Input, cn, haptics } from '@homeup/ui';
import {
  apartmentComments$,
  apartmentPhotoUrls,
  apartments$,
  appointments$,
  formatRelativeDay,
  formatMoney,
  timeAgo,
  useReconnectSync,
  useStoreHelpers,
  type Agent,
  type Appointment,
  type ApartmentComment,
  type ApartmentWithScore,
  dialog,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { randomUUID } from '@/lib/uuid';
import { ImageCarousel } from './image-carousel';
import { ScoreBadge } from './score-badge';
import { PreliminaryScorePill, PreliminaryScoreInput } from './preliminary-score';
import { MapPlaceholderTile } from './map-placeholder-tile';
import { ApartmentAppointment } from './apartment-appointment';

/**
 * Where the rent sits in the household's range, as a status dot (H2: a dot,
 * not the retired coloured rail). Low third success, middle warning, top
 * third danger. Mirrors web's apartment-card.tsx.
 */
function rentTone(rent: number, min: number, max: number): { dot: string; label: string } {
  const t = min >= max ? 0 : Math.max(0, Math.min(1, (rent - min) / (max - min)));
  if (t < 1 / 3) return { dot: 'bg-success', label: 'Low in your rent range' };
  if (t < 2 / 3) return { dot: 'bg-warning', label: 'Mid rent range' };
  return { dot: 'bg-destructive', label: 'High in your rent range' };
}

/** H6: a booking day as a fragment: "tomorrow", "Tuesday", "Oct 25". */
function bookingDay(dateStr: string): string {
  const d = new Date(dateStr);
  const rel = formatRelativeDay(d);
  if (rel === 'Today' || rel === 'Tomorrow') return rel.toLowerCase();
  if (!rel.includes(',')) return rel;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getScoreColor(score: number): string {
  if (score >= 8) return 'text-success';
  if (score >= 5) return 'text-warning';
  return 'text-destructive';
}

export function UserScoreChip({ score: s }: { score: { id: string; user_id: string; score: number } }) {
  const { memberProfiles, currentUserId } = useDataCache();
  const profile = memberProfiles[s.user_id];
  const name = s.user_id === currentUserId ? 'You' : profile?.name || profile?.email?.split('@')[0] || '?';
  const avatar = profile?.avatar;

  // PC1: not a chip (chip shape is the tappable contract); avatar + tinted value.
  return (
    <View className="flex-row items-center gap-1" accessibilityLabel={`${name}: ${s.score} of 10`}>
      {avatar ? (
        <Image source={{ uri: avatar }} className="h-4 w-4 rounded-full" />
      ) : (
        <View className="h-4 w-4 items-center justify-center rounded-full bg-muted-foreground/20">
          <Text className="text-[9px] font-bold uppercase text-muted-foreground">{name.charAt(0)}</Text>
        </View>
      )}
      <Text
        className={cn('text-xs font-semibold tabular-nums', getScoreColor(s.score))}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {s.score}
      </Text>
    </View>
  );
}

const DISPOSITION_OPTIONS: { value: NonNullable<ApartmentWithScore['disposition']>; label: string }[] = [
  { value: 'to_book', label: 'To book' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'rebook', label: 'Rebook' },
];

export interface ApartmentCardProps {
  apartment: ApartmentWithScore;
  agent?: Agent | null;
  agents?: Agent[];
  commentCount?: number;
  latestComments?: Pick<ApartmentComment, 'content' | 'user_id' | 'created_at'>[];
  rentMin?: number | null;
  rentMax?: number | null;
  onDelete?: (id: string) => void;
}

export function ApartmentCard({
  apartment,
  agent,
  agents: linkedAgents,
  commentCount,
  latestComments,
  rentMin,
  rentMax,
  onDelete,
}: ApartmentCardProps) {
  const router = useRouter();
  const { score } = apartment;
  const { memberProfiles, currentUserId, group } = useDataCache();

  const apts$ = apartments$(group?.id);
  useReconnectSync(apts$);
  const { patchRow: patchApartment, softDeleteRow: softDeleteApartment } = useStoreHelpers(apts$, currentUserId);

  const commentsStore$ = apartmentComments$(group?.id);
  useReconnectSync(commentsStore$);
  const { writeRow: writeComment } = useStoreHelpers(commentsStore$, currentUserId);

  // HOUP-174 (item 6) / HOUP-233: read locally rather than threaded down
  // through ApartmentGrid's props (mirrors ApartmentAppointment's own
  // apartmentId-scoped appointments$ subscription just below in this card).
  // Drives both the "Booked" image overlay badge and the footer status chip.
  const apptsStore$ = appointments$(group?.id);
  useReconnectSync(apptsStore$);
  const cardAppointment = use$(() =>
    Object.values(apptsStore$.get() ?? {}).find(
      (a): a is Appointment => !!a && !a.deleted && a.apartment_id === apartment.id
    )
  );
  const isBooked = cardAppointment?.status === 'scheduled';

  const [photoUrls, setPhotoUrls] = React.useState<string[]>([]);
  const [archiving, setArchiving] = React.useState(false);
  const [commentOpen, setCommentOpen] = React.useState(false);
  const [commentText, setCommentText] = React.useState('');
  const [commentSubmitting, setCommentSubmitting] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getCurrentSupabaseClient();
      const { data } = await supabase
        .from('photos')
        .select('storage_path, is_main')
        .eq('apartment_id', apartment.id)
        .order('is_main', { ascending: false })
        .order('created_at', { ascending: true });

      if (cancelled || !data || data.length === 0) return;

      const urls = await apartmentPhotoUrls(supabase, data);
      if (!cancelled) setPhotoUrls(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [apartment.id]);

  const handleArchiveToggle = () => {
    setArchiving(true);
    patchApartment(apartment.id, { archived: !apartment.archived });
    haptics.success();
    setArchiving(false);
  };

  const handleDelete = () => {
    dialog.alert('Delete this apartment?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          softDeleteApartment(apartment.id);
          onDelete?.(apartment.id);
        },
      },
    ]);
  };

  const handleAddComment = () => {
    const content = commentText.trim();
    if (!content || !currentUserId || !group?.id || commentSubmitting) return;
    setCommentSubmitting(true);
    writeComment({
      id: randomUUID(),
      group_id: group.id,
      apartment_id: apartment.id,
      user_id: currentUserId,
      content,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
      deleted: false,
    });
    setCommentText('');
    setCommentOpen(false);
    setCommentSubmitting(false);
  };

  const setDisposition = (value: NonNullable<ApartmentWithScore['disposition']>) => {
    patchApartment(apartment.id, { disposition: apartment.disposition === value ? null : value });
  };

  const listingUrl = apartment.listing_url ? apartment.listing_url.replace(/\.pdf$/i, '') : null;
  const handleOpenListing = () => {
    if (listingUrl) void Linking.openURL(listingUrl);
  };

  const hasDetails =
    apartment.rent_per_week != null || apartment.bedrooms != null || apartment.bathrooms != null || !!apartment.parking;

  const displayAgents = linkedAgents?.length ? linkedAgents : agent ? [agent] : [];
  const visibleAgents = displayAgents.slice(0, 2);
  const overflowAgents = displayAgents.length - 2;

  const rentDot =
    rentMin == null || rentMax == null || apartment.rent_per_week == null
      ? null
      : rentTone(apartment.rent_per_week, rentMin, rentMax);

  const scoreBadges = (overlay: boolean) => (
    <>
      {apartment.preliminaryAvg != null && (
        <PreliminaryScorePill
          averageScore={apartment.preliminaryAvg}
          count={apartment.preliminaryScores?.length ?? 0}
          overlay={overlay}
        />
      )}
      {score && <ScoreBadge percentage={score.percentage} hasDealbreakers={score.dealbreakers.length > 0} overlay={overlay} />}
    </>
  );

  return (
    <Pressable
      onPress={() => router.push(`/apartment/${apartment.id}`)}
      accessibilityRole="button"
      className="active:opacity-90"
    >
      <Card className={cn('gap-3 overflow-hidden rounded-3xl py-0', apartment.archived && 'border-dashed opacity-60')}>
        {/* Image / map / badge-only header — HOUP-233: three branches mirror
            web's apartment-card.tsx (photo / map-preview / neither). Scores
            ride the photo as glass chips with the status hue on the value. */}
        {photoUrls.length > 0 ? (
          <View className="relative aspect-[3/2] w-full overflow-hidden bg-muted">
            <ImageCarousel images={photoUrls} alt={apartment.address} className="h-full" />
            {(apartment.preliminaryAvg != null || score) && (
              <View className="absolute left-2.5 top-2.5 flex-row items-center gap-1.5" pointerEvents="none">
                {scoreBadges(true)}
              </View>
            )}
            {/* Booked overlay: a state, so a neutral glass chip (H2: not coral). */}
            {isBooked && (
              <View
                className="absolute right-2.5 top-2.5 flex-row items-center gap-1 rounded-full bg-background/85 px-2.5 py-1 shadow-sm"
                pointerEvents="none"
              >
                <CalendarDays size={13} className="text-muted-foreground" />
                <Text className="text-xs font-medium text-foreground">Booked</Text>
              </View>
            )}
          </View>
        ) : apartment.lat != null && apartment.lng != null ? (
          <View className="relative aspect-[3/2] w-full overflow-hidden bg-muted">
            <MapPlaceholderTile
              address={apartment.address}
              lat={apartment.lat}
              lng={apartment.lng}
              variant="card"
              className="h-full w-full"
            />
            {(apartment.preliminaryAvg != null || score) && (
              <View className="absolute left-2.5 top-2.5 flex-row items-center gap-1.5" pointerEvents="none">
                {scoreBadges(true)}
              </View>
            )}
          </View>
        ) : (apartment.preliminaryAvg != null || score) ? (
          <View className="flex-row items-center gap-3 px-4 pt-4">{scoreBadges(false)}</View>
        ) : null}

        {/* Address + suburb */}
        <View className="gap-2 px-4 pt-3">
          <View>
            <Text numberOfLines={1} className="text-body font-semibold text-foreground">
              {apartment.address}
            </Text>
            {apartment.suburb && (
              <View className="mt-0.5 flex-row items-center gap-1">
                <MapPin size={12} className="text-muted-foreground" />
                <Text className="text-caption text-muted-foreground">{apartment.suburb}</Text>
              </View>
            )}
          </View>

          {/* Rent first (value-first, tabular), then rooms */}
          {hasDetails && (
            <View className="flex-row flex-wrap items-center gap-x-3.5 gap-y-1">
              {apartment.rent_per_week != null && (
                <View className="flex-row items-center gap-1.5">
                  {rentDot && (
                    <View accessibilityLabel={rentDot.label} className={cn('h-1.5 w-1.5 rounded-full', rentDot.dot)} />
                  )}
                  <Text className="text-caption font-semibold tabular-nums text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                    {formatMoney(Math.round(apartment.rent_per_week * 100))}
                    <Text className="text-xs font-medium text-muted-foreground">/wk</Text>
                  </Text>
                </View>
              )}
              {apartment.bedrooms != null && (
                <View className="flex-row items-center gap-1">
                  <Bed size={14} className="text-muted-foreground" />
                  <Text className="text-caption text-muted-foreground">{apartment.bedrooms}</Text>
                </View>
              )}
              {apartment.bathrooms != null && (
                <View className="flex-row items-center gap-1">
                  <Bath size={14} className="text-muted-foreground" />
                  <Text className="text-caption text-muted-foreground">{apartment.bathrooms}</Text>
                </View>
              )}
              {apartment.parking && <Car size={14} className="text-muted-foreground" />}
            </View>
          )}

          {/* Nearby POI distances */}
          {(apartment.nearest_supermarket_m != null || apartment.nearest_transport_m != null) && (
            <View className="flex-row items-center gap-3.5">
              {apartment.nearest_supermarket_m != null && (
                <View className="flex-row items-center gap-1">
                  <ShoppingCart size={13} className="text-muted-foreground" />
                  <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                    ~{apartment.nearest_supermarket_m}m
                  </Text>
                </View>
              )}
              {apartment.nearest_transport_m != null && (
                <View className="flex-row items-center gap-1">
                  <TrainFront size={13} className="text-muted-foreground" />
                  <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                    ~{apartment.nearest_transport_m}m
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Agents: identity dot + name (people identity, not a filled pill) */}
          {visibleAgents.length > 0 && (
            <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
              {visibleAgents.map((a) => (
                <View key={a.id} className="flex-row items-center gap-1.5">
                  <View className="h-2 w-2 rounded-full" style={{ backgroundColor: a.color }} />
                  <Text className="text-xs text-muted-foreground">{a.name}</Text>
                </View>
              ))}
              {overflowAgents > 0 && <Text className="text-xs text-muted-foreground">+{overflowAgents}</Text>}
            </View>
          )}

          {/* Notes — 1 line only */}
          {apartment.notes && (
            <Text numberOfLines={1} className="text-caption text-muted-foreground/70">
              {apartment.notes}
            </Text>
          )}

          {/* Latest comments preview */}
          {latestComments && latestComments.length > 0 && (
            <View className="gap-1 border-t border-border/40 pt-2">
              {latestComments.map((c, i) => {
                const profile = memberProfiles[c.user_id];
                const name = c.user_id === currentUserId ? 'You' : profile?.name || profile?.email?.split('@')[0] || '?';
                const avatar = profile?.avatar;
                return (
                  <View key={i} className="flex-row items-start gap-1.5">
                    {avatar ? (
                      <Image source={{ uri: avatar }} className="mt-0.5 h-4 w-4 rounded-full" />
                    ) : (
                      <View className="mt-0.5 h-4 w-4 items-center justify-center rounded-full bg-muted-foreground/20">
                        <Text className="text-[8px] font-bold uppercase text-muted-foreground">{name.charAt(0)}</Text>
                      </View>
                    )}
                    <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
                      <Text className="font-medium text-foreground/80">{name} </Text>
                      {c.content}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* User scores inline */}
          {(apartment.preliminaryScores?.length ?? 0) > 0 && (
            <View className="flex-row flex-wrap items-center gap-3">
              {apartment.preliminaryScores!.map((s) => (
                <UserScoreChip key={s.id} score={s} />
              ))}
            </View>
          )}
        </View>

        {/* Your preliminary score */}
        <View className="gap-2 border-t border-border/40 px-4 pt-2.5">
          <PreliminaryScoreInput apartmentId={apartment.id} scores={apartment.preliminaryScores ?? []} />
        </View>

        {/* Inline comment composer */}
        {commentOpen && (
          <View className="flex-row items-center gap-1.5 px-4">
            <Input
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Add a comment…"
              editable={!commentSubmitting}
              autoFocus
              returnKeyType="send"
              onSubmitEditing={handleAddComment}
              className="flex-1"
            />
            <Button
              size="icon-sm"
              onPress={handleAddComment}
              disabled={commentSubmitting || !commentText.trim()}
              accessibilityLabel="Post comment"
            >
              <Send size={14} className="text-primary-foreground" />
            </Button>
          </View>
        )}

        {/* Disposition / triage — HOUP-233: explicit Clear affordance next to
            the toggle row. Tapping the active pill again already clears it
            (setDisposition toggles to null), but that requires knowing the
            "tap again" gesture; web's <select> exposes the null option
            directly ("— Triage —"), so this adds an equivalent visible
            escape hatch instead of relying on the toggle-again behavior. */}
        <View className="flex-row flex-wrap items-center gap-1.5 px-4">
          {DISPOSITION_OPTIONS.map((opt) => {
            const active = apartment.disposition === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setDisposition(opt.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className={cn(
                  'h-9 justify-center rounded-lg border px-3',
                  active ? 'border-primary/40 bg-primary/10' : 'border-border/60 bg-muted/40'
                )}
              >
                <Text className={cn('text-xs font-medium', active ? 'text-primary' : 'text-muted-foreground')}>{opt.label}</Text>
              </Pressable>
            );
          })}
          {apartment.disposition && (
            <Pressable
              onPress={() => patchApartment(apartment.id, { disposition: null })}
              hitSlop={8}
              accessibilityRole="button"
              className="h-9 justify-center px-2"
            >
              <Text className="text-xs font-medium text-muted-foreground">Clear</Text>
            </Pressable>
          )}
        </View>

        {/* Book / manage viewing appointment */}
        <View className="px-4">
          <ApartmentAppointment apartmentId={apartment.id} />
        </View>

        {/* Actions */}
        <View className="flex-row items-center justify-between px-4 pb-3 pt-1">
          <View className="flex-row items-center gap-0.5">
            {listingUrl && (
              <Button variant="ghost" size="icon-lg" onPress={handleOpenListing} accessibilityLabel="Open listing">
                <ExternalLink size={16} className="text-muted-foreground" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-lg"
              onPress={() => setCommentOpen((v) => !v)}
              accessibilityLabel="Add comment"
            >
              <MessageSquare size={16} className={commentOpen ? 'text-primary' : 'text-muted-foreground'} />
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              onPress={handleArchiveToggle}
              disabled={archiving}
              accessibilityLabel={apartment.archived ? 'Unarchive' : 'Archive'}
            >
              {apartment.archived ? (
                <ArchiveRestore size={16} className="text-muted-foreground" />
              ) : (
                <Archive size={16} className="text-muted-foreground" />
              )}
            </Button>
            <Button variant="ghost" size="icon-lg" onPress={handleDelete} accessibilityLabel="Delete">
              <Trash2 size={16} className="text-muted-foreground" />
            </Button>
          </View>

          <View className="flex-row items-center gap-2.5">
            {/* HOUP-233: appointment status chip, parity with web's
                apartment-card.tsx:530-549 statusConfig map — a second,
                compact status readout alongside the top-of-card "Booked"
                overlay badge and the full <ApartmentAppointment> control
                above, so the status is scannable without scrolling back up. */}
            {cardAppointment && (() => {
              const day = bookingDay(cardAppointment.scheduled_at);
              // H2: appointment state as a word; only Visited/Rebook take a status hue.
              const statusConfig: Partial<Record<Appointment['status'], { label: string; className: string }>> = {
                scheduled: { label: `Booked ${day}`, className: 'text-foreground' },
                viewed: { label: 'Visited', className: 'text-success' },
                skipped: { label: 'Skipped', className: 'text-muted-foreground' },
                rebook: { label: 'Rebook', className: 'text-warning' },
                optional: { label: `Optional ${day}`, className: 'text-muted-foreground' },
              };
              const cfg = statusConfig[cardAppointment.status];
              if (!cfg) return null;
              return (
                <View className="flex-row items-center gap-1">
                  <CalendarDays size={13} className="text-muted-foreground" />
                  <Text numberOfLines={1} className={cn('text-xs font-medium', cfg.className)}>{cfg.label}</Text>
                </View>
              );
            })()}
            {!!commentCount && (
              <View className="flex-row items-center gap-1">
                <MessageSquare size={12} className="text-muted-foreground/70" />
                <Text className="text-xs text-muted-foreground/70" style={{ fontVariant: ['tabular-nums'] }}>{commentCount}</Text>
              </View>
            )}
            <View className="flex-row items-center gap-1">
              <Clock size={12} className="text-muted-foreground/70" />
              <Text className="text-xs text-muted-foreground/70">{timeAgo(apartment.created_at)}</Text>
            </View>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}
