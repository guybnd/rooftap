export default function ChecklistsLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6 pb-24">
      <div className="flex items-center justify-end">
        <div className="h-9 w-36 rounded-lg bg-muted animate-pulse" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border bg-card p-3">
            <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
            </div>
            <div className="h-4 w-10 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
