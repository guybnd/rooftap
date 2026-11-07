"use client";

// Hearth §13.12: the Settings lede. The household's name and how many
// modules it runs, then its people as faces and first names with Invite.
// It opens Users. Native twin: HouseholdHeader in
// apps/mobile/src/app/settings/index.tsx.
import Link from "next/link";
import { firstName, householdPeopleLine, useModules } from "@homeup/core";
import { useDataCache } from "@/lib/data-cache";
import { AvatarBubble } from "@/app/home/hub-shared";

export function HouseholdHeader() {
  const { group, groupMembers, memberProfiles, currentUserId } = useDataCache();
  const modules = useModules();
  if (!group) return null;
  const others = groupMembers.filter((m) => m.user_id !== currentUserId);
  const faces = [currentUserId, ...others.map((m) => m.user_id)].filter((id): id is string => !!id).slice(0, 4);
  const line = householdPeopleLine(others.map((m) => firstName(memberProfiles[m.user_id]?.name, memberProfiles[m.user_id]?.email)));
  return (
    <Link
      href="/settings/users"
      aria-label={`${group.name}. ${line}. Open people and invites`}
      className="block space-y-3 rounded-2xl border border-border bg-card px-4 py-4 transition-colors hover:bg-accent/40"
    >
      <div className="space-y-0.5">
        <p className="truncate font-heading text-lg font-semibold">{group.name}</p>
        <p className="text-xs text-muted-foreground">
          {modules.enabled.size} module{modules.enabled.size === 1 ? "" : "s"} on
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          {faces.map((id) => (
            <span key={id} className="rounded-full ring-2 ring-card">
              <AvatarBubble userId={id} profiles={memberProfiles} size={28} />
            </span>
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate text-sm">{line}</span>
        <span className="text-sm font-medium text-primary">Invite</span>
      </div>
    </Link>
  );
}
