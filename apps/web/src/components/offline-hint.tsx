"use client";

import { WifiOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared copy for every online-only surface disabled while offline (maps,
// listing scrape, push, group invites, image/recipe-scan uploads) so the
// affordance reads consistently instead of five bespoke strings.
export const OFFLINE_REASON = "Requires connection";

export function OfflineHint({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <WifiOffIcon className="h-3 w-3 shrink-0" />
      {OFFLINE_REASON}
    </span>
  );
}
