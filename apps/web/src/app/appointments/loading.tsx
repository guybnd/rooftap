export default function AppointmentsLoading() {
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-muted animate-pulse" />
          <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        </div>
        <div className="h-9 w-9 rounded-lg bg-muted animate-pulse" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, section) => (
          <div key={section} className="space-y-2">
            <div className="h-4 w-24 rounded bg-muted animate-pulse" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-xl border bg-card p-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-muted animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
