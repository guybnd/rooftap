'use client';

// The way into a module helper's chat (core module-helpers.ts) from its
// module's screen: the Rooftap mark in the screen's head, with a dot while
// the helper's brief has something to add or put back. It opens the pop-up
// chat on the helper. Hidden while the Assistant is off or the server is too
// old for helper chats. Native twin: apps/mobile/src/components/helper-button.tsx.
import { briefCount, helperAvailable, moduleHelper, openAssistantPopup, useHelperBrief, useModules } from "@homeup/core";
import { useRouter } from "next/navigation";
import { RooftapTile } from "@/components/brand/rooftap-mark";
import { useDataCache } from "@/lib/data-cache";
import { cn } from "@/lib/utils";

export function HelperButton({ module, className }: { module: string; className?: string }) {
  const router = useRouter();
  const modules = useModules();
  const { group, currentUserId } = useDataCache();
  const on = helperAvailable(module, (id) => modules.isEnabled(id)) && modules.server("assistant.helpers");
  const state = useHelperBrief({ helper: on ? module : null, groupId: group?.id, currentUserId });
  const helper = moduleHelper(module);
  if (!on || !helper) return null;
  const count = briefCount(state?.brief);
  return (
    <button
      type="button"
      onClick={() => openAssistantPopup({ helper: module }) || router.push("/assistant")}
      aria-label={count > 0 ? `${helper.label}, ${count} to look at` : helper.label}
      title={helper.label}
      className={cn(
        "relative grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
        className
      )}
    >
      <RooftapTile size="sm" />
      {count > 0 && <span aria-hidden className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-primary ring-2 ring-background" />}
    </button>
  );
}
