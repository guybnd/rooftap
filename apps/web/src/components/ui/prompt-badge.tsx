// Something waits on you: the assistant proposed a change and needs your OK
// (Guy, 2026-10-22). A small warning-hue badge with the count, worn by the
// Assistant's top bar icon and the chat's Chats button. Overdue tasks keep
// their red count; this one asks rather than warns, so it pulses once on
// arrival and then sits still.
import { cn } from "@/lib/utils";

export function PromptBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "prompt-badge pointer-events-none absolute inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[9px] font-bold leading-none text-warning-foreground tabular-nums ring-2 ring-background",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
