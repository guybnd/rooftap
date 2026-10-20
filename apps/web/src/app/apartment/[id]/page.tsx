"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bed, Bath, Car, Wallet, MapPin, ExternalLink, StickyNote, User, ShoppingCart, TrainFront, ClipboardCheck, LayoutList, CalendarDays, Navigation, Home, CheckCircle2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { use$ } from "@legendapp/state/react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { apartments$, agents$, apartmentAgents$, apartmentChecklistItems$, apartmentChecklistResponses$, formatRelativeDay, useReconnectSync, useStoreHelpers, useStoreLoaded, currencySymbol } from "@homeup/core";
import type { Agent, Apartment, ApartmentAgent, ChecklistItem, ChecklistResponse } from '@homeup/core';
import { cn } from "@/lib/utils";
import { geocodeAddress } from "@/lib/geocode";
import { fetchNearestPoiDistancesClient } from "@/lib/nearest-pois-client";
import { ChecklistScoring } from "@/components/checklist-scoring";
import { ApartmentComments } from "@/components/apartment-comments";
import { PhotoGallery } from "@/components/photo-gallery";
import { MultiAgentSelector } from "@/components/multi-agent-selector";
import { ApartmentAppointment } from "@/components/apartment-appointment";
import { PreliminaryScoreDetail } from "@/components/preliminary-score";
import { InlineEdit } from "@/components/inline-edit";
import { ApartmentDetailMapLazy as ApartmentDetailMap } from "@/components/apartment-detail-map-lazy";
import { toast } from "sonner";
import ApartmentLoading from "./loading";

// Hearth v2 pass: the detail view is a Display-step address on the ground,
// one meta line (suburb, move-in, main location), the listing's actions, then
// sibling sections that all share one heading step (Title, H4: each section
// owns at most one card). Move-in reads as a relative day (H6), never the
// browser's raw "mm/dd/yyyy" field.

/** "Tomorrow" / "Saturday" within a week, else "Nov 1" ("Nov 1, 2027" off-year). */
function moveInLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days >= 0 && days <= 6) return formatRelativeDay(date);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(y !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Section heading at the Title step: muted glyph, name, optional muted count. */
function SectionHeading({ icon: Icon, children, count }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; count?: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold">
      <Icon className="h-4 w-4 text-muted-foreground" />
      {children}
      {count != null && <span className="font-sans text-sm font-normal tabular-nums text-muted-foreground">{count}</span>}
    </h2>
  );
}

const DETAIL_TILE = "rounded-2xl bg-muted/40 p-3";
const TILE_LABEL = "mb-1 flex items-center gap-1.5 text-xs text-muted-foreground";

