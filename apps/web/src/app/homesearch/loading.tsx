export default function HomeSearchLoading() {
  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="h-16 w-40 rounded-2xl bg-muted animate-pulse" />
        <div className="h-4 w-28 rounded-md bg-muted animate-pulse mt-3" />
      </div>
      <div className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[52px] rounded-xl bg-muted/40 animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-3xl border border-border/60 bg-card p-4 space-y-3">
            <div className="h-5 w-3/4 rounded bg-muted animate-pulse" />
            <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
            <div className="h-8 w-20 rounded-lg bg-muted animate-pulse mt-2" />
          </div>
        ))}
      </div>
    </main>
  );
}
