// HOUP-100: native port of apps/web/src/app/calendar/page.tsx's Google
// Calendar overlay event detail dialog (share/unshare, dismiss,
// import-as-task, import-as-appointment with an apartment picker). Action
// gating (isOwn, ev.state) mirrors page.tsx:1598-1722 verbatim.
import * as React from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Building2, Clock, ExternalLink, EyeOff, ListPlus, MapPin, Search, Share2 } from 'lucide-react-native';
import type { Apartment, GoogleCalendarEventWithAttribution } from '@homeup/core';
import { Text, BottomSheet, Button, Input } from '@homeup/ui';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

function memberLabel(userId: string | null, profiles: MemberProfiles): string {
  if (!userId) return 'Unassigned';
  const profile = profiles[userId];
  if (!profile) return 'Former member';
  return profile.name || profile.email || 'Member';
}

function formatTimeRange(ev: GoogleCalendarEventWithAttribution): string {
  const start = new Date(ev.starts_at);
  if (ev.is_all_day) {
    return `${start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · All day`;
  }
  const end = ev.ends_at ? new Date(ev.ends_at) : null;
  const startLabel = `${start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return end ? `${startLabel} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : startLabel;
}

export interface CalendarEventSheetProps {
  event: GoogleCalendarEventWithAttribution | null;
  onClose: () => void;
  memberProfiles: MemberProfiles;
  apartments: Apartment[];
  busy: boolean;
  onShareToggle: () => void;
  onDismiss: () => void;
  /** Modules: omitted when the calendar can't add to-dos (calendar.tasks, module-features.ts); hides "Add as to-do". */
  onImportAsTask?: () => void;
  /** Modules: omitted when the calendar can't show viewings (calendar.viewings); hides "Import as appointment". */
  onImportAsAppointment?: (apartmentId: string) => void;
}

export function CalendarEventSheet({
  event,
  onClose,
  memberProfiles,
  apartments,
  busy,
  onShareToggle,
  onDismiss,
  onImportAsTask,
  onImportAsAppointment,
}: CalendarEventSheetProps) {
  const [apartmentPickerOpen, setApartmentPickerOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    setApartmentPickerOpen(false);
    setSearch('');
  }, [event]);

  const filteredApartments = React.useMemo(() => {
    if (!search.trim()) return apartments;
    const q = search.toLowerCase();
    return apartments.filter((a) => a.address.toLowerCase().includes(q) || (a.suburb && a.suburb.toLowerCase().includes(q)));
  }, [apartments, search]);

  return (
    <BottomSheet open={!!event} onOpenChange={(open) => { if (!open) onClose(); }}>
      {event && (() => {
        const isOwn = !event.sharedByUserId;
        return (
          <View className="gap-3 px-4 pb-2 pt-1">
            {/* H2: "Looks like a viewing" is a status word, tinted as text,
                not a tinted pill (web's event dialog draws the same). */}
            <View className="gap-0.5">
              <Text className="font-heading text-title font-semibold text-foreground">
                {event.title || 'Untitled event'}
              </Text>
              {event.state === 'suggested' && (
                <Text className="text-xs font-medium text-warning">Looks like a viewing</Text>
              )}
            </View>

            <View className="flex-row items-center gap-2">
              <Clock size={14} className="text-muted-foreground" />
              <Text className="text-body text-muted-foreground">{formatTimeRange(event)}</Text>
            </View>
            {event.location && (
              <View className="flex-row items-center gap-2">
                <MapPin size={14} className="text-muted-foreground" />
                <Text className="text-body text-muted-foreground">{event.location}</Text>
              </View>
            )}

            {/* Who shared it is a fact, not a control: plain muted text (H2). */}
            {!isOwn ? (
              <Text className="text-xs text-muted-foreground">
                Shared by {memberLabel(event.sharedByUserId ?? null, memberProfiles)}
              </Text>
            ) : event.visibility === 'group' ? (
              <Text className="text-xs text-muted-foreground">Shared with your group</Text>
            ) : null}

            {onImportAsAppointment && apartmentPickerOpen && (
              <View className="gap-2 rounded-lg border border-border p-2">
                <Text className="text-xs font-medium text-muted-foreground">Choose an apartment</Text>
                <View className="flex-row items-center gap-2">
                  <Search size={16} className="text-muted-foreground" />
                  <Input value={search} onChangeText={setSearch} placeholder="Search by address or suburb…" className="flex-1 h-9" autoFocus />
                </View>
                <ScrollView className="max-h-40">
                  {filteredApartments.length === 0 ? (
                    <Text className="p-3 text-center text-sm text-muted-foreground">No apartments found</Text>
                  ) : (
                    filteredApartments.map((apt) => (
                      <Pressable
                        key={apt.id}
                        disabled={busy}
                        onPress={() => onImportAsAppointment(apt.id)}
                        className="flex-row items-start gap-2 p-2 active:bg-muted/50 disabled:opacity-50"
                      >
                        <MapPin size={14} className="mt-0.5 text-muted-foreground" />
                        <View className="min-w-0 flex-1">
                          <Text numberOfLines={1} className="text-sm font-medium text-foreground">{apt.address}</Text>
                          {apt.suburb && <Text numberOfLines={1} className="text-xs text-muted-foreground">{apt.suburb}</Text>}
                        </View>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </View>
            )}

            <View className="flex-row flex-wrap gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                disabled={!event.html_link}
                onPress={() => event.html_link && void Linking.openURL(event.html_link)}
              >
                <ExternalLink size={14} className="text-foreground mr-1" />
                Open in Google Calendar
              </Button>
              {isOwn && (
                <>
                  <Button variant="outline" size="sm" disabled={busy} onPress={onShareToggle}>
                    <Share2 size={14} className="text-foreground mr-1" />
                    {event.visibility === 'group' ? 'Unshare' : 'Share to group'}
                  </Button>
                  {onImportAsAppointment && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || event.state === 'imported'}
                      onPress={() => setApartmentPickerOpen((v) => !v)}
                    >
                      <Building2 size={14} className="text-foreground mr-1" />
                      Import as appointment
                    </Button>
                  )}
                  {onImportAsTask && (
                    <Button variant="outline" size="sm" disabled={busy || event.state === 'imported'} onPress={onImportAsTask}>
                      <ListPlus size={14} className="text-foreground mr-1" />
                      Add as to-do
                    </Button>
                  )}
                  {event.state === 'suggested' && (
                    <Button variant="outline" size="sm" disabled={busy} onPress={onDismiss}>
                      <EyeOff size={14} className="text-foreground mr-1" />
                      Dismiss
                    </Button>
                  )}
                </>
              )}
            </View>
          </View>
        );
      })()}
    </BottomSheet>
  );
}
