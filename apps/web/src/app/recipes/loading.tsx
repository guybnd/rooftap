export default function RecipesLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-10 w-48 rounded-lg border bg-muted animate-pulse" />
        <div className="flex items-center gap-1.5">
          <div className="h-9 w-9 rounded-lg bg-muted animate-pulse" />
          <div className="h-9 w-9 rounded-lg bg-muted animate-pulse" />
          <div className="h-9 w-28 rounded-lg bg-muted animate-pulse" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-3 space-y-2">
            <div className="h-20 rounded-lg bg-muted animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
            <div className="h-2 rounded-full bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
