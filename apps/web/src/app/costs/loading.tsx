export default function CostsLoading() {
  return (
    <div className="space-y-5 p-4 md:p-6 max-w-5xl mx-auto pb-24">
      <div className="flex items-center justify-end gap-2">
        <div className="h-9 w-24 rounded-lg bg-muted animate-pulse" />
        <div className="h-9 w-9 rounded-lg bg-muted animate-pulse" />
      </div>
      <div className="h-48 rounded-xl border bg-muted animate-pulse" />
      {Array.from({ length: 3 }).map((_, section) => (
        <div key={section} className="space-y-2">
          <div className="h-5 w-32 rounded bg-muted animate-pulse" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-3 flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
                <div className="h-3 w-1/4 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-4 w-14 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
