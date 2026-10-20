// HOUP-81: native add/edit sheet for an appointment. Trimmed vs.
// apps/web/src/components/appointment-modal.tsx: the caller resolves
// apartment/agent and passes them in (this screen only ever shows one
// modal at a time, so there's no need for the sheet to re-subscribe to the
// apartments$/agents$ stores itself); and the .ics "Add to Calendar" export
// is dropped entirely — no expo-file-system/expo-sharing dependency exists
// in apps/mobile yet, and adding one mid-port would need an EAS rebuild
// before the HOUP-77 on-device smoke this ticket is gated on could even
// run. apps/web keeps the export button; native gets it in a follow-up once
// that dependency lands. Duration persists to user_settings on save,
// mirroring web's handleSave — same getCurrentSupabaseClient() +
// user_settings upsert pattern as apps/mobile/src/app/(tabs)/costs/index.tsx's
// persistSettings.
//
// HOUP-191: migrated off a hand-built BottomSheet shell onto the shared
// `ItemFormSheet` (@homeup/ui) — same header/scrollable-body/sticky-footer
// anatomy as household-task-modal.tsx, incl. its centralized destructive
// confirm + `warn()` haptic (this component's own `Alert.alert` delete
// confirm is gone; `deleteConfirmTitle`/`deleteConfirmMessage`/`deleteLabel`
// reproduce the same copy). Fields/logic are unchanged.
import * as React from 'react';
import { View } from 'react-native';
import { Text, DateScrollField, FieldRow, ItemFormSheet, Input, SegmentedControl, TimeScrollField } from '@homeup/ui';
import { pickAgentColor, type Agent, type Apartment, type Appointment } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { randomUUID } from '@/lib/uuid';
import { sectionIconFor } from '@/lib/section-icons';

// Hearth v2 (E1): the sheet header wears the section's identity tile.
const SEARCH_SECTION = { id: 'search', Icon: sectionIconFor('search') };

const DURATIONS = [15, 30, 45, 60] as const;
const STATUS_OPTIONS: { value: Appointment['status']; label: string }[] = [
  { value: 'scheduled', label: 'Active' },
  { value: 'viewed', label: 'Viewed' },
  { value: 'optional', label: 'Optional' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'rebook', label: 'Rebook' },
];

interface AppointmentModalProps {
  open: boolean;
  appointment?: Appointment;
  apartmentId: string;
  apartment: Apartment | null;
  agent: Agent | null;
  /** HOUP-112: existing agents, for the new-booking agent-capture fields (name
   *  match + color pool). Omitted by callers that never book a new appointment. */
  agents?: Agent[];
  groupId: string;
  currentUserId: string | null;
  defaultDurationMinutes: number;
  /** HOUP-87: pre-fill a new appointment's date/time from a calendar slot long-press. Ignored when `appointment` is set (editing). */
  initialScheduledAt?: Date;
  onClose: () => void;
  onSave: (appointment: Appointment) => void;
  onDelete?: (id: string) => void;
  /** HOUP-112: creates a new agent row when the booking form's name field doesn't match an existing agent. */
  onSaveAgent?: (agent: Agent) => void;
  /** HOUP-112: assigns the (found-or-created) agent to the apartment being booked. */
  onAssignApartmentAgent?: (apartmentId: string, agentId: string) => void;
}

