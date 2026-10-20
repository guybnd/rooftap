// HOUP-148: native confirm screen for a shared viewing-invite .ics — the
// destination <ShareIntentHandler/> routes to after reading a shared
// text/calendar file's raw text and stashing it via setPendingShareIcs.
// Mirrors web apps/web/src/app/share-target/page.tsx's "confirm-calendar"
// status branch (Calendar card + ApartmentPicker + notes + Save/Discard),
// adapted to React Native View/Text and this app's FormSection/FieldRow
// conventions (see apartment/new.tsx). Revives the previously-dead
// ApartmentPicker/fuzzyMatchApartment from features/homesearch/apartment-picker.
import * as React from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
// HOUP-318: keyboard-aware scroll container (same swap as Home/Costs) so an
// inline field low on the page scrolls above the on-screen keyboard.
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Calendar } from 'lucide-react-native';
import { Text, Button, FieldRow, FormSection, ScreenBackground } from '@homeup/ui';
import { appointments$, apartments$, useReconnectSync, useStoreHelpers, type Apartment } from '@homeup/core';
import { parseIcs, type ParsedEvent } from '@homeup/core';
import { use$ } from '@legendapp/state/react';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { ApartmentPicker, fuzzyMatchApartment } from '@/features/homesearch/apartment-picker';
import { takePendingShareIcs } from '@/lib/share-ingest';
import { randomUUID } from '@/lib/uuid';
import { useOpenRoute } from '@/lib/tab-routes';

function formatEventWhen(event: ParsedEvent): string {
  if (!event.dtstart) return '';
  const datePart = event.dtstart.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const startTime = event.dtstart.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const endTime = event.dtend?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return endTime ? `${datePart} at ${startTime} – ${endTime}` : `${datePart} at ${startTime}`;
}

export default function ShareCalendarScreen() {
  const insets = useSafeAreaInsets();
  const openRoute = useOpenRoute();
  const { group, currentUserId, loading: cacheLoading } = useDataCache();

  const apts$ = apartments$(group?.id);
  useReconnectSync(apts$);
  const apartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );

  const appts$ = appointments$(group?.id);
  const { writeRow: writeAppointment } = useStoreHelpers(appts$, currentUserId);

  const [icsText] = React.useState<string | null>(() => takePendingShareIcs());
  const [event] = React.useState<ParsedEvent | null>(() => (icsText ? parseIcs(icsText) : null));

  const suggestedId = React.useMemo(
    () => (event ? fuzzyMatchApartment(event.location, apartments) : null),
    [event, apartments]
  );

  // On the share-target path this screen mounts during cold start, so `group`
  // is still withheld by the DataCacheProvider's boot race guard and
  // `apartments` is empty for the first render(s) — the auto-match only
  // resolves once the store hydrates. So the picked apartment is derived
  // (live suggestion, overridden by an explicit pick) rather than seeded into
  // state from a suggestion that isn't computable yet.
  const [pickedId, setPickedId] = React.useState<string | null>(null);
  const apartmentId = pickedId ?? suggestedId;
  const [notes, setNotes] = React.useState(event?.description ?? '');
  const [saving, setSaving] = React.useState(false);

  const canSave = !!apartmentId && !!event?.dtstart && !!group && !saving;

  const handleSave = async () => {
    if (!canSave || !group || !event?.dtstart || !apartmentId) return;
    setSaving(true);
    try {
      writeAppointment({
        id: randomUUID(),
        user_id: currentUserId ?? '',
        group_id: group.id,
        apartment_id: apartmentId,
        scheduled_at: event.dtstart.toISOString(),
        notes: notes.trim() || null,
        status: 'scheduled',
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      });
      openRoute('/appointments');
    } finally {
      setSaving(false);
    }
  };

  if (cacheLoading) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  if (!icsText || !event) {
    const message = !icsText
      ? 'No shared calendar event found.'
      : 'Could not parse calendar file. Only single-event .ics files are supported.';
    return (
      <ScreenBackground className="items-center justify-center gap-4 p-6">
        <Text className="text-center text-body text-muted-foreground">{message}</Text>
        <Button onPress={() => openRoute('/homesearch')}>
          <Text className="text-sm font-medium text-primary-foreground">Back to Home Search</Text>
        </Button>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => openRoute('/homesearch')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <ArrowLeft size={20} className="text-muted-foreground" />
          </Pressable>
          <Text className="font-heading text-title font-semibold text-foreground">Import calendar event</Text>
        </View>

        <View className="gap-2 rounded-lg border border-border p-4">
          <View className="flex-row items-center gap-2">
            <Calendar size={16} className="text-muted-foreground" />
            <Text className="font-medium text-foreground">{event.summary || 'Untitled event'}</Text>
          </View>
          {event.dtstart && <Text className="text-caption text-muted-foreground">{formatEventWhen(event)}</Text>}
          {event.location ? <Text className="text-caption text-muted-foreground">{event.location}</Text> : null}
        </View>

        <FormSection title="Link to apartment">
          <FieldRow label="Apartment" required>
            <ApartmentPicker value={apartmentId} onChange={setPickedId} suggestedId={suggestedId} />
          </FieldRow>
          {suggestedId && apartmentId === suggestedId && (
            <Text className="text-xs text-muted-foreground">Auto-matched from event location</Text>
          )}

          <FieldRow label="Notes">
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Any notes about this viewing..."
              multiline
              numberOfLines={3}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-body text-foreground placeholder:text-muted-foreground"
            />
          </FieldRow>
        </FormSection>

        <View className="flex-row gap-3 pt-2">
          <Button onPress={handleSave} disabled={!canSave}>
            <Text className="text-sm font-medium text-primary-foreground">{saving ? 'Saving…' : 'Save appointment'}</Text>
          </Button>
          <Button variant="outline" onPress={() => openRoute('/homesearch')} disabled={saving}>
            <Text className="text-sm font-medium text-foreground">Discard</Text>
          </Button>
        </View>
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}
