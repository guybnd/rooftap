export default function ChecklistNewLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6 pb-24">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded bg-muted animate-pulse" />
        <div className="h-7 w-40 rounded bg-muted animate-pulse" />
      </div>
      <div className="space-y-4 rounded-xl border bg-card p-4">
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="space-y-1.5">
          <div className="h-3 w-12 rounded bg-muted animate-pulse" />
          <div className="h-10 rounded-lg border bg-muted animate-pulse" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 w-20 rounded-lg border bg-muted animate-pulse" />
          ))}
        </div>
        <div className="h-10 w-32 rounded-lg bg-muted animate-pulse" />
      </div>
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="h-4 w-40 rounded bg-muted animate-pulse" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-14 rounded-lg border bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  );
}