export function AppointmentModal({
  open,
  appointment,
  apartmentId,
  apartment,
  agent,
  agents,
  groupId,
  currentUserId,
  defaultDurationMinutes,
  initialScheduledAt,
  onClose,
  onSave,
  onDelete,
  onSaveAgent,
  onAssignApartmentAgent,
}: AppointmentModalProps) {
  // The caller remounts this component on `appointment?.id ?? apartmentId`
  // (mirrors household-task-modal.tsx), so these initializers alone re-seed
  // the form — no resync effect needed.
  const initDate = appointment ? new Date(appointment.scheduled_at) : initialScheduledAt ?? new Date();
  const [dateStr, setDateStr] = React.useState(() => {
    const y = initDate.getFullYear();
    const m = String(initDate.getMonth() + 1).padStart(2, '0');
    const d = String(initDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
  const [timeStr, setTimeStr] = React.useState(() => {
    const h = String(appointment || initialScheduledAt ? initDate.getHours() : 9).padStart(2, '0');
    const m = String(appointment || initialScheduledAt ? initDate.getMinutes() : 0).padStart(2, '0');
    return `${h}:${m}`;
  });
  const [duration, setDuration] = React.useState<number>(defaultDurationMinutes);
  const [notes, setNotes] = React.useState(appointment?.notes ?? '');
  const [status, setStatus] = React.useState<Appointment['status']>(appointment?.status ?? 'scheduled');
  const [agentName, setAgentName] = React.useState('');
  const [agentPhone, setAgentPhone] = React.useState('');

  const address = apartment?.address ?? 'Appointment';
  const suburb = apartment?.suburb;
  // HOUP-112: only a new booking with no agent on the listing yet offers
  // agent capture — editing an existing appointment never touches the
  // apartment's agent (mirrors apps/web's booking-dialog-only agent fields).
  const showAgentCapture = !appointment && !agent && !!onSaveAgent && !!onAssignApartmentAgent;

  const save = () => {
    if (!currentUserId || !groupId) return;
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, min] = timeStr.split(':').map(Number);
    const scheduledAt = new Date(y, m - 1, d, h, min);

    if (duration !== defaultDurationMinutes) {
      getCurrentSupabaseClient()
        .from('user_settings')
        .upsert({ user_id: currentUserId, appointment_duration_minutes: duration }, { onConflict: 'user_id' })
        .then(undefined, () => {
          // Offline, or the client isn't bound yet — the appointment save
          // below still proceeds; the next duration change will retry.
        });
    }

    if (showAgentCapture && agentName.trim()) {
      const existing = (agents ?? []).find((a) => a.name.toLowerCase() === agentName.trim().toLowerCase());
      const assignAgentId = existing?.id ?? randomUUID();
      if (!existing) {
        onSaveAgent!({
          id: assignAgentId,
          user_id: currentUserId,
          group_id: groupId,
          name: agentName.trim(),
          phone: agentPhone.trim() || null,
          color: pickAgentColor(agents ?? []),
          notes: null,
          deleted: false,
          created_at: null as unknown as string,
          updated_at: null as unknown as string,
        });
      }
      onAssignApartmentAgent!(apartmentId, assignAgentId);
    }

    if (appointment) {
      onSave({ ...appointment, scheduled_at: scheduledAt.toISOString(), notes: notes || null, status });
    } else {
      onSave({
        id: randomUUID(),
        user_id: currentUserId,
        group_id: groupId,
        apartment_id: apartmentId,
        scheduled_at: scheduledAt.toISOString(),
        notes: notes || null,
        status: 'scheduled',
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      });
    }
  };

  const requestDelete = () => {
    if (!appointment || !onDelete) return;
    onDelete(appointment.id);
    onClose();
  };

  return (
    <ItemFormSheet
      section={SEARCH_SECTION}
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={appointment ? 'Edit appointment' : 'Book appointment'}
      previewContent={
        <>
          <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium text-foreground">
            {address}
            {suburb ? ` (${suburb})` : ''}
          </Text>
          {appointment && (
            <Text className="shrink-0 text-xs font-medium text-muted-foreground">
              {STATUS_OPTIONS.find((o) => o.value === status)?.label}
            </Text>
          )}
        </>
      }
      onSubmit={save}
      onDelete={appointment && onDelete ? requestDelete : undefined}
      deleteLabel="Remove"
      deleteConfirmTitle={appointment ? 'Remove this appointment?' : undefined}
      deleteConfirmMessage="This can't be undone."
    >
      {agent && (
        <View className="flex-row items-center gap-2 rounded-lg bg-muted/50 p-2.5">
          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: agent.color }} />
          <Text className="text-sm font-medium text-foreground">{agent.name}</Text>
          {agent.phone && <Text className="text-sm text-muted-foreground">{agent.phone}</Text>}
        </View>
      )}

      {showAgentCapture && (
        <FieldRow label="Agent (optional)" hint={agentName.trim() ? 'Agent will be saved to this listing and your settings' : undefined}>
          <View className="gap-1.5">
            <Input value={agentName} onChangeText={setAgentName} placeholder="Agent name" />
            <Input value={agentPhone} onChangeText={setAgentPhone} placeholder="Agent phone (optional)" keyboardType="phone-pad" />
          </View>
        </FieldRow>
      )}

      <FieldRow label="Date">
        <View className="rounded-lg border border-border bg-muted/30 py-2">
          <DateScrollField value={dateStr} onChange={setDateStr} />
        </View>
      </FieldRow>

      <FieldRow label="Time">
        <View className="rounded-lg border border-border bg-muted/30 py-2">
          <TimeScrollField value={timeStr} onChange={setTimeStr} />
        </View>
      </FieldRow>

      <FieldRow label="Duration">
        <SegmentedControl
          options={DURATIONS.map((d) => ({ value: String(d), label: d < 60 ? `${d}m` : '1hr' }))}
          value={String(duration)}
          onChange={(v) => setDuration(Number(v))}
        />
      </FieldRow>

      {appointment && (
        <FieldRow label="Status">
          <SegmentedControl options={STATUS_OPTIONS} value={status} onChange={setStatus} wrap size="sm" />
        </FieldRow>
      )}

      <FieldRow label="Notes">
        <Input
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. Bring tape measure"
          multiline
          numberOfLines={2}
          className="h-16 py-2"
          textAlignVertical="top"
        />
      </FieldRow>
    </ItemFormSheet>
  );
}
