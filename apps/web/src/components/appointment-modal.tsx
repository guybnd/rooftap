"use client";

import { useState } from "react";
import { CalendarDays, Trash2, Download } from "lucide-react";
import { ScrollField } from "@/components/scroll-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { appointments$, apartments$, agents$, useReconnectSync, useStoreHelpers } from "@homeup/core";
import { downloadIcs } from "@/lib/ics";
import { use$ } from "@legendapp/state/react";
import type { Agent, Apartment, Appointment } from '@homeup/core';


function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface AppointmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment?: Appointment | null;
  apartmentId: string;
  apartmentAddress?: string;
  apartmentSuburb?: string | null;
  listingUrl?: string | null;
}

export function AppointmentModal({
  open,
  onOpenChange,
  appointment,
  apartmentId,
  apartmentAddress,
  apartmentSuburb,
  listingUrl,
}: AppointmentModalProps) {
  const { userSettings, group, currentUserId } = useDataCache();

  const appts$ = appointments$(group?.id);
  useReconnectSync(appts$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(appts$, currentUserId);

  const apartmentsStore$ = apartments$(group?.id);
  useReconnectSync(apartmentsStore$);
  const agentsStore$ = agents$(group?.id);
  useReconnectSync(agentsStore$);

  const apartments = use$(() =>
    Object.values(apartmentsStore$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );

  const initDate = appointment ? new Date(appointment.scheduled_at) : new Date();
  const [year, setYear] = useState(initDate.getFullYear());
  const [month, setMonth] = useState(initDate.getMonth());
  const [day, setDay] = useState(initDate.getDate());
  const [hour, setHour] = useState(initDate.getHours());
  const [minute, setMinute] = useState(appointment ? initDate.getMinutes() : 0);
  const [notes, setNotes] = useState(appointment?.notes || "");
  const [status, setStatus] = useState<Appointment["status"]>(appointment?.status || "scheduled");
  const [duration, setDuration] = useState(userSettings?.appointment_duration_minutes ?? 20);
  const [loading, setLoading] = useState(false);

  const resetFields = (appt?: Appointment | null) => {
    const d = appt ? new Date(appt.scheduled_at) : new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setDay(d.getDate());
    setHour(d.getHours());
    setMinute(appt ? d.getMinutes() : 0);
    setNotes(appt?.notes || "");
    setStatus(appt?.status || "scheduled");
    setDuration(userSettings?.appointment_duration_minutes ?? 20);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      resetFields(appointment);
    }
    onOpenChange(newOpen);
  };

  const maxDay = getDaysInMonth(year, month);
  const clampedDay = Math.min(day, maxDay);

  const apt = apartments.find((a) => a.id === apartmentId);
  const agent = apt?.agent_id ? agents.find((a) => a.id === apt.agent_id) : null;
  const address = apartmentAddress || apt?.address || "Appointment";
  const suburb = apartmentSuburb ?? apt?.suburb;

  const handleSave = async () => {
    setLoading(true);

    if (duration !== (userSettings?.appointment_duration_minutes ?? 20) && currentUserId) {
      const supabase = createClient();
      await supabase
        .from("user_settings")
        .upsert({ user_id: currentUserId, appointment_duration_minutes: duration }, { onConflict: "user_id" });
    }

    if (!currentUserId || !group?.id) {
      setLoading(false);
      return;
    }

    const scheduledAt = new Date(year, month, clampedDay, hour, minute);

    if (appointment) {
      patchRow(appointment.id, {
        scheduled_at: scheduledAt.toISOString(),
        notes: notes || null,
        status,
      });
    } else {
      writeRow({
        id: crypto.randomUUID(),
        user_id: currentUserId,
        group_id: group.id,
        apartment_id: apartmentId,
        scheduled_at: scheduledAt.toISOString(),
        notes: notes || null,
        status: "scheduled",
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      });
    }

    onOpenChange(false);
    setLoading(false);
  };

  const handleDelete = () => {
    if (!appointment) return;
    setLoading(true);
    softDeleteRow(appointment.id);
    onOpenChange(false);
    setLoading(false);
  };

  const handleExport = async () => {
    const scheduledAt = new Date(year, month, clampedDay, hour, minute);
    try {
      await downloadIcs(
        {
          summary: `Viewing: ${address}`,
          dtstart: scheduledAt,
          location: [address, suburb].filter(Boolean).join(", "),
          description: [notes, listingUrl ?? apt?.listing_url].filter(Boolean).join("\n"),
        },
        address
      );
    } catch {}
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onClick={(e) => e.stopPropagation()} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{appointment ? "Edit Appointment" : "Book Appointment"}</DialogTitle>
          {address && (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
              <CalendarDays className="h-3.5 w-3.5" />
              {address}
              {suburb && <span className="text-muted-foreground/60">({suburb})</span>}
            </p>
          )}
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {agent && (
            <div className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg p-2.5">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: agent.color }}
              />
              <span className="font-medium">{agent.name}</span>
              {agent.phone && (
                <span className="text-muted-foreground">{agent.phone}</span>
              )}
            </div>
          )}

          <div className="grid gap-2">
            <label className="text-sm font-medium">Date & Time</label>
            <div className="flex items-start justify-center gap-1.5 py-2">
              <ScrollField value={clampedDay} onChange={setDay} min={1} max={maxDay} label="Day" />
              <ScrollField value={month} onChange={setMonth} min={0} max={11} label="Month" display={MONTHS[month]} />
              <ScrollField value={year} onChange={setYear} min={2024} max={2030} label="Year" pad={4} wide />
              <div className="w-3 flex items-center justify-center self-center text-muted-foreground font-medium">
                ·
              </div>
              <ScrollField value={hour} onChange={setHour} min={0} max={23} label="Hour" />
              <div className="self-center text-muted-foreground font-bold mt-[-18px]">:</div>
              <ScrollField value={minute} onChange={setMinute} min={0} max={55} step={5} label="Min" />
            </div>
            <div className="text-center text-xs text-muted-foreground">
              {new Date(year, month, clampedDay, hour, minute).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}{" "}
              at{" "}
              {new Date(year, month, clampedDay, hour, minute).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Duration</label>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {([15, 30, 45, 60] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                    duration === d
                      ? "bg-primary text-primary-foreground"
                      : "bg-card hover:bg-muted"
                  }`}
                >
                  {d < 60 ? `${d}m` : "1hr"}
                </button>
              ))}
            </div>
          </div>
          {appointment && (
            <div className="grid gap-2">
              <label className="text-sm font-medium">Status</label>
              <div className="flex rounded-lg border border-border overflow-hidden">
                {(["scheduled", "optional", "skipped", "rebook"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                      status === s
                        ? s === "skipped" || s === "rebook" ? "bg-secondary text-secondary-foreground"
                          : s === "optional" ? "bg-warning text-warning-foreground"
                          : "bg-primary text-primary-foreground"
                        : "bg-card hover:bg-muted"
                    }`}
                  >
                    {s === "scheduled" ? "Active" : s === "optional" ? "Optional" : s === "skipped" ? "Skipped" : "Rebook"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-2">
            <label htmlFor="appt-notes" className="text-sm font-medium">
              Notes (Optional)
            </label>
            <Input
              id="appt-notes"
              placeholder="e.g. Bring tape measure"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <div className="flex gap-1">
            {appointment && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleDelete}
                disabled={loading}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Remove
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handleExport}
              disabled={loading}
              title="Add to Calendar"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
