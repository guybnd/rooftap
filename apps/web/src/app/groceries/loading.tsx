// Mirrors the page's v2 shape (Hero lede, then one bordered list card per
// aisle with hairline rows) so the swap to real content doesn't jump.
export default function GroceriesLoading() {
  return (
    <div className="space-y-5 p-4 md:p-6 max-w-3xl mx-auto pb-28">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="h-14 w-40 rounded-2xl bg-muted animate-pulse" />
          <div className="h-3 w-32 rounded-full bg-muted animate-pulse" />
        </div>
        <div className="h-11 w-28 rounded-lg bg-muted animate-pulse" />
      </div>
      <div className="h-11 rounded-lg bg-muted animate-pulse" />
      {Array.from({ length: 3 }).map((_, section) => (
        <div key={section} className="space-y-2">
          <div className="h-4 w-28 rounded-full bg-muted animate-pulse" />
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <div className="h-5 w-5 rounded bg-muted animate-pulse" />
                <div className="h-4 flex-1 rounded bg-muted animate-pulse" />
                <div className="h-4 w-10 rounded bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
