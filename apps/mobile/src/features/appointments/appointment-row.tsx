// HOUP-81: native appointment row. Trimmed vs. the web DayGroup's per-row
// WaypointCard: no transit-leg timing, map-route waypoint index, or per-
// apartment comment thread — those depend on apps/web's routing/map stack
// (useMultiRoute, TransitLeg), which has no native port yet and is out of
// scope for a picker-focused ticket. Kept: time, address, agent, and status
// (the fields the edit modal actually manages), tap-to-edit, swipe-to-delete
// (mirrors apps/mobile/src/app/costs/cost-card.tsx).
//
// Hearth v2 pass: 12-hour time ("10:30 AM", H6) and a non-default status as
// a tinted word in the trailing slot (PC1: a chip promises a tap; H2: coral
// is interactive, so Optional reads amber, Viewed green, the rest muted).
import * as React from 'react';
import { View } from 'react-native';
import { appointmentClockTime, dialog } from '@homeup/core';
import { Trash2 } from 'lucide-react-native';
import { Text, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing, SwipeActions, cn } from '@homeup/ui';
import type { Agent, Apartment, Appointment } from '@homeup/core';

const STATUS_LABEL: Record<Appointment['status'], string> = {
  scheduled: 'Active',
  viewed: 'Viewed',
  cancelled: 'Cancelled',
  optional: 'Optional',
  skipped: 'Skipped',
  rebook: 'Rebook',
};

interface AppointmentRowProps {
  appointment: Appointment;
  apartment: Apartment | null;
  agent: Agent | null;
  onEdit: (appointment: Appointment) => void;
  onDelete: (appointment: Appointment) => void;
}

export function AppointmentRow({ appointment, apartment, agent, onEdit, onDelete }: AppointmentRowProps) {
  const time = appointmentClockTime(new Date(appointment.scheduled_at));
  const isDefault = appointment.status === 'scheduled';
  const isViewed = appointment.status === 'viewed';

  const confirmDelete = () => {
    dialog.alert(`Delete this appointment?`, "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          onDelete(appointment);
        },
      },
    ]);
  };

  return (
    <SwipeActions
      onSwipeLeft={confirmDelete}
      left={{
        bg: 'bg-destructive/15',
        activeBg: 'bg-destructive',
        icon: <Trash2 size={18} className="text-destructive" />,
        label: 'Delete',
      }}
    >
      <View className={isViewed ? 'opacity-60' : undefined}>
        <ListItem onPress={() => onEdit(appointment)}>
          <ListItemLeading>
            <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: agent?.color ?? '#9ca3af' }} />
          </ListItemLeading>

          <ListItemContent>
            <ListItemTitle>{apartment?.address ?? 'Appointment'}</ListItemTitle>
            <ListItemMeta>
              <Text className="text-data-fragment text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {time}
              </Text>
              {apartment?.suburb && (
                <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                  {apartment.suburb}
                </Text>
              )}
              {agent && (
                <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                  {agent.name}
                </Text>
              )}
            </ListItemMeta>
          </ListItemContent>

          {!isDefault && (
            <ListItemTrailing>
              <Text
                className={cn(
                  'text-xs font-medium',
                  appointment.status === 'optional'
                    ? 'text-warning'
                    : appointment.status === 'viewed'
                      ? 'text-success'
                      : 'text-muted-foreground'
                )}
              >
                {STATUS_LABEL[appointment.status]}
              </Text>
            </ListItemTrailing>
          )}
        </ListItem>
      </View>
    </SwipeActions>
  );
}
