// Mirrors a settings panel (SettingsPanel): a rounded-3xl card with a 36px
// glyph tile + title line, then an inset group of rows. No page-title bar:
// settings pages have none.
export default function SettingsLoading() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8" aria-busy="true" aria-label="Loading settings">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="space-y-4 rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)] sm:p-5">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-[11px] bg-muted animate-pulse" />
            <div className="h-4 w-36 rounded bg-muted animate-pulse" />
          </div>
          <div className="divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/30">
            {Array.from({ length: i === 0 ? 4 : 2 }).map((__, j) => (
              <div key={j} className="flex items-center gap-3 px-3.5 py-4">
                <div className="h-4 flex-1 rounded bg-muted animate-pulse" />
                <div className="h-5 w-9 rounded-full bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </main>
  );
}
