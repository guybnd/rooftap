// HOUP-78: shared apartment-creation logic used by both
// apps/mobile/src/app/apartment/new.tsx and apps/mobile/src/app/apartment/
// bulk.tsx, extracted to stay DRY (the two web originals — apps/web/src/app/
// apartment/new/page.tsx and .../bulk/page.tsx — duplicate this same
// sequencing inline). Mirrors the web write order exactly: apartment row via
// writeRow (offline-safe local write, cannot fail synchronously) -> agent
// junction rows via writeRow (best-effort, same reasoning) -> parsed listing
// images inserted as `photos` rows via a direct Supabase call (the one part
// of this flow that isn't a local-first store — `photos` has no Legend-State
// store, same as photo-gallery.tsx's direct supabase.from('photos') calls).
// HOUP-149: geocoding is now wired here too, mirroring apartment/new/page.tsx's
// handleSubmit — best-effort and fire-and-forget so it never blocks
// navigation or the bulk-import loop (the row is already saved locally).
import type { Agent, Apartment, ApartmentAgent } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { randomUUID } from '@/lib/uuid';
import type { ParsedListingAgent } from './parse-listing-api';
import { fetchNearestPoiDistances, geocodeAddress } from '@/lib/geocode-api';

export const AGENT_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

/**
 * Matches each parsed agent against the group's existing agents by
 * case-insensitive name, creating (and writing) a new Agent row for any
 * that don't match. Ports apps/web/src/app/apartment/new/page.tsx's
 * handleParse loop (and bulk/page.tsx's identical copy) unchanged — same
 * random-unused-color assignment, same "don't reuse a color still in use"
 * preference.
 */
export function resolveParsedAgents(
  parsedAgents: ParsedListingAgent[],
  existingAgents: Agent[],
  writeAgent: (row: Agent) => void,
  groupId: string,
  currentUserId: string | null | undefined
): string[] {
  const resolvedIds: string[] = [];
  let currentAgents = existingAgents;

  for (const pa of parsedAgents) {
    const match = currentAgents.find((a) => a.name.toLowerCase() === pa.name.toLowerCase());
    if (match) {
      resolvedIds.push(match.id);
      continue;
    }

    const used = new Set(currentAgents.map((a) => a.color));
    const available = AGENT_COLORS.filter((c) => !used.has(c));
    const pool = available.length > 0 ? available : AGENT_COLORS;
    const color = pool[Math.floor(Math.random() * pool.length)];

    const newAgent: Agent = {
      id: randomUUID(),
      user_id: currentUserId ?? '',
      group_id: groupId,
      name: pa.name,
      phone: pa.phone || null,
      color,
      notes: null,
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    };
    writeAgent(newAgent);
    resolvedIds.push(newAgent.id);
    currentAgents = [...currentAgents, newAgent];
  }

  return resolvedIds;
}

export interface CreateApartmentFromParsedInput {
  groupId: string;
  currentUserId: string | null | undefined;
  address: string;
  suburb?: string | null;
  rentPerWeek?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  parking?: boolean | null;
  listingUrl?: string | null;
  notes?: string | null;
  /** Resolved agent ids (existing + newly-created) to link via apartment_agents. */
  agentIds?: string[];
  /** AI-extracted listing photo URLs (already uploaded server-side by parse-listing). */
  imageUrls?: string[];
  writeApartment: (row: Apartment) => void;
  writeApartmentAgent: (row: ApartmentAgent) => void;
  /** Optional — when provided, the new apartment is best-effort geocoded (lat/lng + POI distances) after write. */
  patchApartment?: (id: string, patch: Partial<Apartment>) => void;
}

/** Builds + writes the apartment row, links agents, and saves parsed photos. Returns the new apartment id. */
export async function createApartmentFromParsed(input: CreateApartmentFromParsedInput): Promise<string> {
  const {
    groupId,
    currentUserId,
    address,
    suburb,
    rentPerWeek,
    bedrooms,
    bathrooms,
    parking,
    listingUrl,
    notes,
    agentIds = [],
    imageUrls = [],
    writeApartment,
    writeApartmentAgent,
    patchApartment,
  } = input;

  const apartmentId = randomUUID();
  writeApartment({
    id: apartmentId,
    user_id: currentUserId ?? '',
    group_id: groupId,
    address,
    suburb: suburb || null,
    rent_per_week: rentPerWeek ?? null,
    bedrooms: bedrooms ?? null,
    bathrooms: bathrooms ?? null,
    parking: parking ?? false,
    listing_url: listingUrl || null,
    notes: notes || null,
    lat: null,
    lng: null,
    agent_id: agentIds[0] ?? null,
    preliminary_score: null,
    nearest_supermarket_m: null,
    nearest_transport_m: null,
    disposition: null,
    move_in_date: null,
    main_location: null,
    archived: false,
    deleted: false,
    created_at: null as unknown as string,
    updated_at: null as unknown as string,
  });

  for (const agent_id of agentIds) {
    writeApartmentAgent({
      id: randomUUID(),
      group_id: groupId,
      apartment_id: apartmentId,
      agent_id,
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    });
  }

  // Best-effort, same as web: apartment + agent links are already saved
  // locally regardless of whether this succeeds.
  if (imageUrls.length > 0) {
    const supabase = getCurrentSupabaseClient();
    const photoRows = imageUrls.map((imageUrl, i) => ({
      apartment_id: apartmentId,
      storage_path: imageUrl,
      caption: 'listing',
      is_main: i === 0,
    }));
    await supabase.from('photos').insert(photoRows);
  }

  if (patchApartment) {
    // Fire-and-forget: never await, never block save/navigation. The row is
    // already written above regardless of whether this succeeds.
    geocodeAddress(address, suburb).then((coords) => {
      if (!coords) return;
      patchApartment(apartmentId, { lat: coords.lat, lng: coords.lng });
      fetchNearestPoiDistances(coords.lat, coords.lng).then((distances) => {
        if (distances.nearest_supermarket_m != null || distances.nearest_transport_m != null) {
          patchApartment(apartmentId, distances);
        }
      });
    });
  }

  return apartmentId;
}
