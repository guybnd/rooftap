// HOUP-78: native port of apps/web/src/app/apartment/[id]/page.tsx — the
// apartment detail screen, the largest single route in the Apartments port.
// Full View/Checklist toggle, inline-editable fields (EditableText for text/
// numeric, a plain toggle for the boolean `parking` field, DateScrollField
// for `move_in_date` per this ticket's spec), "Use as home profile", agent
// linking, embedded photos/appointment/comments/checklist-scoring/
// preliminary-score, and a nearby-POI map slot all mirror the web original's
// layout section-for-section (including its two separate `viewMode ===
// 'full'` blocks and the Checklist-mode duplication of ApartmentComments).
//
// Two intentional boundaries carried over from sibling tickets, not gaps in
// this port:
//  - HOUP-109 (map): the web original embeds a real Mapbox ApartmentDetailMap
//    here; this screen renders <MapPlaceholderTile variant="detail" /> in its
//    place (apps/mobile/src/features/homesearch/map-placeholder-tile.tsx),
//    guarded by the same `lat != null && lng != null` check web uses. No map
//    SDK is imported.
//  - HOUP-112 (appointments): booking/editing a viewing reuses the existing
//    embedded <ApartmentAppointment apartmentId={id} /> control (which itself
//    reuses the native AppointmentModal) — the standalone /appointments list
//    screen and AppointmentModal internals are untouched here.
//
// HOUP-149: saveField() now re-geocodes address/suburb edits too, mirroring
// web's saveField (apartment/[id]/page.tsx) — via features/homesearch/
// geocode-api.ts's authed /api/geocode proxy + /api/nearby-pois caller
// instead of web's direct-Mapbox geocode.ts/nearest-pois-client.ts (native
// has no Mapbox token in its bundle). nearest_supermarket_m/
// nearest_transport_m stay manually editable via EditableText too, same as
// web.
//
// Hearth v2 pass (mirrors web): Back and the view toggle share the top row;
// the address is the Display step with one wrapping meta line under it
// (suburb, "Move in Nov 1" as a relative day, main location; empty fields
// read as quiet verbs, not italics); the listing's actions are neutral
// outline buttons; property tiles are inset fills in two columns (H4, value
// first with the unit muted, H6); every section shares one Title-step heading.
import * as React from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
// HOUP-318: keyboard-aware scroll container (same swap as Home/Costs) so an
// inline field low on the page scrolls above the on-screen keyboard.
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { use$ } from '@legendapp/state/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Bath,
  Bed,
  CalendarDays,
  Car,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Home,
  LayoutList,
  MapPin,
  Navigation,
  ShoppingCart,
  StickyNote,
  TrainFront,
  User,
  Wallet,
} from 'lucide-react-native';
import { Text, Button, Card, DateScrollField, EditableText, ScreenBackground, SegmentedControl, toast } from '@homeup/ui';
import {
  agents$,
  apartmentAgents$,
  apartmentChecklistItems$,
  apartmentChecklistResponses$,
  apartments$,
  formatRelativeDay,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  type Agent,
  type Apartment,
  type ApartmentAgent,
  type ChecklistItem,
  currencySymbol,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { randomUUID } from '@/lib/uuid';
import { MultiAgentSelector } from '@/features/settings/panels/multi-agent-selector';
import { MapPlaceholderTile } from '@/features/homesearch/map-placeholder-tile';
import { ApartmentAppointment } from '@/features/homesearch/apartment-appointment';
import { ApartmentComments } from '@/features/homesearch/apartment-comments';
import { ChecklistScoring } from '@/features/homesearch/checklist-scoring';
import { PhotoGallery } from '@/features/homesearch/photo-gallery';
import { PreliminaryScoreDetail } from '@/features/homesearch/preliminary-score';
import { fetchNearestPoiDistances, geocodeAddress } from '@/lib/geocode-api';

type ViewMode = 'full' | 'checklist';

/** "Tomorrow" / "Saturday" within a week, else "Nov 1" ("Nov 1, 2027" off-year); web's moveInLabel. */
function formatMoveIn(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days >= 0 && days <= 6) return formatRelativeDay(d);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

// Local (route-scoped, not a shared primitive) — the six property-detail
// tiles all share this frame; pulling it into packages/ui isn't warranted
// for a single screen's layout. Inset fill, no border (H4), half width so
// the grid reads as two columns like web's `grid-cols-2`.
function DetailCard({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <View className="w-1/2 p-1">
      <View className="rounded-2xl bg-muted/40 p-3">
        <View className="mb-1 flex-row items-center gap-1.5">
          {icon}
          <Text className="text-xs text-muted-foreground">{label}</Text>
        </View>
        {children}
      </View>
    </View>
  );
}

/** A tile's value: figure first, unit muted and small (H6); empty reads as a quiet verb. */
function TileValue({ value, unit, empty }: { value: string | null; unit?: string; empty: string }) {
  if (value == null) return <Text className="py-1 text-sm text-muted-foreground">{empty}</Text>;
  return (
    <Text className="text-lg font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
      {value}
      {unit ? <Text className="text-sm font-normal text-muted-foreground">{` ${unit}`}</Text> : null}
    </Text>
  );
}

/** Section heading at the Title step: muted glyph, name, optional muted count. */
function SectionHeading({ icon: Icon, children, count }: { icon: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode; count?: string | number }) {
  return (
    <View className="flex-row items-center gap-2">
      <Icon size={16} className="text-muted-foreground" />
      <Text className="text-title text-foreground">{children}</Text>
      {count != null ? (
        <Text className="text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {count}
        </Text>
      ) : null}
    </View>
  );
}

export default function ApartmentDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { group, currentUserId, preliminaryScores, loading: cacheLoading, refresh } = useDataCache();

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
  const { writeRow: writeApartmentAgent, softDeleteRow: softDeleteApartmentAgent } = useStoreHelpers(
    apartmentAgentsStore$,
    currentUserId
  );

  const apartment = use$(() => {
    const row = (apts$.get() ?? {})[id];
    return row && !row.deleted ? row : undefined;
  });
  const agents = use$(() => Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted));
  const apartmentAgents = use$(() =>
    Object.values(apartmentAgentsStore$.get() ?? {}).filter((aa): aa is ApartmentAgent => !!aa && !aa.deleted)
  );
  const checklistItems = use$(() =>
    Object.values(checklistItemsStore$.get() ?? {}).filter((i): i is ChecklistItem => !!i && !i.deleted)
  );
  const storeLoaded = useStoreLoaded(apts$, agentsStore$, apartmentAgentsStore$, checklistItemsStore$, checklistResponsesStore$);

  const [viewMode, setViewMode] = React.useState<ViewMode>('full');
  const [settingAsHome, setSettingAsHome] = React.useState(false);
  const [editingMoveIn, setEditingMoveIn] = React.useState(false);

  if (cacheLoading || (!storeLoaded && !apartment)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  if (!apartment) {
    return (
      <ScreenBackground className="items-center justify-center gap-3 p-6">
        <Text className="text-body text-muted-foreground">Apartment not found.</Text>
        <Button variant="outline" size="sm" onPress={() => router.back()}>
          <ArrowLeft size={14} className="text-foreground" />
          Back
        </Button>
      </ScreenBackground>
    );
  }

  function saveField<K extends keyof Apartment>(field: K, value: Apartment[K]) {
    const apartmentId = apartment!.id;
    patchApartment(apartmentId, { [field]: value } as Partial<Apartment>);
    if (field === 'address' || field === 'suburb') {
      const address = field === 'address' ? (value as string) : apartment!.address;
      const suburb = field === 'suburb' ? (value as string) : apartment!.suburb;
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
    toast.success('Updated');
  }

  const apartmentPreliminaryScores = preliminaryScores.filter((s) => s.apartment_id === apartment.id);

  const currentApartmentAgentLinks = apartmentAgents.filter((aa) => aa.apartment_id === apartment.id);
  const linkedAgentIds = currentApartmentAgentLinks.map((aa) => aa.agent_id);
  const linkedAgents = currentApartmentAgentLinks
    .map((aa) => agents.find((a) => a.id === aa.agent_id))
    .filter((a): a is Agent => !!a);
  const agentsWithPhone = linkedAgents.filter((a) => a.phone);

  const handleAgentsChange = (newAgentIds: string[]) => {
    const currentIds = linkedAgentIds;
    const toRemove = currentApartmentAgentLinks.filter((aa) => !newAgentIds.includes(aa.agent_id));
    const toAdd = newAgentIds.filter((agentId) => !currentIds.includes(agentId));
    toRemove.forEach((aa) => softDeleteApartmentAgent(aa.id));
    toAdd.forEach((agentId) =>
      writeApartmentAgent({
        id: randomUUID(),
        group_id: apartment.group_id,
        apartment_id: apartment.id,
        agent_id: agentId,
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      })
    );
    saveField('agent_id', newAgentIds[0] ?? null);
  };

  const isHome = group.chosen_apartment_id === apartment.id;

  const handleSetAsHome = async () => {
    setSettingAsHome(true);
    try {
      const supabase = getCurrentSupabaseClient();
      const { error } = await supabase
        .from('groups')
        .update({
          home_address: apartment.address,
          home_lat: apartment.lat,
          home_lng: apartment.lng,
          chosen_apartment_id: apartment.id,
        })
        .eq('id', group.id);
      if (!error) await refresh();
    } finally {
      setSettingAsHome(false);
    }
  };

  const checklistPanel = (
    <ChecklistScoring apartmentId={apartment.id} items={checklistItems} />
  );

  return (
    <ScreenBackground>
    <KeyboardAwareScrollView
      className="flex-1"
      contentContainerClassName="gap-7 p-4"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }}
    >
      {/* Top row: Back, and the view toggle */}
      <View className="flex-row items-center justify-between gap-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="-ml-1 min-h-[44px] flex-row items-center gap-1 px-1"
        >
          <ArrowLeft size={16} className="text-muted-foreground" />
          <Text className="text-sm text-muted-foreground">Back</Text>
        </Pressable>

        <SegmentedControl
          options={[
            {
              value: 'full' as const,
              label: 'Full view',
              icon: <LayoutList size={13} className={viewMode === 'full' ? 'text-foreground' : 'text-muted-foreground'} />,
            },
            {
              value: 'checklist' as const,
              label: 'Checklist',
              icon: (
                <ClipboardCheck size={13} className={viewMode === 'checklist' ? 'text-foreground' : 'text-muted-foreground'} />
              ),
            },
          ]}
          value={viewMode}
          onChange={setViewMode}
          size="sm"
        />
      </View>

      {/* Header block: inline-editable address, then one meta line */}
      <View className="gap-1.5">
        <EditableText value={apartment.address} onCommit={(v) => saveField('address', v.trim())} placeholder="Address">
          <Text className="text-display text-foreground">{apartment.address || 'Add address'}</Text>
        </EditableText>

        <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
          <View className="min-h-[32px] flex-row items-center gap-1.5">
            <MapPin size={13} className="shrink-0 text-muted-foreground" />
            <EditableText
              value={apartment.suburb ?? ''}
              onCommit={(v) => saveField('suburb', v.trim() || null)}
              placeholder="Suburb"
            >
              <Text className="text-sm text-muted-foreground">{apartment.suburb || 'Add suburb'}</Text>
            </EditableText>
          </View>

          <Pressable
            onPress={() => setEditingMoveIn((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Move-in date"
            className="min-h-[32px] flex-row items-center gap-1.5"
          >
            <CalendarDays size={13} className="shrink-0 text-muted-foreground" />
            {apartment.move_in_date ? (
              <Text className="text-sm text-foreground">
                <Text className="text-sm text-muted-foreground">Move in </Text>
                {formatMoveIn(apartment.move_in_date)}
              </Text>
            ) : (
              <Text className="text-sm text-muted-foreground">Add move-in</Text>
            )}
          </Pressable>

          <View className="min-h-[32px] flex-row items-center gap-1.5">
            <Navigation size={13} className="shrink-0 text-muted-foreground" />
            <EditableText
              value={apartment.main_location ?? ''}
              onCommit={(v) => saveField('main_location', v.trim() || null)}
              placeholder="e.g. CBD, St Kilda"
            >
              <Text className={apartment.main_location ? 'text-sm text-foreground' : 'text-sm text-muted-foreground'}>
                {apartment.main_location || 'Add location'}
              </Text>
            </EditableText>
          </View>
        </View>

        {editingMoveIn && (
          <View className="w-64 rounded-2xl bg-muted/40 py-2">
            <DateScrollField
              value={apartment.move_in_date ?? ''}
              onChange={(v) => saveField('move_in_date', v || null)}
            />
          </View>
        )}

        {/* The listing's actions: neutral, they sit with the listing they act on */}
        <View className="mt-2.5 flex-row flex-wrap gap-2">
          {apartment.listing_url && (
            <Button
              variant="outline"
              size="sm"
              onPress={() => void Linking.openURL(apartment.listing_url!.replace(/\.pdf$/i, ''))}
              className="border-border/60"
            >
              <ExternalLink size={14} className="text-muted-foreground" />
              View listing
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onPress={() => void handleSetAsHome()}
            disabled={settingAsHome}
            className="border-border/60"
          >
            {isHome ? (
              <CheckCircle2 size={14} className="text-success" />
            ) : (
              <Home size={14} className="text-muted-foreground" />
            )}
            {isHome ? 'Linked to home profile' : 'Use as home profile'}
          </Button>
        </View>
      </View>

      {viewMode === 'full' && (
        <>
          <PreliminaryScoreDetail apartmentId={apartment.id} scores={apartmentPreliminaryScores} />

          {/* Property details: inline editable inset tiles, two columns */}
          <View className="-m-1 flex-row flex-wrap">
            <DetailCard icon={<Wallet size={13} className="text-muted-foreground" />} label="Rent">
              <EditableText
                value={apartment.rent_per_week != null ? String(apartment.rent_per_week) : ''}
                onCommit={(v) => saveField('rent_per_week', v ? Number(v) : null)}
                keyboardType="numeric"
                placeholder="500"
              >
                <TileValue value={apartment.rent_per_week != null ? `${currencySymbol()}${apartment.rent_per_week}` : null} unit="/wk" empty="Add rent" />
              </EditableText>
            </DetailCard>

            <DetailCard icon={<Bed size={13} className="text-muted-foreground" />} label="Bedrooms">
              <EditableText
                value={apartment.bedrooms != null ? String(apartment.bedrooms) : ''}
                onCommit={(v) => saveField('bedrooms', v ? Number(v) : null)}
                keyboardType="numeric"
                placeholder="2"
              >
                <TileValue value={apartment.bedrooms != null ? String(apartment.bedrooms) : null} empty="Add" />
              </EditableText>
            </DetailCard>

            <DetailCard icon={<Bath size={13} className="text-muted-foreground" />} label="Bathrooms">
              <EditableText
                value={apartment.bathrooms != null ? String(apartment.bathrooms) : ''}
                onCommit={(v) => saveField('bathrooms', v ? Number(v) : null)}
                keyboardType="numeric"
                placeholder="1"
              >
                <TileValue value={apartment.bathrooms != null ? String(apartment.bathrooms) : null} empty="Add" />
              </EditableText>
            </DetailCard>

            <DetailCard icon={<Car size={13} className="text-muted-foreground" />} label="Parking">
              <Pressable
                onPress={() => saveField('parking', !apartment.parking)}
                accessibilityRole="button"
                accessibilityLabel={`Parking: ${apartment.parking ? 'yes' : 'no'}. Toggle`}
              >
                <Text className="text-lg font-semibold text-foreground">{apartment.parking ? 'Yes' : 'No'}</Text>
              </Pressable>
            </DetailCard>

            <DetailCard icon={<ShoppingCart size={13} className="text-muted-foreground" />} label="Supermarket">
              <EditableText
                value={apartment.nearest_supermarket_m != null ? String(apartment.nearest_supermarket_m) : ''}
                onCommit={(v) => saveField('nearest_supermarket_m', v ? Number(v) : null)}
                keyboardType="numeric"
                placeholder="250"
              >
                <TileValue value={apartment.nearest_supermarket_m != null ? `~${apartment.nearest_supermarket_m}` : null} unit="m" empty="Unknown" />
              </EditableText>
            </DetailCard>

            <DetailCard icon={<TrainFront size={13} className="text-muted-foreground" />} label="Transport">
              <EditableText
                value={apartment.nearest_transport_m != null ? String(apartment.nearest_transport_m) : ''}
                onCommit={(v) => saveField('nearest_transport_m', v ? Number(v) : null)}
                keyboardType="numeric"
                placeholder="100"
              >
                <TileValue value={apartment.nearest_transport_m != null ? `~${apartment.nearest_transport_m}` : null} unit="m" empty="Unknown" />
              </EditableText>
            </DetailCard>
          </View>

          <ApartmentComments apartmentId={apartment.id} />

          {/* Notes: inline editable */}
          <View className="gap-3">
            <SectionHeading icon={StickyNote}>Notes</SectionHeading>
            <Card className="gap-0 rounded-3xl p-4">
              <EditableText
                value={apartment.notes ?? ''}
                onCommit={(v) => saveField('notes', v.trim() || null)}
                multiline
                rows={3}
                placeholder="Any notes about this place"
              >
                <Text className={apartment.notes ? 'text-sm text-foreground' : 'text-sm text-muted-foreground'}>
                  {apartment.notes || 'Add notes'}
                </Text>
              </EditableText>
            </Card>
          </View>

          {/* Nearby-POI map slot: HOUP-109 boundary, see header comment */}
          {apartment.lat != null && apartment.lng != null && (
            <View className="gap-3">
              <SectionHeading icon={MapPin} count="500 m">Nearby</SectionHeading>
              <MapPlaceholderTile address={apartment.address} lat={apartment.lat} lng={apartment.lng} variant="detail" />
            </View>
          )}

          <View className="gap-3">
            <SectionHeading icon={User}>Agents</SectionHeading>
            <MultiAgentSelector value={linkedAgentIds} onChange={handleAgentsChange} />
            {agentsWithPhone.length > 0 && (
              <View className="gap-0.5">
                {agentsWithPhone.map((a) => (
                  <View key={a.id} className="flex-row items-center gap-2">
                    <Text className="text-xs text-muted-foreground">{a.name}</Text>
                    <Pressable
                      onPress={() => void Linking.openURL(`tel:${a.phone!.replace(/\s+/g, '')}`)}
                      accessibilityRole="link"
                      hitSlop={8}
                    >
                      <Text className="text-xs text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                        {a.phone}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View className="gap-3">
            <SectionHeading icon={CalendarDays}>Viewing</SectionHeading>
            <ApartmentAppointment apartmentId={apartment.id} />
          </View>

          <PhotoGallery apartmentId={apartment.id} />

          {checklistPanel}
        </>
      )}

      {viewMode === 'checklist' && (
        <>
          {checklistPanel}
          <ApartmentComments apartmentId={apartment.id} />
        </>
      )}
    </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}
