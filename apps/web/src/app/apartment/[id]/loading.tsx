export default function ApartmentLoading() {
  return (
    <main className="p-4 sm:p-8 max-w-2xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-5 w-16 rounded bg-muted animate-pulse" />
        <div className="h-10 w-48 rounded-lg bg-muted/40 animate-pulse" />
      </div>
      <div className="mb-8">
        <div className="h-8 w-64 rounded-lg bg-muted animate-pulse" />
        <div className="h-4 w-48 rounded bg-muted animate-pulse mt-2" />
        <div className="mt-4 h-9 w-44 rounded-lg bg-muted/40 animate-pulse" />
      </div>
      <div className="mb-8 h-40 rounded-3xl border border-border/60 bg-card animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[72px] rounded-2xl bg-muted/40 animate-pulse" />
        ))}
      </div>
    </main>
  );
}
