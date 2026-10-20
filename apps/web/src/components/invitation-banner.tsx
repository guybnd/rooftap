"use client";

import Link from "next/link";
import { useDataCache } from "@/lib/data-cache";
import { MailIcon } from "lucide-react";

export function InvitationBanner() {
  const { pendingInvitations } = useDataCache();

  if (pendingInvitations.length === 0) return null;

  const inv = pendingInvitations[0];
  const groupName = inv.group_name ?? "a group";

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
      <MailIcon className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1">
        You&apos;ve been invited to join <strong>{groupName}</strong>
        {pendingInvitations.length > 1 && (
          <span className="text-muted-foreground"> (+{pendingInvitations.length - 1} more)</span>
        )}
      </span>
      <Link
        href="/settings"
        className="shrink-0 text-xs font-medium text-primary hover:underline"
      >
        View in Settings
      </Link>
    </div>
  );
}
