// HOUP-74: the app's section registry, moved into @homeup/core from
// apps/web/src/lib/sections.ts (HOUP-67 was supposed to land this but only
// the token module made it). Icons are stored as a platform-neutral
// `iconId` (kebab-case lucide icon name) instead of a live component
// reference, so this module carries zero `lucide-react`/`lucide-react-native`
// dependency — each platform resolves `iconId -> its own icon component`
// via its own `section-icons.ts` (see apps/web and apps/mobile).

import { isModuleId, isSectionEnabled } from './modules';
import { ALL_MANIFESTS } from './module-manifests';

export interface NavItem {
  href: string;
  label: string;
  iconId: string;
  accent?: boolean;
  /** Dynamic badge to render on this item (resolved by the sidebar). */
  badge?: "overdueTasks";
}

export interface Section {
  id: string;
  label: string;
  /** Compact label for tight switcher surfaces (tiles, tab bar). */
  shortLabel: string;
  iconId: string;
  basePath: string;
  enabled: boolean;
  acceptsShares: boolean;
  navItems: NavItem[];
}

const hubNavItems: NavItem[] = [
  { href: "/home", label: "Overview", iconId: "layout-grid", accent: true },
];

/**
 * Where the existing sections sit in the switcher, after Home. A module's
 * section comes from its manifest (modules/<id>/manifest.ts); one missing
 * from this list goes after these, in manifest order, so a new module needs
 * no edit here.
 */
const SECTION_ORDER: readonly string[] = [
  "calendar",
  "setup",
  "household",
  "costs",
  "search",
  "groceries",
  "checklists",
  "recipes",
  "shopper",
  "rewards",
  "occasions",
  "bins",
  "assistant",
  "documents",
];

function rankSection(id: string): number {
  const i = SECTION_ORDER.indexOf(id);
  return i === -1 ? SECTION_ORDER.length : i;
}

const moduleSections: Section[] = ALL_MANIFESTS.flatMap((m): Section[] => {
  const s = m.section;
  if (!s) return [];
  return [
    {
      id: m.id,
      label: s.label,
      shortLabel: s.shortLabel,
      iconId: s.iconId ?? m.iconId,
      basePath: s.basePath,
      enabled: true,
      acceptsShares: s.acceptsShares,
      navItems: s.navItems.map((n) => ({ ...n })),
    },
  ];
}).sort((x, y) => rankSection(x.id) - rankSection(y.id));

export const sections: Section[] = [
  {
    id: "home",
    label: "Home",
    shortLabel: "Home",
    iconId: "layout-grid",
    basePath: "/home",
    enabled: true,
    // The hub is a personal cross-section overview, not a share target.
    acceptsShares: false,
    navItems: hubNavItems,
  },
  ...moduleSections,
];

/**
 * The phone's tab routes: every section's base path, then the nav items that
 * are tabs of their own (a manifest's `section.tabRoutes`). The phone's
 * src/app/(tabs) folder holds exactly these (tab-routes.test.ts).
 */
export const SECTION_TAB_ROUTES: readonly string[] = [
  ...sections.map((s) => s.basePath),
  ...ALL_MANIFESTS.flatMap((m) => m.section?.tabRoutes ?? []),
];

/**
 * The Settings/Profile area is its own context — NOT one of the switchable app
 * sections. It deliberately lives outside the `sections` array so it never shows
 * up in the switcher (desktop grid + mobile tab bar) or in `getEnabledSections`,
 * yet `getSectionByPath` can resolve `/settings*` to it so the app chrome reads
 * "Settings" (what the sidebar and More menu call it) instead of falsely
 * highlighting Home Search.
 */
export const profileSection: Section = {
  id: "profile",
  label: "Settings",
  shortLabel: "Settings",
  iconId: "user-cog",
  basePath: "/settings",
  enabled: true,
  acceptsShares: false,
  navItems: [],
};

export function getSection(sectionId: string): Section | undefined {
  return sections.find((s) => s.id === sectionId);
}

