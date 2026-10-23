'use client';

// ── FLUX-155: shared primitives for the /home hub dashboard ─────────────────────
//
// Small, hub-local building blocks so the tiles stay consistent and the page file
// stays readable:
//   - HUB tunables (single source for thresholds/durations)
//   - AvatarBubble (initials/photo bubble, mirrors setup/assignee-picker)
//   - HubTile / TileHeader (the clickable tile primitive — no generic stat-card
//     exists; dashboard-stats.tsx is bespoke to Home Search)
//   - HeroItem + buildHeroItems (converge tasks/reminders/appointments for the
//     Today hero AND the urgent banner — one derivation, two consumers)

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import {
  pad2,
  currentHHMM,
  formatTime12h,
  localDateISO,
  parseLocalISODate,
  heroRangeWindow,
  buildHeroItems,
  GROCERY_SUGGEST_CAP,
  type HeroRange,
  type HeroItemType,
  type HeroItem,
} from '@homeup/core';
import { LeadingTile } from '@/components/ui/leading-tile';
import { memberLabel, memberAvatar } from '@/app/setup/member-label';

// HOUP-77: buildHeroItems + HeroItem/HeroRange derivation now live in
// @homeup/core (packages/core/src/hero.ts) so apps/mobile can build the same
// "what's on today" feed from the same rules. Re-exported here so every
// existing importer of this module keeps working unchanged.
export { pad2, currentHHMM, formatTime12h, localDateISO, parseLocalISODate, heroRangeWindow, buildHeroItems };
export type { HeroRange, HeroItemType, HeroItem };

// Single source of truth for every hub tunable (FLUX-155 plan "Tunables").
export const HUB = {
  /** Max "suggest re-add" rows shown on the hub grocery card (FLUX-207) — kept tight so the card stays compact. */
  GROCERY_SUGGEST_CAP,
  /** How long a just-marked 'have' row lingers before fading out of the hub list. */
  HAVE_LINGER_MS: 10_000,
} as const;

export type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

// ── Avatar bubble ───────────────────────────────────────────────────────────────
// Mirrors the initials-bubble in src/app/setup/assignee-picker.tsx so the hero rows
// and the Mine chip render the same avatar the rest of the app does.
export function AvatarBubble({
  userId,
  profiles,
  size = 22,
}: {
  userId: string | null;
  profiles: MemberProfiles;
  size?: number;
}) {
  const name = memberLabel(userId, profiles);
  const avatar = memberAvatar(userId, profiles);
  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar}
        alt={name}
        title={name}
        referrerPolicy="no-referrer"
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      title={name}
      className="rounded-full bg-muted flex items-center justify-center font-bold text-foreground uppercase shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {name.charAt(0)}
    </span>
  );
}

// ── Hub tile primitive ───────────────────────────────────────────────────────────
// The whole card is a navigation surface (keyboard-accessible). Interactive children
// MUST call e.stopPropagation() so an in-tile action never triggers navigation
// (FLUX-155 cross-cutting rule). Groceries overrides onActivate (expand vs navigate).
export function HubTile({
  href,
  onActivate,
  className = '',
  ariaLabel,
  children,
}: {
  href?: string;
  onActivate?: () => void;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const go = () => {
    if (onActivate) onActivate();
    else if (href) router.push(href);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      }}
      className={`group relative flex flex-col rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)] transition-colors hover:border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer ${className}`}
    >
      {children}
    </div>
  );
}

// Hearth v2: a Spaces tile leads with its section's identity tile
// (section-hues.ts), the same tile its rows wear in the feed.
export function TileHeader({
  sectionId,
  Icon,
  title,
  right,
}: {
  sectionId: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <LeadingTile sectionId={sectionId} Icon={Icon} size="md" />
      <h2 className="font-heading text-base font-semibold text-foreground">{title}</h2>
      <div className="ml-auto flex items-center gap-2">
        {right}
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>
    </div>
  );
}

// Stop a click from bubbling to the enclosing HubTile (navigation). Spread onto any
// interactive wrapper inside a tile.
export const stopNav = { onClick: (e: React.MouseEvent) => e.stopPropagation() };

// ── Long-press gesture ───────────────────────────────────────────────────────────
// FLUX-198: centralized at src/hooks/use-long-press.ts (with LONG_PRESS_MS /
// HOLD_FILL_DELAY_MS) — every hold-to-edit surface imports it from there now.

// ── Time / date helpers ───────────────────────────────────────────────────────────
// pad2/localDateISO/parseLocalISODate/heroRangeWindow/buildHeroItems/HeroItem/
// HeroRange moved to @homeup/core (HOUP-77) — re-exported above.

