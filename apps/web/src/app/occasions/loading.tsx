export default function OccasionsLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6 pb-24">
      <div className="flex items-center justify-between gap-3">
        <div className="h-16 w-56 rounded-lg bg-muted animate-pulse" />
        <div className="h-11 w-20 rounded-xl bg-muted animate-pulse" />
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-3xl border border-border/60 bg-card">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <div className="size-9 rounded-[11px] bg-muted animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
            </div>
            <div className="h-4 w-14 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
