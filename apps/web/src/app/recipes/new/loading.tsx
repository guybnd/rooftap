export default function RecipeNewLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-6 w-32 rounded bg-muted animate-pulse" />
          <div className="h-6 w-6 rounded bg-muted animate-pulse" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-16 rounded bg-muted animate-pulse" />
              <div className="h-10 rounded-lg border bg-muted animate-pulse" />
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-2">
          <div className="h-10 flex-1 rounded-lg bg-muted animate-pulse" />
          <div className="h-10 flex-1 rounded-lg bg-muted animate-pulse" />
        </div>
      </div>
    </div>
  );
}
