"use client";

interface ModeDuration {
  seconds: number;
  label: string;
}

interface TransitLegProps {
  departureTime: Date;
  nextAppointmentTime: Date;
  modes: {
    walking: ModeDuration | null;
    cycling: ModeDuration | null;
    driving: ModeDuration | null;
  };
}

// Hearth v2 pass: the leg between two stops is a neutral inset on a neutral
// connector (no status-tinted border or fill, H2); state shows as the dot,
// the buffer value, and a mode's time only when it won't fit. H6: 12-hour
// times ("Leave by 11:00 AM").
function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatMinutes(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const remaining = mins % 60;
  return remaining > 0 ? `${hrs}h ${remaining}m` : `${hrs}h`;
}

function getModeIcon(mode: "walking" | "cycling" | "driving") {
  if (mode === "walking") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="1.5" />
        <path d="M13.5 6.5L15 12l-3 1-1.5 6.5" />
        <path d="M9 12l2-1-1.5-4.5" />
        <path d="M6 19l3-2" />
      </svg>
    );
  }
  if (mode === "cycling") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5.5" cy="17.5" r="3.5" />
        <circle cx="18.5" cy="17.5" r="3.5" />
        <path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h2" />
      </svg>
    );
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2-5H8L6 10l-2.5 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}

export function TransitLeg({ departureTime, nextAppointmentTime, modes }: TransitLegProps) {
  const availableBufferMs = nextAppointmentTime.getTime() - departureTime.getTime();
  const availableBufferMinutes = Math.round(availableBufferMs / 60000);

  let bufferColor: string;
  let dotColor: string;

  if (availableBufferMinutes < 0) {
    bufferColor = "text-destructive";
    dotColor = "bg-destructive";
  } else if (availableBufferMinutes < 10) {
    bufferColor = "text-warning";
    dotColor = "bg-warning";
  } else {
    bufferColor = "text-success";
    dotColor = "bg-success";
  }

  const modeEntries = (["walking", "cycling", "driving"] as const)
    .filter((m) => modes[m] != null)
    .map((m) => {
      const dur = modes[m]!;
      const travelMinutes = Math.round(dur.seconds / 60);
      const fitsInBuffer = travelMinutes <= availableBufferMinutes;
      return { mode: m, dur, travelMinutes, fitsInBuffer };
    });

  return (
    <div className="relative ml-[30px] py-1.5 pl-5">
      <div className="absolute bottom-0 left-0 top-0 w-px bg-border" />
      <div className={`absolute left-[-3px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full ${dotColor}`} />

      <div className="space-y-1.5 rounded-2xl bg-muted/40 px-3 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="tabular-nums text-muted-foreground">Leave by {formatTime(departureTime)}</span>
          <span className={`font-medium tabular-nums ${bufferColor}`}>
            {availableBufferMinutes < 0
              ? `${Math.abs(availableBufferMinutes)} min short`
              : `${availableBufferMinutes} min buffer`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {modeEntries.map(({ mode, dur, fitsInBuffer }) => (
            <div
              key={mode}
              className={`flex items-center gap-1 tabular-nums ${fitsInBuffer ? "text-muted-foreground" : "text-destructive"}`}
            >
              {getModeIcon(mode)}
              <span>{formatMinutes(dur.seconds)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface TransitLegNoRouteProps {
  message?: string;
}

export function TransitLegNoRoute({ message }: TransitLegNoRouteProps) {
  return (
    <div className="relative ml-[30px] py-1.5 pl-5">
      <div className="absolute bottom-0 left-0 top-0 w-px bg-border" />
      <div className="absolute left-[-3px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-muted-foreground/40" />
      <div className="rounded-2xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {message || "Route unavailable"}
      </div>
    </div>
  );
}
