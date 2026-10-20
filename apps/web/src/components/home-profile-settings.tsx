"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { geocodeAddress } from "@/lib/geocode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormSection, FieldRow } from "@/components/ui/item-form-sheet";
import { SettingsPanel } from "@/components/settings-panel";
import { HomeIcon, LinkIcon, X } from "lucide-react";
import { toast } from "sonner";
import { describeLease, describeMovingPhase, parseNoticeDays, syncLeaseReminder, useModules } from "@homeup/core";

export function HomeProfileSettings() {
  const { group, refresh } = useDataCache();
  const modules = useModules();
  const [address, setAddress] = useState(group?.home_address || "");
  const [moveInDate, setMoveInDate] = useState(group?.home_move_in_date || "");
  const [leaseEndDate, setLeaseEndDate] = useState(group?.lease_end_date || "");
  const [noticeDays, setNoticeDays] = useState(group?.lease_notice_days?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    setAddress(group?.home_address || "");
    setMoveInDate(group?.home_move_in_date || "");
    setLeaseEndDate(group?.lease_end_date || "");
    setNoticeDays(group?.lease_notice_days?.toString() ?? "");
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
      toast.error("Notice period must be a whole number of days, up to 730");
      return;
    }
    setSaving(true);

    try {
      let lat: number | null = null;
      let lng: number | null = null;

      // Geocode the address if it changed
      if (address && address !== group.home_address) {
        const coords = await geocodeAddress(address, "");
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
        }
      } else if (group.home_lat && group.home_lng) {
        lat = group.home_lat;
        lng = group.home_lng;
      }

      const supabase = createClient();
      const { error } = await supabase
        .from("groups")
        .update({
          home_address: address.trim() || null,
          home_lat: lat,
          home_lng: lng,
          home_move_in_date: moveInDate || null,
          lease_end_date: leaseEndDate || null,
          lease_notice_days: notice,
        })
        .eq("id", group.id);

      // The lease reminder follows the lease terms (idempotent, so every save
      // re-syncs it). A new end date is a new lease term, so a reminder
      // already ticked off comes back.
      const leaseEndChanged = (leaseEndDate || null) !== (group.lease_end_date ?? null);
      if (!error) {
        await syncLeaseReminder(supabase, {
          groupId: group.id,
          terms: { leaseEndDate: leaseEndDate || null, noticeDays: notice },
          reopen: leaseEndChanged,
        }).catch(() => toast.error("Saved, but the lease reminder didn't update. Save again to retry"));
      }

      if (error) {
        toast.error("Failed to save home profile");
      } else {
        toast.success("Home profile saved");
        refresh();
        setChanged(false);
      }
    } catch (e) {
      toast.error("Failed to save home profile");
    } finally {
      setSaving(false);
    }
  };

  const handleUnlinkApartment = async () => {
    if (!group || !group.chosen_apartment_id) return;
    setSaving(true);

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("groups")
        .update({ chosen_apartment_id: null })
        .eq("id", group.id);

      if (error) {
        toast.error("Failed to unlink apartment");
      } else {
        toast.success("Apartment unlinked");
        refresh();
      }
    } catch (e) {
      toast.error("Failed to unlink apartment");
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
            onChange={(e) => handleAddressChange(e.target.value)}
            placeholder="123 Main Street, Bondi NSW 2026"
            disabled={saving}
          />
        </FieldRow>

        {/* The move-in date is the switch for the whole moving feature, so
            the hint states what is true now and what changes if you edit it,
            rather than naming the templates it happens to feed. Reflects the
            unsaved value so the consequence updates as you pick a date. */}
        <FieldRow label="Move-in date" hint={describeMovingPhase(moveInDate || null)}>
          <Input
            type="date"
            value={moveInDate}
            onChange={(e) => handleDateChange(e.target.value)}
            disabled={saving}
          />
        </FieldRow>

        {/* The lease end date marks the home as rented, like the move-in
            date switches on moving. The caption carries the time left and
            when the Tasks reminder lands (only while Tasks is on). */}
        <FieldRow
          label="Lease ends"
          hint={describeLease(
            { leaseEndDate: leaseEndDate || null, noticeDays: parseNoticeDays(noticeDays) },
            { tasksOn: modules.isEnabled("household") },
          )}
        >
          <Input
            type="date"
            value={leaseEndDate}
            onChange={(e) => handleLeaseEndChange(e.target.value)}
            disabled={saving}
          />
        </FieldRow>

        {leaseEndDate && (
          <FieldRow label="Notice period" htmlFor="lease-notice" hint="How long before the end you have to renew or give notice">
            <div className="flex items-center gap-2">
              <Input
                id="lease-notice"
                type="number"
                inputMode="numeric"
                placeholder="30"
                value={noticeDays}
                onChange={(e) => handleNoticeChange(e.target.value)}
                min={0}
                max={730}
                disabled={saving}
                className="h-9 w-24 tabular-nums"
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </FieldRow>
        )}

        {group.chosen_apartment_id && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <LinkIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <span className="text-sm text-foreground">Linked to a listing</span>
                <p className="text-xs text-muted-foreground">Unlinking keeps the profile as it is</p>
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={handleUnlinkApartment}
              disabled={saving}
              aria-label="Unlink listing"
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </FormSection>

      {changed && (
        <Button onClick={handleSave} disabled={saving} size="lg" className="px-4">
          {saving ? "Saving…" : "Save"}
        </Button>
      )}
    </SettingsPanel>
  );
}
