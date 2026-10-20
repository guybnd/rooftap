"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Bed, Bath, Car, MapPin, ExternalLink, Trash2, Clock, MessageSquare, Archive, ArchiveRestore, CalendarDays, CalendarPlus, Send, ShoppingCart, TrainFront } from "lucide-react";
import { use$ } from "@legendapp/state/react";
import { ImageCarousel } from "@/components/image-carousel";
import { Card } from "@/components/ui/card";
import { ScoreBadge } from "@/components/score-badge";
import { PreliminaryScorePill, PreliminaryScoreInput } from "@/components/preliminary-score";
import { createClient } from "@/lib/supabase/client";
import { MiniMapPreview } from "@/components/mini-map-preview";
import { useDataCache } from "@/lib/data-cache";
import { AppointmentModal } from "@/components/appointment-modal";
import { cn } from "@/lib/utils";
import { apartmentPhotoUrls, formatRelativeDay, formatMoney, appointments$, apartments$, apartmentComments$, useReconnectSync, useStoreHelpers } from '@homeup/core';
import { toast } from "sonner";
import type { Agent, ApartmentWithScore, Appointment } from '@homeup/core';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
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
 * Where the rent sits in the household's range, as a status dot (H2: a dot,
 * not a coloured rail; the old 3px left rail was a retired pattern). Low
 * third success, middle warning, top third danger.
 */
function rentTone(rent: number, min: number, max: number): { dot: string; label: string } {
  const t = min >= max ? 0 : Math.max(0, Math.min(1, (rent - min) / (max - min)));
  if (t < 1 / 3) return { dot: "bg-success", label: "Low in your rent range" };
  if (t < 2 / 3) return { dot: "bg-warning", label: "Mid rent range" };
  return { dot: "bg-destructive", label: "High in your rent range" };
}

/** H6: a booking day as a fragment: "tomorrow", "Tuesday", "Oct 25". */
function bookingDay(dateStr: string): string {
  const d = new Date(dateStr);
  const rel = formatRelativeDay(d);
  if (rel === "Today" || rel === "Tomorrow") return rel.toLowerCase();
  if (!rel.includes(",")) return rel;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getScoreColor(score: number) {
  if (score >= 8) return "text-success";
  if (score >= 5) return "text-warning";
  return "text-destructive";
}

export function UserScoreChip({ score: s }: { score: { id: string; user_id: string; score: number } }) {
  const { memberProfiles, currentUserId } = useDataCache();
  const profile = memberProfiles[s.user_id];
  const name = s.user_id === currentUserId ? "You" : (profile?.name || profile?.email?.split("@")[0] || "?");
  const avatar = profile?.avatar;

  // PC1: not a chip (chip shape is the tappable contract); an avatar and a
  // tinted value, nothing else.
  return (
    <span className="inline-flex items-center gap-1" title={`${name}: ${s.score}/10`}>
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" className="h-4 w-4 rounded-full object-cover" />
      ) : (
        <span className="h-4 w-4 rounded-full bg-muted-foreground/20 flex items-center justify-center text-[9px] font-bold text-muted-foreground uppercase">
          {name.charAt(0)}
        </span>
      )}
      <span className={cn("text-xs font-semibold tabular-nums", getScoreColor(s.score))}>{s.score}</span>
    </span>
  );
}

interface ApartmentCardProps {
  apartment: ApartmentWithScore;
  agent?: Agent | null;
  agents?: Agent[];
  commentCount?: number;
  latestComments?: { content: string; user_id: string; created_at: string }[];
  rentMin?: number | null;
  rentMax?: number | null;
  showMap?: boolean;
  onDelete?: (id: string) => void;
}

