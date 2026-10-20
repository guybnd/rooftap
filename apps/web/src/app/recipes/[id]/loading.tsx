export default function RecipeDetailLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6 pb-24">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded bg-muted animate-pulse" />
        <div className="h-6 w-6 rounded bg-muted animate-pulse" />
        <div className="h-7 flex-1 rounded bg-muted animate-pulse" />
        <div className="h-5 w-5 rounded bg-muted animate-pulse" />
      </div>
      <div className="h-40 rounded-xl bg-muted animate-pulse" />
      <div className="h-2 rounded-full bg-muted animate-pulse" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border bg-card p-3">
            <div className="h-5 w-5 rounded bg-muted animate-pulse" />
            <div className="h-4 flex-1 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
