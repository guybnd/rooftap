// HOUP-84: native port of apps/web/src/components/home-profile-settings.tsx.
// HOUP-149 added a native geocode path: an address edit re-resolves
// home_lat/home_lng via the server-side proxy in @/lib/geocode-api
// (geocodeAddress), which keeps the Mapbox token out of the mobile bundle.
// A failed/offline lookup normalizes to null, matching the prior
// clear-rather-than-keep-stale-coords behavior. Unchanged address keeps its
// existing coordinate pair. Writes go straight to the `groups` table via the
// same getCurrentSupabaseClient() pattern as this ticket's other settings
// panels.
import * as React from 'react';
import { View } from 'react-native';
import { Home as HomeIcon, Link as LinkIcon, X } from 'lucide-react-native';
import { Text, Button, DateScrollField, FieldRow, FormSection, Input } from '@homeup/ui';
import { SettingsPanel } from './settings-panel';
import { addDaysISO, describeLease, describeMovingPhase, parseNoticeDays, syncLeaseReminder, todayISO, useModules } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { geocodeAddress } from '@/lib/geocode-api';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';

export function HomeProfileSettings() {
  const { group, refresh } = useDataCache();
  const modules = useModules();
  const [address, setAddress] = React.useState(group?.home_address ?? '');
  const [moveInDate, setMoveInDate] = React.useState(group?.home_move_in_date ?? '');
  const [leaseEndDate, setLeaseEndDate] = React.useState(group?.lease_end_date ?? '');
  const [noticeDays, setNoticeDays] = React.useState(group?.lease_notice_days?.toString() ?? '');
  const [saving, setSaving] = React.useState(false);
  const [changed, setChanged] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setAddress(group?.home_address ?? '');
    setMoveInDate(group?.home_move_in_date ?? '');
    setLeaseEndDate(group?.lease_end_date ?? '');
    setNoticeDays(group?.lease_notice_days?.toString() ?? '');
    setChanged(false);
  }, [group?.home_address, group?.home_move_in_date, group?.lease_end_date, group?.lease_notice_days]);

  const handleAddressChange = (value: string) => {
    setAddress(value);
    setChanged(true);
  };

  const handleDateChange = (value: string) => {
    setMoveInDate(value);
    setChanged(true);
  };

  const handleLeaseEndChange = (value: string) => {
    setLeaseEndDate(value);
    setChanged(true);
  };

  const handleNoticeChange = (value: string) => {
    setNoticeDays(value);
    setChanged(true);
  };

  const handleSave = async () => {
    if (!group) return;
    const notice = noticeDays.trim() ? parseNoticeDays(noticeDays) : null;
    if (noticeDays.trim() && notice === null) {
      setError('Notice period must be a whole number of days, up to 730');
      return;
    }
    setSaving(true);
    setError(null);

    // The address changed — re-resolve coordinates via the geocode proxy.
    // Unchanged address keeps its existing pair.
    const addressChanged = address.trim() !== (group.home_address ?? '');
    let lat = group.home_lat;
    let lng = group.home_lng;
    if (addressChanged) {
      const resolved = await geocodeAddress(address.trim());
      lat = resolved?.lat ?? null;
      lng = resolved?.lng ?? null;
    }

    try {
      const supabase = getCurrentSupabaseClient();
      const { error: updateError } = await supabase
        .from('groups')
        .update({
          home_address: address.trim() || null,
          home_lat: lat,
          home_lng: lng,
          home_move_in_date: moveInDate || null,
          lease_end_date: leaseEndDate || null,
          lease_notice_days: notice,
        })
        .eq('id', group.id);

      // The lease reminder follows the lease terms (idempotent, so every save
      // re-syncs it). A new end date is a new lease term, so a reminder
      // already ticked off comes back. Mirrors web.
      let reminderFailed = false;
      if (!updateError) {
        await syncLeaseReminder(supabase, {
          groupId: group.id,
          terms: { leaseEndDate: leaseEndDate || null, noticeDays: notice },
          reopen: (leaseEndDate || null) !== (group.lease_end_date ?? null),
        }).catch(() => {
          reminderFailed = true;
        });
      }

      if (updateError) {
        setError("Couldn't save. Try again");
      } else {
        if (reminderFailed) setError("Saved, but the lease reminder didn't update. Save again to retry");
        await refresh();
        setChanged(false);
      }
    } catch {
      setError("Couldn't save. Try again");
    } finally {
      setSaving(false);
    }
  };

  const handleUnlinkApartment = async () => {
    if (!group || !group.chosen_apartment_id) return;
    setSaving(true);
    setError(null);

    try {
      const supabase = getCurrentSupabaseClient();
      const { error: updateError } = await supabase
        .from('groups')
        .update({ chosen_apartment_id: null })
        .eq('id', group.id);

      if (updateError) {
        setError("Couldn't unlink apartment. Try again");
      } else {
        await refresh();
      }
    } catch {
      setError("Couldn't unlink apartment. Try again");
    } finally {
      setSaving(false);
    }
  };

  if (!group) return null;

  return (
    <SettingsPanel icon={HomeIcon} title="Home profile">
      <FormSection>
        <FieldRow label="Address" hint="Used for distances and technician bookings">
          <Input
            value={address}
            onChangeText={handleAddressChange}
            placeholder="123 Main Street, Bondi NSW 2026"
            editable={!saving}
          />
        </FieldRow>

        {/* The move-in date is the switch for the whole moving feature, so
            the hint states what is true now and what changes if you edit it,
            rather than naming the templates it happens to feed. Reflects the
            unsaved value so the consequence updates as you pick a date. */}
        <FieldRow label="Move-in date" hint={describeMovingPhase(moveInDate || null)}>
          <DateScrollField value={moveInDate} onChange={handleDateChange} />
        </FieldRow>

        {/* The lease end date marks the home as rented, like the move-in
            date switches on moving. The caption carries the time left and
            when the Tasks reminder lands (only while Tasks is on). The
            spinner only appears once you say you rent, seeded a year out. */}
        <FieldRow
          label="Lease ends"
          hint={describeLease(
            { leaseEndDate: leaseEndDate || null, noticeDays: parseNoticeDays(noticeDays) },
            { tasksOn: modules.isEnabled('household') },
          )}
        >
          {leaseEndDate ? (
            <View className="gap-1">
              <DateScrollField value={leaseEndDate} onChange={handleLeaseEndChange} />
              <Button
                size="sm"
                variant="ghost"
                onPress={() => handleLeaseEndChange('')}
                disabled={saving}
                className="self-center"
              >
                Not renting
              </Button>
            </View>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onPress={() => handleLeaseEndChange(addDaysISO(todayISO(), 365))}
              disabled={saving}
              className="self-start"
            >
              Set lease end date
            </Button>
          )}
        </FieldRow>

        {leaseEndDate ? (
          <FieldRow label="Notice period" hint="How long before the end you have to renew or give notice">
            <View className="flex-row items-center gap-2">
              <Input
                value={noticeDays}
                onChangeText={handleNoticeChange}
                keyboardType="number-pad"
                placeholder="30"
                editable={!saving}
                className="w-24"
              />
              <Text className="text-sm text-muted-foreground">days</Text>
            </View>
          </FieldRow>
        ) : null}

        {group.chosen_apartment_id && (
          <View className="flex-row items-center justify-between gap-2">
            <View className="min-w-0 flex-1 flex-row items-center gap-2">
              <LinkIcon size={14} className="shrink-0 text-muted-foreground" />
              <View className="min-w-0 flex-1">
                <Text className="text-sm text-foreground">Linked to a listing</Text>
                <Text className="text-caption text-muted-foreground">Unlinking keeps the profile as it is</Text>
              </View>
            </View>
            <Button
              size="icon-sm"
              variant="ghost"
              onPress={handleUnlinkApartment}
              disabled={saving}
              accessibilityLabel="Unlink listing"
              className="shrink-0"
            >
              <X size={16} className="text-muted-foreground" />
            </Button>
          </View>
        )}
      </FormSection>

      {error && <Text className="text-caption text-destructive">{error}</Text>}

      {changed && (
        <Button onPress={handleSave} disabled={saving} size="sm" className="self-start px-4">
          {saving ? 'Saving…' : 'Save'}
        </Button>
      )}
    </SettingsPanel>
  );
}
