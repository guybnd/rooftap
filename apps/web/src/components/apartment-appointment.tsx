"use client";

import { useState } from "react";
import { CalendarPlus, CheckCircle2, ChevronRight } from "lucide-react";
import { use$ } from "@legendapp/state/react";
import { Button } from "@/components/ui/button";
import { useDataCache } from "@/lib/data-cache";
import { appointments$, formatRelativeDay, useReconnectSync, useStoreHelpers } from "@homeup/core";
import { cn } from "@/lib/utils";
import { AppointmentModal } from "@/components/appointment-modal";
import type { Appointment } from '@homeup/core';

export function ApartmentAppointment({ apartmentId }: { apartmentId: string }) {
  const { group, currentUserId } = useDataCache();
  const appts$ = appointments$(group?.id);
  useReconnectSync(appts$);
  const { patchRow } = useStoreHelpers(appts$, currentUserId);

  const appointment = use$(() =>
    Object.values(appts$.get() ?? {}).find(
      (a): a is Appointment => !!a && !a.deleted && a.apartment_id === apartmentId
    )
  );
  const [open, setOpen] = useState(false);

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };

  const handleToggleViewed = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!appointment) return;
    const newStatus = appointment.status === "viewed" ? "scheduled" : "viewed";
    patchRow(appointment.id, { status: newStatus });
  };

  // H6: a relative day and a 12-hour time, one middle dot ("Tomorrow · 10:30 AM").
  const formatWhen = (dateString: string) => {
    const d = new Date(dateString);
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${formatRelativeDay(d)} · ${time}`;
  };

  const isViewed = appointment?.status === "viewed";

  // Hearth v2 pass: the booking is a neutral inset row (H2: coral is for
  // controls, not for a date), tapping it edits; "Mark as viewed" sits beside
  // it as the one verb, and its done state carries the success tint.
  return (
    <>
      {appointment ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <button
            type="button"
            onClick={handleOpen}
            className="flex min-h-11 items-center gap-2 rounded-2xl bg-muted/40 px-3.5 py-2 text-left transition-colors hover:bg-muted/60"
          >
            <span className="text-sm font-medium tabular-nums">{formatWhen(appointment.scheduled_at)}</span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          <Button
            variant="outline"
            className="h-11 rounded-xl px-3.5 text-sm font-medium"
            aria-pressed={isViewed}
            onClick={handleToggleViewed}
          >
            <CheckCircle2 className={cn("h-4 w-4 mr-1.5", isViewed ? "text-success" : "text-muted-foreground")} />
            {isViewed ? "Viewed" : "Mark as viewed"}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          className="h-11 w-full rounded-xl text-sm font-medium"
          onClick={handleOpen}
        >
          <CalendarPlus className="h-4 w-4 mr-1.5 text-muted-foreground" />
          Book a viewing
        </Button>
      )}

      <AppointmentModal
        open={open}
        onOpenChange={setOpen}
        appointment={appointment}
        apartmentId={apartmentId}
      />
    </>
  );
}
