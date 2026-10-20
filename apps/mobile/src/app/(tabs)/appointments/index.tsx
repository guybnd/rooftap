// HOUP-81: native Appointments — new route (web has no dedicated Appointments
// screen component either; it renders /appointments as a Home-Search
// navItem). Live data via HOUP-86's native StoreEnvironment + useDataCache()
// provider, reusing @homeup/core's appointments$/apartments$/agents$ stores
// verbatim (HOUP-73) — no new core code.
//
// Trimmed vs. apps/web/src/app/appointments/page.tsx (day-grouped list with
// transit-leg timing, map-route waypoints, per-apartment comment threads,
// CalendarSuggestions' /api/calendar/* Google-sync widget, and the .ics
// export — all deferred, see appointment-row.tsx/appointment-modal.tsx's
// header comments for why each is out of scope for this pass). Kept: a
// day-grouped upcoming list, book/edit/delete via one modal, and a simple
// apartment picker for booking a new viewing.
//
// Reachable via router.push('/appointments') from apps/mobile/src/app/
// homesearch/index.tsx's placeholder — Home Search itself isn't ported yet
// (still SectionPlaceholderScreen), so this ticket adds one direct entry
// point rather than the full Home Search nav.
//
// HOUP-208: ScrollView -> FlashList. Day-header/upcoming-row/past-toggle/
// past-row rows now flatten into one array (`getItemType` per row kind,
// mirroring HOUP-207's groceries.tsx custom-union pattern rather than the
// shared flattenGroups helper, since the past section's rows render
// differently from the upcoming section's AppointmentRow and neither the
// past-toggle row nor the day count fit the shared SectionRow<T> shape).
// Everything above the list (lede, pulse strip) hoists into
// ListHeaderComponent.
//
// Hearth v2 pass (mirrors web): head action reads "Book"; times are 12-hour
// ("10:30 AM", H6); the pulse strip only shows a tile that says something
// the Hero doesn't ("This week" when fewer than all upcoming, "Optional"
// when any; empty chrome hides at zero); the empty state is the shared
// EmptyState (no dashed box); day headers keep their muted micro label and
// say "1 viewing"; past rows read address first with "Sat, Oct 17 · 10:30 AM"
// trailing; the picker sheet is "Book a viewing" with 44px rows.
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { use$ } from '@legendapp/state/react';
import { CalendarDays, ChevronDown, Plus } from 'lucide-react-native';
import { Text, BottomSheet, Button, EmptyState, HeroLede, Input, PulseTile, ScreenBackground, cn, groupFrameClass, type RowPos } from '@homeup/ui';
import {
  agents$,
  apartments$,
  appointments$,
  MOTION_DURATIONS_MS,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  formatRelativeDay,
  toISODate,
  type Agent,
  type Apartment,
  type Appointment,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { AppointmentRow } from '@/features/appointments/appointment-row';
import { AppointmentModal } from '@/features/appointments/appointment-modal';

// HOUP-208: the flattened row union feeding FlashList — a day-header row per
// upcoming day group, its AppointmentRows, one past-section toggle row, and
// (once expanded) the past rows themselves (a compact inline layout, not
// AppointmentRow — mirrors the pre-FlashList markup exactly).
type AppointmentFlatRow =
  | { kind: 'day-header'; id: string; label: string; count: number }
  | { kind: 'upcoming'; id: string; appointment: Appointment; pos: RowPos }
  | { kind: 'past-toggle'; id: string; count: number }
  | { kind: 'past'; id: string; appointment: Appointment; pos: RowPos };

/** H6: a relative day read mid-caption ("Next: tomorrow 6:30 PM"). Today and
 * Tomorrow drop their capital; weekday and dated labels keep theirs. Mirrors
 * apps/web/src/app/appointments/page.tsx. */
function relativeDayFragment(date: Date): string {
  const day = formatRelativeDay(date);
  return day === 'Today' || day === 'Tomorrow' ? day.toLowerCase() : day;
}

/** H6: a 12-hour clock time, "10:30 AM". Mirrors web's clockTime. */
function clockTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function appointmentRowSpacing(prev: AppointmentFlatRow | undefined, current: AppointmentFlatRow): string | undefined {
  if (!prev) return undefined;
  if (current.kind === 'day-header') return 'mt-5';
  if (prev.kind === 'day-header') return 'mt-2';
  if (current.kind === 'past-toggle') return 'mt-1';
  if (prev.kind === 'past-toggle') return 'mt-2';
  return undefined;
}

export default function AppointmentsSectionScreen() {
  const insets = useSafeAreaInsets();
  const { group, currentUserId, userSettings, loading: cacheLoading } = useDataCache();

  const appts$ = appointments$(group?.id);
  useReconnectSync(appts$);
  const { writeRow, softDeleteRow } = useStoreHelpers(appts$, currentUserId);

  const apartmentsStore$ = apartments$(group?.id);
  useReconnectSync(apartmentsStore$);
  const { patchRow: patchApartment } = useStoreHelpers(apartmentsStore$, currentUserId);
  const agentsStore$ = agents$(group?.id);
  useReconnectSync(agentsStore$);
  const { writeRow: writeAgent } = useStoreHelpers(agentsStore$, currentUserId);

  const appointments = use$(() =>
    Object.values(appts$.get() ?? {}).filter((a): a is Appointment => !!a && !a.deleted)
  );
  const apartments = use$(() =>
    Object.values(apartmentsStore$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );

  const storeLoaded = useStoreLoaded(appts$, apartmentsStore$, agentsStore$);

  const [editingAppointment, setEditingAppointment] = React.useState<Appointment | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [bookingModalOpen, setBookingModalOpen] = React.useState(false);
  const [bookingApartmentId, setBookingApartmentId] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerSearch, setPickerSearch] = React.useState('');
  const [showPast, setShowPast] = React.useState(false);

  const durationMinutes = userSettings?.appointment_duration_minutes ?? 20;

  const { upcomingGroups, upcomingCount, past } = React.useMemo(() => {
    const now = new Date();
    const sorted = [...appointments].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    const upcomingList = sorted.filter((a) => new Date(a.scheduled_at) >= now);
    const pastList = sorted.filter((a) => new Date(a.scheduled_at) < now).reverse();
    const groups: Appointment[][] = [];
    for (const appt of upcomingList) {
      const dateStr = toISODate(new Date(appt.scheduled_at));
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && toISODate(new Date(lastGroup[0].scheduled_at)) === dateStr) lastGroup.push(appt);
      else groups.push([appt]);
    }
    return { upcomingGroups: groups, upcomingCount: upcomingList.length, past: pastList };
  }, [appointments]);

  // Hero lede caption (the next viewing) + pulse strip (Hearth H1/H3, mirrors apps/web).
  const upcomingFlat = React.useMemo(() => upcomingGroups.flat(), [upcomingGroups]);
  const nextAppt = upcomingFlat[0] ?? null;
  const nextApartment = nextAppt ? apartments.find((a) => a.id === nextAppt.apartment_id) ?? null : null;
  const nextDate = nextAppt ? new Date(nextAppt.scheduled_at) : null;
  const thisWeekCount = React.useMemo(() => {
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    return upcomingFlat.filter((a) => new Date(a.scheduled_at) <= weekFromNow).length;
  }, [upcomingFlat]);
  const optionalCount = React.useMemo(() => upcomingFlat.filter((a) => a.status === 'optional').length, [upcomingFlat]);

  const apartmentById = React.useCallback((id: string) => apartments.find((a) => a.id === id) ?? null, [apartments]);
  const agentFor = React.useCallback(
    (apt: Apartment | null) => (apt?.agent_id ? agents.find((a) => a.id === apt.agent_id) ?? null : null),
    [agents]
  );

  const filteredApartments = apartments.filter(
    (a) =>
      !a.archived &&
      (!pickerSearch.trim() ||
        a.address.toLowerCase().includes(pickerSearch.toLowerCase()) ||
        (a.suburb && a.suburb.toLowerCase().includes(pickerSearch.toLowerCase())))
  );

  // HOUP-208: flatten day-grouped upcoming rows + the past-section toggle +
  // (once expanded) past rows into one FlashList data array. Past rows with
  // no resolvable apartment are skipped, matching the pre-FlashList `if
  // (!apt) return null` — computed here instead so it doesn't shift `pos`.
  const flatData = React.useMemo<AppointmentFlatRow[]>(() => {
    const rows: AppointmentFlatRow[] = [];
    for (const dayAppointments of upcomingGroups) {
      const first = new Date(dayAppointments[0].scheduled_at);
      rows.push({ kind: 'day-header', id: `day-header:${toISODate(first)}`, label: formatRelativeDay(first), count: dayAppointments.length });
      const lastIndex = dayAppointments.length - 1;
      dayAppointments.forEach((appt, index) => {
        const pos: RowPos = dayAppointments.length === 1 ? 'only' : index === 0 ? 'first' : index === lastIndex ? 'last' : 'middle';
        rows.push({ kind: 'upcoming', id: appt.id, appointment: appt, pos });
      });
    }
    if (past.length > 0) {
      rows.push({ kind: 'past-toggle', id: 'past-toggle', count: past.length });
      if (showPast) {
        const resolvable = past.filter((a) => apartmentById(a.apartment_id));
        const lastIndex = resolvable.length - 1;
        resolvable.forEach((appt, index) => {
          const pos: RowPos = resolvable.length === 1 ? 'only' : index === 0 ? 'first' : index === lastIndex ? 'last' : 'middle';
          rows.push({ kind: 'past', id: appt.id, appointment: appt, pos });
        });
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingGroups, past, showPast, apartmentById]);

  if (cacheLoading || (!storeLoaded && appointments.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  const editingApartment = editingAppointment ? apartmentById(editingAppointment.apartment_id) : null;
  const bookingApartment = bookingApartmentId ? apartmentById(bookingApartmentId) : null;

  // Unlike tasks/groceries/costs' own ListHeaderComponent, this header has no
  // TextInput — the picker's search field lives inside the BottomSheet below,
  // not this header — so there's no focus-loss risk from a fresh element each
  // render; skipping the useMemo wrapper those screens need for their inputs.
  const listHeader = (
    <View className="gap-4 pb-5">
      {/* H1: one lede. Hearth v2 (Pulse): the upcoming count is a Hero
          number, the next viewing its caption; the screen's name and its
          action sit on the label row above it. */}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-micro-label uppercase text-muted-foreground">Appointments</Text>
        <Button size="sm" onPress={() => { setPickerSearch(''); setPickerOpen(true); }}>
          <Plus size={14} className="text-primary-foreground" />
          <Text className="text-sm font-medium text-primary-foreground">Book</Text>
        </Button>
      </View>
      <HeroLede
        value={upcomingCount}
        label="upcoming"
        caption={
          nextDate ? (
            <>
              Next: {relativeDayFragment(nextDate)}{' '}
              <Text className="text-data-fragment text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {clockTime(nextDate)}
              </Text>
              {nextApartment?.address ? ` · ${nextApartment.address}` : null}
            </>
          ) : undefined
        }
      />

      {/* H1: no Upcoming tile, the Hero already counts it; "This week" only
          when fewer than all upcoming, "Optional" only when any. */}
      {(thisWeekCount > 0 && thisWeekCount < upcomingCount) || optionalCount > 0 ? (
        <View className="flex-row gap-2">
          {thisWeekCount > 0 && thisWeekCount < upcomingCount && (
            <View className="flex-1">
              <PulseTile label="This week" value={thisWeekCount} />
            </View>
          )}
          {optionalCount > 0 && (
            <View className="flex-1">
              <PulseTile label="Optional" value={optionalCount} tone="warning" />
            </View>
          )}
        </View>
      ) : null}

      {upcomingCount === 0 && past.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title="No viewings booked"
          description="Book one for any listing you're tracking"
        />
      )}
    </View>
  );

  const renderItem: ListRenderItem<AppointmentFlatRow> = ({ item: row, index }) => {
    const prev = index > 0 ? flatData[index - 1] : undefined;
    const spacing = appointmentRowSpacing(prev, row);
    if (row.kind === 'day-header') {
      return (
        <View className={cn('flex-row items-baseline gap-1.5 px-1', spacing)}>
          {/* Hearth v2 (H2): muted like the Home feed's day headers; coral means interactive. */}
          <Text className="text-micro-label uppercase text-muted-foreground">{row.label}</Text>
          <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {row.count} viewing{row.count !== 1 ? 's' : ''}
          </Text>
        </View>
      );
    }
    if (row.kind === 'past-toggle') {
      return (
        <Pressable
          onPress={() => setShowPast((v) => !v)}
          className={cn('min-h-[44px] flex-row items-center gap-2 self-start px-1', spacing)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showPast }}
        >
          <ChevronDown
            size={16}
            className="text-muted-foreground"
            style={{ transform: [{ rotate: showPast ? '180deg' : '0deg' }] }}
          />
          <Text className="text-sm font-medium text-muted-foreground">Past viewings</Text>
          <Text className="text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {row.count}
          </Text>
        </Pressable>
      );
    }
    if (row.kind === 'past') {
      const apt = apartmentById(row.appointment.apartment_id);
      if (!apt) return null;
      const date = new Date(row.appointment.scheduled_at);
      return (
        <View className={cn(groupFrameClass(row.pos), 'min-h-[44px] flex-row items-center gap-3 px-4 py-2.5 opacity-60', spacing)}>
          <Text className="flex-1 text-body text-foreground" numberOfLines={1}>
            {apt.address}
          </Text>
          <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {formatRelativeDay(date)} · {clockTime(date)}
          </Text>
        </View>
      );
    }
    // upcoming
    const apt = apartmentById(row.appointment.apartment_id);
    return (
      <View className={cn(groupFrameClass(row.pos), spacing)}>
        <AppointmentRow
          appointment={row.appointment}
          apartment={apt}
          agent={agentFor(apt)}
          onEdit={(a) => { setEditingAppointment(a); setModalOpen(true); }}
          onDelete={(a) => softDeleteRow(a.id)}
        />
      </View>
    );
  };

  return (
    <ScreenBackground>
      <FlashList
        data={flatData}
        keyExtractor={(row) => row.id}
        getItemType={(row) => row.kind}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 96,
        }}
      />

      {/* HOUP-191: always render — only `open` toggles — so the sheet's
          250ms exit animation gets to play instead of being unmounted
          mid-animation by a wrapping `{x && (...)}` (same fix as
          apps/mobile/src/app/(tabs)/calendar/index.tsx). Every close path flips
          `open` first and defers clearing the edited item (plus its store
          write) until after MOTION_DURATIONS_MS.exit. */}
      <AppointmentModal
        key={editingAppointment?.id ?? 'edit-appointment'}
        open={modalOpen}
        appointment={editingAppointment ?? undefined}
        apartmentId={editingAppointment?.apartment_id ?? ''}
        apartment={editingApartment}
        agent={agentFor(editingApartment)}
        groupId={group.id}
        currentUserId={currentUserId}
        defaultDurationMinutes={durationMinutes}
        onClose={() => { setModalOpen(false); setTimeout(() => setEditingAppointment(null), MOTION_DURATIONS_MS.exit); }}
        onSave={(saved) => {
          setModalOpen(false);
          setTimeout(() => { writeRow(saved); setEditingAppointment(null); }, MOTION_DURATIONS_MS.exit);
        }}
        onDelete={(id) => {
          setModalOpen(false);
          setTimeout(() => { softDeleteRow(id); setEditingAppointment(null); }, MOTION_DURATIONS_MS.exit);
        }}
      />

      <AppointmentModal
        key={bookingApartmentId ? `new-${bookingApartmentId}` : 'new-booking'}
        open={bookingModalOpen}
        apartmentId={bookingApartmentId ?? ''}
        apartment={bookingApartment}
        agent={agentFor(bookingApartment)}
        agents={agents}
        groupId={group.id}
        currentUserId={currentUserId}
        defaultDurationMinutes={durationMinutes}
        onClose={() => { setBookingModalOpen(false); setTimeout(() => setBookingApartmentId(null), MOTION_DURATIONS_MS.exit); }}
        onSave={(created) => {
          setBookingModalOpen(false);
          setTimeout(() => { writeRow(created); setBookingApartmentId(null); }, MOTION_DURATIONS_MS.exit);
        }}
        onSaveAgent={writeAgent}
        onAssignApartmentAgent={(apartmentId, agentId) => patchApartment(apartmentId, { agent_id: agentId })}
      />

      <BottomSheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <View className="gap-3 px-4 pb-2 pt-1">
          <Text className="font-heading text-title font-medium text-foreground">Book a viewing</Text>
          <Input value={pickerSearch} onChangeText={setPickerSearch} placeholder="Search by address" autoFocus />
          <ScrollView className="max-h-72">
            <View className="gap-1">
              {filteredApartments.slice(0, 20).map((apt) => (
                <Pressable
                  key={apt.id}
                  onPress={() => { setBookingApartmentId(apt.id); setBookingModalOpen(true); setPickerOpen(false); setPickerSearch(''); }}
                  className="min-h-[44px] justify-center rounded-lg px-3 py-2 active:bg-muted"
                >
                  <Text className="text-sm font-medium text-foreground">
                    {apt.address}
                    {apt.suburb ? <Text className="font-normal text-muted-foreground">, {apt.suburb}</Text> : null}
                  </Text>
                </Pressable>
              ))}
              {filteredApartments.length === 0 && (
                <Text className="px-3 py-2 text-sm text-muted-foreground">No apartments match.</Text>
              )}
            </View>
          </ScrollView>
        </View>
      </BottomSheet>
    </ScreenBackground>
  );
}