export function ApartmentCard({ apartment, agent, agents: linkedAgents, commentCount, latestComments, rentMin, rentMax, showMap, onDelete }: ApartmentCardProps) {
  const { score } = apartment;
  const { memberProfiles, currentUserId, group } = useDataCache();
  const [deleteError, setDeleteError] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);


  const appts$ = appointments$(group?.id);
  useReconnectSync(appts$);
  const appointments = use$(() =>
    Object.values(appts$.get() ?? {}).filter((a): a is Appointment => !!a && !a.deleted)
  );

  const apts$ = apartments$(group?.id);
  useReconnectSync(apts$);
  const { patchRow: patchApartment, softDeleteRow: softDeleteApartment } = useStoreHelpers(apts$, currentUserId);
  const commentsStore$ = apartmentComments$(group?.id);
  useReconnectSync(commentsStore$);
  const { writeRow: writeComment } = useStoreHelpers(commentsStore$, currentUserId);

  const appointment = appointments.find((a) => a.apartment_id === apartment.id);

  useEffect(() => {
    async function loadPhotos() {
      const supabase = createClient();
      const { data } = await supabase
        .from("photos")
        .select("storage_path, is_main")
        .eq("apartment_id", apartment.id)
        .order("is_main", { ascending: false })
        .order("created_at", { ascending: true });

      if (!data || data.length === 0) return;

      setPhotoUrls(await apartmentPhotoUrls(supabase, data));
    }
    loadPhotos();
  }, [apartment.id]);

  const mainPhotoUrl = photoUrls[0] ?? null;
  const hasMultiplePhotos = photoUrls.length > 1;

  const handleImageAreaClick = useCallback((e: React.MouseEvent) => {
    if (hasMultiplePhotos && !(e.target as HTMLElement).closest("a")) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [hasMultiplePhotos]);

  const [archiving, setArchiving] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const commentInputRef = useRef<HTMLInputElement>(null);

  const handleArchiveToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setArchiving(true);
    const newArchived = !apartment.archived;
    patchApartment(apartment.id, { archived: newArchived });
    toast.success(newArchived ? "Apartment archived" : "Apartment restored");
    setArchiving(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this apartment?")) return;

    setDeleteError(false);
    softDeleteApartment(apartment.id);
    onDelete?.(apartment.id);
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const content = commentText.trim();
    if (!content || !currentUserId || !group?.id || commentSubmitting) return;
    setCommentSubmitting(true);
    writeComment({
      id: crypto.randomUUID(),
      group_id: group.id,
      apartment_id: apartment.id,
      user_id: currentUserId,
      content,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
      deleted: false,
    });
    setCommentText("");
    setCommentOpen(false);
    setCommentSubmitting(false);
  };

  const listingUrl = apartment.listing_url
    ? apartment.listing_url.replace(/\.pdf$/i, "")
    : null;

  const handleOpenListing = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (listingUrl) {
      window.open(listingUrl, "_blank", "noopener");
    }
  };

  const hasDetails = apartment.rent_per_week != null || apartment.bedrooms != null || apartment.bathrooms != null || apartment.parking;

  const rentDot =
    rentMin == null || rentMax == null || apartment.rent_per_week == null
      ? null
      : rentTone(apartment.rent_per_week, rentMin, rentMax);

  const displayAgents = linkedAgents?.length ? linkedAgents : agent ? [agent] : [];
  const visibleAgents = displayAgents.slice(0, 2);
  const overflowAgents = displayAgents.length - 2;

  const scoreBadges = (overlay: boolean) => (
    <>
      {apartment.preliminaryAvg != null && (
        <PreliminaryScorePill
          averageScore={apartment.preliminaryAvg}
          count={apartment.preliminaryScores?.length ?? 0}
          overlay={overlay}
        />
      )}
      {score && (
        <ScoreBadge
          percentage={score.percentage}
          hasDealbreakers={score.dealbreakers.length > 0}
          overlay={overlay}
        />
      )}
    </>
  );

  // H2: appointment state as a word; only Visited/Rebook take a status hue.
  const status = (() => {
    if (!appointment) return null;
    const day = bookingDay(appointment.scheduled_at);
    switch (appointment.status) {
      case "scheduled":
        return { label: `Booked ${day}`, cls: "text-foreground" };
      case "viewed":
        return { label: "Visited", cls: "text-success" };
      case "skipped":
        return { label: "Skipped", cls: "text-muted-foreground" };
      case "rebook":
        return { label: "Rebook", cls: "text-warning" };
      case "optional":
        return { label: `Optional ${day}`, cls: "text-muted-foreground" };
      default:
        return null;
    }
  })();

  const iconButton =
    "h-9 w-9 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/70 active:scale-95 transition-all";

  return (
    <Link href={`/apartment/${apartment.id}`} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-3xl">
      <Card className={cn(
        "h-full gap-0 rounded-3xl py-0 shadow-[var(--card-shadow)] transition-all duration-200 ease-out hover:border-primary/30 hover:-translate-y-0.5 overflow-hidden",
        deleteError && "border-destructive",
        apartment.archived && "border-dashed opacity-50"
      )}>
        {/* Image section: 3:2 aspect */}
        {mainPhotoUrl ? (
          <div className="relative aspect-[3/2] w-full overflow-hidden bg-muted" onClick={handleImageAreaClick}>
            {hasMultiplePhotos ? (
              <ImageCarousel
                images={photoUrls}
                alt={apartment.address}
                className="h-full"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mainPhotoUrl}
                alt={apartment.address}
                className="w-full h-full object-cover"
              />
            )}
            {/* Scores overlay: glass chips on the photo, status hue on the value only */}
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 pointer-events-none">
              {scoreBadges(true)}
            </div>
            {/* Appointment indicator (H2: a state, not coral) */}
            {appointment && appointment.status === "scheduled" && (
              <div className="absolute top-2.5 right-2.5 pointer-events-none">
                <span className="apt-booked-badge inline-flex items-center gap-1 rounded-full bg-background/85 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  Booked
                </span>
              </div>
            )}
          </div>
        ) : apartment.lat != null && apartment.lng != null ? (
          <div className="relative">
            <MiniMapPreview lat={apartment.lat} lng={apartment.lng} />
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
              {scoreBadges(true)}
            </div>
          </div>
        ) : (apartment.preliminaryAvg != null || score) ? (
          <div className="flex items-center gap-3 px-4 pt-4">
            {scoreBadges(false)}
          </div>
        ) : null}

        {/* Content */}
        <div className="px-4 pb-3 pt-3.5 space-y-2">
          {/* Address + suburb */}
          <div className="min-w-0">
            <h3 className="font-semibold text-[15px] leading-snug truncate">{apartment.address}</h3>
            {apartment.suburb && (
              <p className="text-[13px] text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" />
                {apartment.suburb}
              </p>
            )}
          </div>

          {/* Details row: rent first (value-first, tabular), then rooms */}
          {hasDetails ? (
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
              {apartment.rent_per_week != null && (
                <span className="flex items-center gap-1.5 font-semibold tabular-nums text-foreground">
                  {rentDot && (
                    <span
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", rentDot.dot)}
                      title={rentDot.label}
                      aria-label={rentDot.label}
                    />
                  )}
                  {formatMoney(Math.round(apartment.rent_per_week * 100))}
                  <span className="-ml-1 text-xs font-medium text-muted-foreground">/wk</span>
                </span>
              )}
              {apartment.bedrooms != null && (
                <span className="flex items-center gap-1 tabular-nums">
                  <Bed className="h-3.5 w-3.5" />
                  {apartment.bedrooms}
                </span>
              )}
              {apartment.bathrooms != null && (
                <span className="flex items-center gap-1 tabular-nums">
                  <Bath className="h-3.5 w-3.5" />
                  {apartment.bathrooms}
                </span>
              )}
              {apartment.parking && (
                <span className="flex items-center gap-1" aria-label="Parking">
                  <Car className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          ) : null}

          {/* Nearby POI distances (Lucide, not emoji: no emoji in chrome) */}
          {(apartment.nearest_supermarket_m != null || apartment.nearest_transport_m != null) && (
            <div className="flex items-center gap-3.5 text-xs text-muted-foreground tabular-nums">
              {apartment.nearest_supermarket_m != null && (
                <span className="flex items-center gap-1" title="Nearest supermarket">
                  <ShoppingCart className="h-3.5 w-3.5" />~{apartment.nearest_supermarket_m}m
                </span>
              )}
              {apartment.nearest_transport_m != null && (
                <span className="flex items-center gap-1" title="Nearest public transport">
                  <TrainFront className="h-3.5 w-3.5" />~{apartment.nearest_transport_m}m
                </span>
              )}
            </div>
          )}

          {/* Agents: identity dot + name (people identity, not a filled pill) */}
          {visibleAgents.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {visibleAgents.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
                  {a.name}
                </span>
              ))}
              {overflowAgents > 0 && <span className="tabular-nums">+{overflowAgents}</span>}
            </div>
          )}

          {/* Notes: 1 line only */}
          {apartment.notes && (
            <p className="text-xs text-muted-foreground/80 truncate leading-relaxed">
              {apartment.notes}
            </p>
          )}

          {/* Latest comments */}
          {latestComments && latestComments.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-border/40">
              {latestComments.map((c, i) => {
                const profile = memberProfiles[c.user_id];
                const name = c.user_id === currentUserId ? "You" : (profile?.name || profile?.email?.split("@")[0] || "?");
                const avatar = profile?.avatar;
                return (
                  <div key={i} className="flex items-start gap-1.5">
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatar} alt="" className="h-4 w-4 rounded-full object-cover shrink-0 mt-0.5" />
                    ) : (
                      <span className="h-4 w-4 rounded-full bg-muted-foreground/20 flex items-center justify-center text-[9px] font-bold text-muted-foreground uppercase shrink-0 mt-0.5">
                        {name.charAt(0)}
                      </span>
                    )}
                    <p className="text-xs text-muted-foreground truncate leading-snug">
                      <span className="font-medium text-foreground/80">{name}</span>{" "}
                      {c.content}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Map preview if toggled */}
          {showMap && mainPhotoUrl && apartment.lat != null && apartment.lng != null && (
            <div className="rounded-2xl overflow-hidden">
              <MiniMapPreview lat={apartment.lat} lng={apartment.lng} />
            </div>
          )}

          {/* User scores inline */}
          {(apartment.preliminaryScores?.length ?? 0) > 0 && (
            <div className="flex items-center gap-3 pt-0.5">
              {apartment.preliminaryScores!.map((s) => (
                <UserScoreChip key={s.id} score={s} />
              ))}
            </div>
          )}
        </div>

        {/* Footer: your rating, triage + viewing state, then actions */}
        <div className="px-4 pb-3 pt-0 space-y-2">
          <div className="border-t border-border/40 pt-2.5" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <PreliminaryScoreInput apartmentId={apartment.id} scores={apartment.preliminaryScores ?? []} />
          </div>
          {commentOpen && (
            <form
              className="flex items-center gap-1.5"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  setCommentOpen(false);
                  setCommentText("");
                }
              }}
              onSubmit={handleAddComment}
            >
              <input
                ref={commentInputRef}
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment..."
                disabled={commentSubmitting}
                autoFocus
                className="h-9 flex-1 min-w-0 rounded-lg border border-border bg-background px-2.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring/30"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setCommentOpen(false);
                    setCommentText("");
                  }
                }}
              />
              <button
                type="submit"
                disabled={commentSubmitting || !commentText.trim()}
                aria-label="Post comment"
                className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>
          )}
          <div className="flex items-center justify-between gap-2" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <select
              value={apartment.disposition || ""}
              onChange={(e) => {
                const val = (e.target.value || null) as ApartmentWithScore["disposition"];
                patchApartment(apartment.id, { disposition: val });
              }}
              aria-label="Triage"
              className={cn(
                "h-9 rounded-lg border border-border/60 bg-muted/40 px-2.5 text-xs font-medium cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring/30 transition-colors",
                apartment.disposition === "to_book" && "text-foreground",
                apartment.disposition === "rebook" && "text-warning",
                (apartment.disposition === "skipped" || !apartment.disposition) && "text-muted-foreground"
              )}
            >
              <option value="">Triage</option>
              <option value="to_book">To book</option>
              <option value="skipped">Skipped</option>
              <option value="rebook">Rebook</option>
            </select>
            {status && (
              <span className={cn("flex min-w-0 items-center gap-1 whitespace-nowrap text-xs font-medium", status.cls)}>
                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{status.label}</span>
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5">
              {apartment.listing_url && (
                <button
                  onClick={handleOpenListing}
                  className={iconButton}
                  aria-label="Open listing"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCommentOpen(!commentOpen); setTimeout(() => commentInputRef.current?.focus(), 0); }}
                className={cn(iconButton, "w-auto min-w-9 gap-1 px-2", commentOpen && "text-primary bg-primary/10")}
                aria-label={commentCount ? `Add comment (${commentCount} so far)` : "Add comment"}
              >
                <MessageSquare className="h-4 w-4" />
                {!!commentCount && <span className="text-xs font-medium tabular-nums">{commentCount}</span>}
              </button>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBookingModalOpen(true); }}
                className={iconButton}
                aria-label={appointment ? "Edit appointment" : "Book appointment"}
              >
                {appointment ? <CalendarDays className="h-4 w-4" /> : <CalendarPlus className="h-4 w-4" />}
              </button>
              <button
                onClick={handleArchiveToggle}
                disabled={archiving}
                className={cn(iconButton, archiving && "opacity-50")}
                aria-label={apartment.archived ? "Unarchive" : "Archive"}
              >
                {apartment.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </button>
              <button
                onClick={handleDelete}
                className={cn(iconButton, "hover:text-destructive")}
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground/70" title="Added">
              <Clock className="h-3 w-3" />
              {timeAgo(apartment.created_at)}
            </span>
          </div>
        </div>
      </Card>

      <AppointmentModal
        open={bookingModalOpen}
        onOpenChange={setBookingModalOpen}
        appointment={appointment}
        apartmentId={apartment.id}
        apartmentAddress={apartment.address}
        apartmentSuburb={apartment.suburb}
        listingUrl={apartment.listing_url}
      />
    </Link>
  );
}
