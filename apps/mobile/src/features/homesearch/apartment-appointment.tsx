// HOUP-78: native port of apps/web/src/components/apartment-appointment.tsx
// — the compact viewing-appointment control embedded in the apartment detail
// screen (the standalone /appointments list screen is HOUP-81's separate
// scope and is untouched here). Shows the scheduled viewing's date/time plus
// a "mark as viewed" toggle when a booking exists, or a "Book Appointment"
// button when none does.
//
// Booking/editing reuses the existing native AppointmentModal
// (features/appointments/appointment-modal.tsx) rather than a new modal —
// that component needs apartment/agent/agents/groupId/currentUserId/
// defaultDurationMinutes resolved by its caller (see app/appointments/
// index.tsx for the identical resolution pattern: apartments$ for the
// listing's own record, agents$ + apartment.agent_id for its linked agent),
// so this control subscribes to apartments$/agents$ itself to supply them,
// and wires onSaveAgent/onAssignApartmentAgent so the HOUP-112 agent-capture
// flow also works when booking a first viewing straight from the apartment
// detail screen. `key={appointment?.id ?? apartmentId}` mirrors
// appointment-modal.tsx's documented remount contract so its internal form
// state re-seeds correctly across a booking's create -> edit transition.
//
// defaultDurationMinutes mirrors both apps/web/appointment-modal.tsx and
// app/appointments/index.tsx: userSettings?.appointment_duration_minutes ??
// 20. userSettings is already exposed by useDataCache(), so there's no
// resolution gap here — no need for a 30-minute fallback.
//
// Hearth v2 pass (mirrors web): the booking is a neutral inset row reading
// "Tomorrow · 10:30 AM" (H6 relative day + 12-hour time; H2: coral is for
// controls, not for a date), tapping it edits; "Mark as viewed" is the verb
// beside it and its done state carries the success tint on the glyph.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { use$ } from '@legendapp/state/react';
import { CalendarPlus, CheckCircle2, ChevronRight } from 'lucide-react-native';
import { Text, Button } from '@homeup/ui';
import {
  agents$,
  apartments$,
  appointments$,
  formatRelativeDay,
  useReconnectSync,
  useStoreHelpers,
  type Agent,
  type Apartment,
  type Appointment,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { AppointmentModal } from '@/features/appointments/appointment-modal';

export function ApartmentAppointment({ apartmentId }: { apartmentId: string }) {
  const { group, currentUserId, userSettings } = useDataCache();

  const appts$ = appointments$(group?.id);
  useReconnectSync(appts$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(appts$, currentUserId);

  const apartmentsStore$ = apartments$(group?.id);
  useReconnectSync(apartmentsStore$);
  const { patchRow: patchApartment } = useStoreHelpers(apartmentsStore$, currentUserId);

  const agentsStore$ = agents$(group?.id);
  useReconnectSync(agentsStore$);
  const { writeRow: writeAgent } = useStoreHelpers(agentsStore$, currentUserId);

  const appointment = use$(() =>
    Object.values(appts$.get() ?? {}).find(
      (a): a is Appointment => !!a && !a.deleted && a.apartment_id === apartmentId
    )
  );
  const apartment = use$(
    () =>
      Object.values(apartmentsStore$.get() ?? {}).find(
        (a): a is Apartment => !!a && !a.deleted && a.id === apartmentId
      ) ?? null
  );
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );
  const agent = apartment?.agent_id ? agents.find((a) => a.id === apartment.agent_id) ?? null : null;

  const [open, setOpen] = React.useState(false);
  const durationMinutes = userSettings?.appointment_duration_minutes ?? 20;

  const handleToggleViewed = () => {
    if (!appointment) return;
    patchRow(appointment.id, { status: appointment.status === 'viewed' ? 'scheduled' : 'viewed' });
  };

  const formatWhen = (dateString: string) => {
    const d = new Date(dateString);
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${formatRelativeDay(d)} · ${time}`;
  };

  const isViewed = appointment?.status === 'viewed';

  return (
    <>
      {appointment ? (
        <View className="gap-2">
          <Pressable
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Viewing ${formatWhen(appointment.scheduled_at)}. Edit`}
            className="min-h-[44px] flex-row items-center gap-2 rounded-2xl bg-muted/40 px-3.5 py-2 active:bg-muted/60"
          >
            <Text className="text-sm font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {formatWhen(appointment.scheduled_at)}
            </Text>
            <ChevronRight size={16} className="ml-auto text-muted-foreground" />
          </Pressable>
          <Button
            variant="outline"
            className="h-11 w-full"
            onPress={handleToggleViewed}
            accessibilityState={{ selected: isViewed }}
          >
            <CheckCircle2 size={16} className={isViewed ? 'text-success' : 'text-muted-foreground'} />
            <Text className="text-sm font-medium text-foreground">{isViewed ? 'Viewed' : 'Mark as viewed'}</Text>
          </Button>
        </View>
      ) : (
        <Button variant="outline" className="h-11 w-full" onPress={() => setOpen(true)}>
          <CalendarPlus size={16} className="text-muted-foreground" />
          <Text className="text-sm font-medium text-foreground">Book a viewing</Text>
        </Button>
      )}

      {group && (
        <AppointmentModal
          key={appointment?.id ?? apartmentId}
          open={open}
          appointment={appointment}
          apartmentId={apartmentId}
          apartment={apartment}
          agent={agent}
          agents={agents}
          groupId={group.id}
          currentUserId={currentUserId}
          defaultDurationMinutes={durationMinutes}
          onClose={() => setOpen(false)}
          onSave={(saved) => {
            writeRow(saved);
            setOpen(false);
          }}
          onDelete={(id) => {
            softDeleteRow(id);
            setOpen(false);
          }}
          onSaveAgent={writeAgent}
          onAssignApartmentAgent={(aptId, agentId) => patchApartment(aptId, { agent_id: agentId })}
        />
      )}
    </>
  );
}
