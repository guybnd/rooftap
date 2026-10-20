export default function CalendarLoading() {
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-full mx-auto flex flex-col h-full min-h-[calc(100vh-3.5rem)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div className="space-y-2">
          <div className="h-7 w-32 rounded bg-muted animate-pulse" />
          <div className="h-4 w-56 rounded bg-muted animate-pulse hidden md:block" />
        </div>
        <div className="h-9 w-40 rounded-lg bg-muted animate-pulse" />
      </div>
      <div className="flex-1 rounded-xl border bg-muted animate-pulse" />
    </div>
  );
}
