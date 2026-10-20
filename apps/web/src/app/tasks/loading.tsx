export default function TasksLoading() {
  return (
    <div className="space-y-3 p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
          <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
        </div>
      </div>
      <div className="h-10 rounded-lg border bg-muted animate-pulse" />
      {Array.from({ length: 3 }).map((_, section) => (
        <div key={section} className="space-y-2">
          <div className="h-4 w-24 rounded bg-muted animate-pulse" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border bg-card p-3">
              <div className="h-5 w-5 rounded-full bg-muted animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
                <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
