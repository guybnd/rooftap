export default function MapLoading() {
  return (
    <main className="p-4 sm:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="h-9 w-36 rounded-lg bg-muted animate-pulse" />
        <div className="h-5 w-80 rounded-md bg-muted animate-pulse mt-2" />
      </div>
      <div className="h-[500px] rounded-xl border bg-muted animate-pulse" />
    </main>
  );
}
