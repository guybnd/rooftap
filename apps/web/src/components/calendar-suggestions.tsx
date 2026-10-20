"use client";

import { useState, useEffect, useCallback } from "react";
import { ExternalLink, Home, ListTodo, X } from "lucide-react";
import { formatRelativeDay } from '@homeup/core';
import type { GoogleCalendarEvent, ApartmentWithScore } from '@homeup/core';

/**
 * FLUX-157: banner of classifier-flagged, viewing-looking Google Calendar
 * events awaiting the user's import/dismiss decision. Renders nothing when
 * there are none (or the fetch 401s) — no noisy empty state.
 */

interface CalendarSuggestionsProps {
  apartments: ApartmentWithScore[];
}

export function CalendarSuggestions({ apartments }: CalendarSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<GoogleCalendarEvent[]>([]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/calendar/suggestions");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setSuggestions(data.suggestions ?? []);
      } catch {
        // silent — banner just doesn't render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const remove = (eventId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== eventId));
    setPickerFor((cur) => (cur === eventId ? null : cur));
  };

  const importAsAppointment = useCallback(
    async (eventId: string, apartmentId: string) => {
      setBusyId(eventId);
      try {
        const res = await fetch("/api/calendar/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, target: "appointment", apartmentId }),
        });
        if (res.ok) remove(eventId);
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  const importAsTask = useCallback(async (eventId: string) => {
    setBusyId(eventId);
    try {
      const res = await fetch("/api/calendar/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, target: "task" }),
      });
      if (res.ok) remove(eventId);
    } finally {
      setBusyId(null);
    }
  }, []);

  const dismiss = useCallback(async (eventId: string) => {
    setBusyId(eventId);
    try {
      const res = await fetch("/api/calendar/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      if (res.ok) remove(eventId);
    } finally {
      setBusyId(null);
    }
  }, []);

  if (suggestions.length === 0) return null;

  return (
    <div className="mb-6 space-y-2">
      <h2 className="font-heading text-base font-semibold">
        From your Google Calendar
      </h2>
      {suggestions.map((s) => {
        const date = new Date(s.starts_at);
        const isBusy = busyId === s.id;
        return (
          <div key={s.id} className="rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{s.title || "Untitled event"}</span>
                  {s.html_link && (
                    <a
                      href={s.html_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      title="Open in Google Calendar"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                {/* H6: relative day + 12-hour time, one middle dot; the location
                    gets its own line rather than a second dot. */}
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  {formatRelativeDay(date)}
                  {" · "}
                  {date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </p>
                {s.location && <p className="mt-0.5 truncate text-xs text-muted-foreground">{s.location}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(s.id)}
                disabled={isBusy}
                className="-mr-2 -mt-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                title="Dismiss"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPickerFor(pickerFor === s.id ? null : s.id)}
                disabled={isBusy}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
              >
                <Home className="h-3 w-3" />
                Import as appointment
              </button>
              <button
                type="button"
                onClick={() => importAsTask(s.id)}
                disabled={isBusy}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
              >
                <ListTodo className="h-3 w-3" />
                Add as to-do
              </button>
            </div>

            {pickerFor === s.id && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-2xl bg-muted/40">
                {apartments.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-2">No apartments yet.</p>
                ) : (
                  apartments
                    .filter((a) => !a.archived)
                    .map((apt) => (
                      <button
                        key={apt.id}
                        type="button"
                        onClick={() => importAsAppointment(s.id, apt.id)}
                        disabled={isBusy}
                        className="w-full min-h-10 text-left px-3 py-2 text-sm hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        {apt.address}
                        {apt.suburb && <span className="text-muted-foreground">, {apt.suburb}</span>}
                      </button>
                    ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