// Segment-boundary match: "/home" must match "/home" or "/home/foo", but not
// "/homesearch" — a raw startsWith prefix check would wrongly claim it. Mirrors
// the fix HOUP-75 applied to apps/mobile/src/components/nav/primary-tab-bar.tsx.
function matchesBase(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function getSectionByPath(pathname: string): Section {
  // The bare root is the cold-boot redirect target (src/app/page.tsx) — it has no
  // section of its own, so resolve it to Home directly rather than falling through
  // to the Home Search default below, which used to make the sidebar/tab bar flash
  // Home Search as active for the instant the URL is still "/" before the redirect fires.
  if (pathname === "/") {
    return getSection("home") || sections[0];
  }
  // The share sheet and the offline fallback span every section; they read
  // as Home (its title and glow), not as the Home Search default.
  if (matchesBase(pathname, "/share-target") || matchesBase(pathname, "/~offline")) {
    return getSection("home") || sections[0];
  }
  // Settings is its own standalone context, not nested under any app section.
  if (matchesBase(pathname, "/settings")) {
    return profileSection;
  }
  // Each section owns its base path. Home Search's listing routes (/apartment,
  // /map, /checklist...) have no base of their own and land on the default.
  for (const section of sections) {
    if (matchesBase(pathname, section.basePath)) return section;
  }
  // Default to Home Search
  return getSection("search") || sections[0];
}

/**
 * Sections to show. Pass the household's enabled modules (useModules().enabled)
 * so a switched-off module's section disappears; without it, every section
 * that ships is returned (for callers outside a household, e.g. tests).
 */
export function getEnabledSections(enabledModules?: ReadonlySet<string>): Section[] {
  return sections.filter(
    (s) => s.enabled && (!enabledModules || isSectionEnabled(s.id, enabledModules))
  );
}

/**
 * FLUX-165: apply a saved per-user section order (an array of section ids) to a
 * list of sections. Sections present in `order` come first, in that order;
 * sections absent from it (e.g. a newly shipped section a stale saved order
 * doesn't know about) keep their declaration order and are appended at the end,
 * so they are never dropped. An empty order is a no-op (declaration order).
 * The sort is stable, so two unknown sections preserve their relative order.
 */
export function orderSections<T extends { id: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return items;
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return [...items].sort((a, b) => rank(a.id) - rank(b.id));
}

/**
 * The phone tab bar's split (web SectionTabBar, native PrimaryTabBar): a fixed
 * 2 + capture + 2 layout. Exactly 4 visible sections all sit in the bar (a
 * one-row More sheet would be pointless); otherwise the first 3 do and the
 * rest live under More.
 */
export function splitTabBar<T>(visible: T[]): { primary: T[]; overflow: T[] } {
  const primaryCount = visible.length === 4 ? 4 : 3;
  return { primary: visible.slice(0, primaryCount), overflow: visible.slice(primaryCount) };
}

/**
 * Long-press a tab to choose what sits in its slot: `chosenId` takes the
 * slot `slotId` holds by swapping the two in the saved order (`order` is the
 * full ordered id list, as orderSections() resolved it), so whatever held the
 * slot moves to where the chosen section was. A hidden choice is shown again,
 * since a hidden section has no slot. Choosing what's already there is a no-op.
 */
export function assignTabSlot(
  order: string[],
  hidden: string[],
  slotId: string,
  chosenId: string
): { order: string[]; hidden: string[] } {
  const from = order.indexOf(slotId);
  const to = order.indexOf(chosenId);
  if (slotId === chosenId || from === -1 || to === -1) return { order, hidden };
  const next = [...order];
  next[from] = chosenId;
  next[to] = slotId;
  return { order: next, hidden: hidden.filter((id) => id !== chosenId) };
}

/**
 * The module that owns a route, or null for platform routes (home, settings,
 * auth, share target, admin). Unlike getSectionByPath this never falls back to
 * Home Search: only the top-level path segments a module's own section and nav
 * items live under count, so a route guard can't bounce someone off /admin.
 */
export function getModuleIdForPath(pathname: string): string | null {
  for (const [segment, id] of Object.entries(moduleRouteSegments())) {
    if (matchesBase(pathname, `/${segment}`)) return id;
  }
  return null;
}

/**
 * Top-level route segment -> the module that owns it: each module section's
 * base path and nav items ("apartment" -> "search"). The apps' route tests
 * check every top-level route folder is one of these or a platform route.
 */
export function moduleRouteSegments(): Record<string, string> {
  const owners: Record<string, string> = {};
  for (const section of sections) {
    if (!isModuleId(section.id)) continue;
    for (const href of [section.basePath, ...section.navItems.map((n) => n.href)]) {
      const segment = href.split('/').filter(Boolean)[0];
      if (segment && !(segment in owners)) owners[segment] = section.id;
    }
  }
  return owners;
}
