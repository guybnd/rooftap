export default function HomeLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6 pb-24">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-3 h-56 rounded-xl border bg-card animate-pulse" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-40 rounded-xl border bg-card p-4 space-y-2">
            <div className="h-5 w-24 rounded bg-muted animate-pulse" />
            <div className="h-4 w-full rounded bg-muted animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