export default function ApartmentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { preliminaryScores, loading: cacheLoading, refresh, group, currentUserId } = useDataCache();

  const apts$ = apartments$(group?.id);
  const agentsStore$ = agents$(group?.id);
  const apartmentAgentsStore$ = apartmentAgents$(group?.id);
  const checklistItemsStore$ = apartmentChecklistItems$(group?.id);
  const checklistResponsesStore$ = apartmentChecklistResponses$(group?.id);
  useReconnectSync(apts$);
  useReconnectSync(agentsStore$);
  useReconnectSync(apartmentAgentsStore$);
  useReconnectSync(checklistItemsStore$);
  useReconnectSync(checklistResponsesStore$);
  const { patchRow: patchApartment } = useStoreHelpers(apts$, currentUserId);
  const { writeRow: writeApartmentAgent, softDeleteRow: softDeleteApartmentAgent } = useStoreHelpers(apartmentAgentsStore$, currentUserId);

  const apartment = use$(() => {
    const row = apts$.get()?.[id];
    return row && !row.deleted ? row : undefined;
  });
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );
  const apartmentAgents = use$(() =>
    Object.values(apartmentAgentsStore$.get() ?? {}).filter((aa): aa is ApartmentAgent => !!aa && !aa.deleted)
  );
  const checklistItems = use$(() =>
    Object.values(checklistItemsStore$.get() ?? {}).filter((i): i is ChecklistItem => !!i && !i.deleted)
  );
  const responses = use$(() =>
    Object.values(checklistResponsesStore$.get() ?? {}).filter((r): r is ChecklistResponse => !!r && !r.deleted)
  );
  const storeLoaded = useStoreLoaded(apts$, agentsStore$, apartmentAgentsStore$, checklistItemsStore$, checklistResponsesStore$);

  const [viewMode, setViewMode] = useState<"full" | "checklist">("full");
  const [settingAsHome, setSettingAsHome] = useState(false);

  if (cacheLoading || (!storeLoaded && !apartment)) return <ApartmentLoading />;

  if (!apartment) {
    return (
      <main className="p-4 sm:p-8 max-w-2xl mx-auto">
        <Link
          href="/homesearch"
          className="-ml-2 mb-4 inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <p className="text-muted-foreground">Apartment not found.</p>
      </main>
    );
  }

  const saveField = async (field: string, value: unknown) => {
    patchApartment(apartment.id, { [field]: value } as Partial<Apartment>);
    if (field === "address" || field === "suburb") {
      const address = field === "address" ? (value as string) : apartment.address;
      const suburb = field === "suburb" ? (value as string) : apartment.suburb;
      const coords = await geocodeAddress(address, suburb);
      if (coords) {
        patchApartment(apartment.id, { lat: coords.lat, lng: coords.lng });
        fetchNearestPoiDistancesClient(coords.lat, coords.lng).then((distances) => {
          if (distances.nearest_supermarket_m != null || distances.nearest_transport_m != null) {
            patchApartment(apartment.id, distances);
          }
        });
      }
    }
    toast.success("Updated");
  };

  const apartmentResponses = responses.filter((r) => r.apartment_id === id);
  const apartmentPreliminaryScores = preliminaryScores.filter((s) => s.apartment_id === apartment.id);

  const handleSetAsHome = async () => {
    if (!group || !apartment) return;
    setSettingAsHome(true);

    try {
      const supabase = createClient();

      // Get geocode for the address
      let lat: number | null = null;
      let lng: number | null = null;

      if (apartment.lat != null && apartment.lng != null) {
        lat = apartment.lat;
        lng = apartment.lng;
      } else if (apartment.address) {
        const coords = await geocodeAddress(apartment.address, apartment.suburb || "");
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
        }
      }

      // Update group with home profile from this apartment
      const { error } = await supabase
        .from("groups")
        .update({
          home_address: apartment.address,
          home_lat: lat,
          home_lng: lng,
          chosen_apartment_id: apartment.id,
        })
        .eq("id", group.id);

      if (error) {
        toast.error("Failed to set home profile");
      } else {
        toast.success("Home profile updated from this listing");
        refresh();
      }
    } catch {
      toast.error("Failed to set home profile");
    } finally {
      setSettingAsHome(false);
    }
  };

  const isHome = group?.chosen_apartment_id === apartment.id;

  const viewTabClass = (active: boolean) =>
    cn(
      "flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-all",
      active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
    );

  return (
    <main className="p-4 sm:p-8 max-w-2xl mx-auto">
      <div className="mb-4 flex items-center justify-between gap-3">
        <button
          onClick={() => router.back()}
          className="-ml-2 inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {/* View mode toggle: a recessed track with a raised neutral thumb (H5) */}
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5" role="tablist" aria-label="View">
          <button role="tab" aria-selected={viewMode === "full"} onClick={() => setViewMode("full")} className={viewTabClass(viewMode === "full")}>
            <LayoutList className="size-3.5" />
            Full view
          </button>
          <button role="tab" aria-selected={viewMode === "checklist"} onClick={() => setViewMode("checklist")} className={viewTabClass(viewMode === "checklist")}>
            <ClipboardCheck className="size-3.5" />
            Checklist
          </button>
        </div>
      </div>

      {/* Header: inline-editable address & suburb */}
      <div className="mb-8">
        <InlineEdit
          value={apartment.address}
          onSave={(v) => saveField("address", v.trim())}
          validate={(v) => v.trim().length > 0}
          displayClassName="font-heading text-2xl font-bold tracking-[-0.02em]"
          placeholder="Address"
          emptyText="Add address"
        />

        {/* One meta line: suburb, move-in, main location */}
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <InlineEdit
              value={apartment.suburb || ""}
              onSave={(v) => saveField("suburb", v.trim() || null)}
              placeholder="Suburb"
              emptyText="Add suburb"
              displayClassName="text-sm"
            />
          </div>

          <label className="relative flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md hover:bg-accent/50 -mx-1 px-1">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {apartment.move_in_date ? (
              <span className="whitespace-nowrap text-foreground">
                <span className="text-muted-foreground">Move in </span>
                {moveInLabel(apartment.move_in_date)}
              </span>
            ) : (
              <span className="whitespace-nowrap text-muted-foreground">Add move-in</span>
            )}
            <input
              type="date"
              value={apartment.move_in_date || ""}
              onChange={(e) => saveField("move_in_date", e.target.value || null)}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker?.();
                } catch {
                  /* showPicker throws outside a user gesture; the native tap still opens it */
                }
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Move-in date"
            />
          </label>

          <div className="flex min-w-0 items-center gap-1.5">
            <Navigation className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <InlineEdit
              value={apartment.main_location || ""}
              onSave={(v) => saveField("main_location", v.trim() || null)}
              placeholder="e.g. CBD, St Kilda"
              emptyText="Add location"
              displayClassName="text-sm"
            />
          </div>
        </div>

        {/* The listing's actions: neutral, they sit with the listing they act on */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {apartment.listing_url && (
            <a
              href={apartment.listing_url.replace(/\.pdf$/i, "")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
            >
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              View listing
            </a>
          )}
          <button
            onClick={handleSetAsHome}
            disabled={settingAsHome || !group}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            {isHome ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <Home className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {isHome ? "Linked to home profile" : "Use as home profile"}
          </button>
        </div>
      </div>

      {viewMode === "full" && (
        <>
          <div className="mb-8">
            <PreliminaryScoreDetail apartmentId={apartment.id} scores={apartmentPreliminaryScores} />
          </div>

          {/* Property details grid — inline editable */}
          <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className={DETAIL_TILE}>
              <div className={TILE_LABEL}>
                <Wallet className="h-3.5 w-3.5" />
                <span>Rent</span>
              </div>
              <InlineEdit
                value={apartment.rent_per_week != null ? String(apartment.rent_per_week) : ""}
                onSave={(v) => saveField("rent_per_week", v ? Number(v) : null)}
                type="number"
                prefix={currencySymbol()}
                suffix="/wk"
                placeholder="500"
                emptyText="Add rent"
                displayClassName="text-lg font-semibold tabular-nums"
              />
            </div>

            <div className={DETAIL_TILE}>
              <div className={TILE_LABEL}>
                <Bed className="h-3.5 w-3.5" />
                <span>Bedrooms</span>
              </div>
              <InlineEdit
                value={apartment.bedrooms != null ? String(apartment.bedrooms) : ""}
                onSave={(v) => saveField("bedrooms", v ? Number(v) : null)}
                type="number"
                placeholder="2"
                emptyText="Add"
                displayClassName="text-lg font-semibold tabular-nums"
              />
            </div>

            <div className={DETAIL_TILE}>
              <div className={TILE_LABEL}>
                <Bath className="h-3.5 w-3.5" />
                <span>Bathrooms</span>
              </div>
              <InlineEdit
                value={apartment.bathrooms != null ? String(apartment.bathrooms) : ""}
                onSave={(v) => saveField("bathrooms", v ? Number(v) : null)}
                type="number"
                placeholder="1"
                emptyText="Add"
                displayClassName="text-lg font-semibold tabular-nums"
              />
            </div>

            <div className={DETAIL_TILE}>
              <div className={TILE_LABEL}>
                <Car className="h-3.5 w-3.5" />
                <span>Parking</span>
              </div>
              <button
                onClick={() => saveField("parking", !apartment.parking)}
                className="-mx-1 rounded-md px-1 py-0.5 text-lg font-semibold transition-colors hover:bg-accent/50"
                aria-label={`Parking: ${apartment.parking ? "yes" : "no"}. Toggle`}
              >
                {apartment.parking ? "Yes" : "No"}
              </button>
            </div>

            <div className={DETAIL_TILE}>
              <div className={TILE_LABEL}>
                <ShoppingCart className="h-3.5 w-3.5" />
                <span>Supermarket</span>
              </div>
              <InlineEdit
                value={apartment.nearest_supermarket_m != null ? String(apartment.nearest_supermarket_m) : ""}
                onSave={(v) => saveField("nearest_supermarket_m", v ? Number(v) : null)}
                type="number"
                suffix="m"
                prefix="~"
                placeholder="250"
                emptyText="Unknown"
                displayClassName="text-lg font-semibold tabular-nums"
              />
            </div>

            <div className={DETAIL_TILE}>
              <div className={TILE_LABEL}>
                <TrainFront className="h-3.5 w-3.5" />
                <span>Transport</span>
              </div>
              <InlineEdit
                value={apartment.nearest_transport_m != null ? String(apartment.nearest_transport_m) : ""}
                onSave={(v) => saveField("nearest_transport_m", v ? Number(v) : null)}
                type="number"
                suffix="m"
                prefix="~"
                placeholder="100"
                emptyText="Unknown"
                displayClassName="text-lg font-semibold tabular-nums"
              />
            </div>
          </div>

          <section className="mb-8">
            <ApartmentComments apartmentId={apartment.id} />
          </section>

          {/* Notes: inline editable */}
          <section className="mb-8">
            <SectionHeading icon={StickyNote}>Notes</SectionHeading>
            <div className="rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
              <InlineEdit
                value={apartment.notes || ""}
                onSave={(v) => saveField("notes", v.trim() || null)}
                type="textarea"
                placeholder="Any notes about this place"
                emptyText="Add notes"
                displayClassName="text-sm whitespace-pre-wrap"
              />
            </div>
          </section>

          {/* Map view: 500m radius showing transport & supermarkets */}
          {apartment.lat != null && apartment.lng != null && (
            <section className="mb-8">
              <SectionHeading icon={MapPin} count="500 m">Nearby</SectionHeading>
              <ApartmentDetailMap lat={apartment.lat} lng={apartment.lng} />
            </section>
          )}
        </>
      )}

      {/* Full view sections */}
      {viewMode === "full" && (
        <>
          <section className="mb-8">
            <SectionHeading icon={User}>Agents</SectionHeading>
            <MultiAgentSelector
              value={apartmentAgents.filter((aa) => aa.apartment_id === apartment.id).map((aa) => aa.agent_id)}
              onChange={(newAgentIds) => {
                const currentLinks = apartmentAgents.filter((aa) => aa.apartment_id === apartment.id);
                const currentIds = currentLinks.map((aa) => aa.agent_id);
                const toRemove = currentLinks.filter((aa) => !newAgentIds.includes(aa.agent_id));
                const toAdd = newAgentIds.filter((agentId) => !currentIds.includes(agentId));
                for (const aa of toRemove) softDeleteApartmentAgent(aa.id);
                for (const agent_id of toAdd) {
                  writeApartmentAgent({
                    id: crypto.randomUUID(),
                    group_id: apartment.group_id,
                    apartment_id: apartment.id,
                    agent_id,
                    deleted: false,
                    created_at: null as unknown as string,
                    updated_at: null as unknown as string,
                  });
                }
                patchApartment(apartment.id, { agent_id: newAgentIds[0] ?? null });
              }}
            />
            {(() => {
              const linkedAgents = apartmentAgents
                .filter((aa) => aa.apartment_id === apartment.id)
                .map((aa) => agents.find((a) => a.id === aa.agent_id))
                .filter(Boolean);
              const withPhone = linkedAgents.filter((a) => a!.phone);
              return withPhone.length > 0 ? (
                <ul className="mt-2 space-y-0.5">
                  {withPhone.map((a) => (
                    <li key={a!.id} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{a!.name}</span>
                      <a href={`tel:${a!.phone!.replace(/\s+/g, "")}`} className="tabular-nums text-foreground hover:underline">
                        {a!.phone}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null;
            })()}
          </section>

          <section className="mb-8">
            <SectionHeading icon={CalendarDays}>Viewing</SectionHeading>
            <ApartmentAppointment apartmentId={apartment.id} />
          </section>

          <section className="mb-8">
            <PhotoGallery apartmentId={apartment.id} />
          </section>

          <section>
            <ChecklistScoring
              apartmentId={apartment.id}
              items={checklistItems}
              initialResponses={apartmentResponses}
            />
          </section>
        </>
      )}

      {/* Checklist-focused view */}
      {viewMode === "checklist" && (
        <>
          <ChecklistScoring
            apartmentId={apartment.id}
            items={checklistItems}
            initialResponses={apartmentResponses}
          />

          <section className="mt-8">
            <ApartmentComments apartmentId={apartment.id} />
          </section>
        </>
      )}
    </main>
  );
}
