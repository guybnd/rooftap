"use client";

import { useDataCache } from "@/lib/data-cache";
import { ChecklistPanel } from "@/components/checklist-panel";

export default function ChecklistPage() {
  const { group, loading } = useDataCache();

  if (loading) {
    return (
      <main className="p-4 sm:p-8 max-w-4xl mx-auto">
        <div className="space-y-4 animate-pulse">
          <div className="h-8 w-48 rounded-lg bg-muted" />
          <div className="h-4 w-72 rounded bg-muted" />
          <div className="h-64 rounded-xl bg-muted/50" />
        </div>
      </main>
    );
  }

  if (!group) {
    return (
      <main className="p-4 sm:p-8 max-w-4xl mx-auto">
        <p className="text-muted-foreground text-sm">No group found. Create one in Settings.</p>
      </main>
    );
  }

  return (
    <main className="p-4 sm:p-8 max-w-4xl mx-auto">
      <ChecklistPanel groupId={group.id} />
    </main>
  );
}
