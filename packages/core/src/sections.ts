// HOUP-74: the app's section registry, moved into @homeup/core from
// apps/web/src/lib/sections.ts (HOUP-67 was supposed to land this but only
// the token module made it). Icons are stored as a platform-neutral
// `iconId` (kebab-case lucide icon name) instead of a live component
// reference, so this module carries zero `lucide-react`/`lucide-react-native`
// dependency — each platform resolves `iconId -> its own icon component`
// via its own `section-icons.ts` (see apps/web and apps/mobile).

import { isModuleId, isSectionEnabled } from './modules';

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

const homeSearchNavItems: NavItem[] = [
  { href: "/apartment/new", label: "Add Listing", iconId: "plus-circle", accent: true },
  { href: "/apartment/bulk", label: "Bulk Upload", iconId: "list-plus" },
  { href: "/homesearch", label: "Overview", iconId: "layout-dashboard" },
  { href: "/map", label: "Map View", iconId: "map" },
  { href: "/appointments", label: "Appointments", iconId: "clipboard-list" },
  { href: "/checklist", label: "Apartment Checklist", iconId: "clipboard-check" },
];

const calendarNavItems: NavItem[] = [
  { href: "/calendar", label: "Calendar", iconId: "calendar-days", accent: true },
];

const homeSetupNavItems: NavItem[] = [
  { href: "/setup", label: "Rooms & Checklist", iconId: "hammer", accent: true },
];

const householdNavItems: NavItem[] = [
  { href: "/tasks", label: "Tasks & Reminders", iconId: "list-checks", accent: true, badge: "overdueTasks" },
];

const costsNavItems: NavItem[] = [
  { href: "/costs", label: "Overview", iconId: "wallet", accent: true },
];

const groceriesNavItems: NavItem[] = [
  { href: "/groceries", label: "Shopping List", iconId: "shopping-cart", accent: true },
  { href: "/groceries/shelf-life", label: "Item Library", iconId: "book-open" },
];

const checklistsNavItems: NavItem[] = [
  { href: "/checklists", label: "All checklists", iconId: "list-todo", accent: true },
  { href: "/checklists/templates", label: "Templates", iconId: "layout-template" },
];

const recipesNavItems: NavItem[] = [
  { href: "/recipes", label: "All recipes", iconId: "chef-hat", accent: true },
];

const shopperNavItems: NavItem[] = [
  { href: "/shopper", label: "Watching", iconId: "shopping-bag", accent: true },
];

const rewardsNavItems: NavItem[] = [
  { href: "/rewards", label: "Cards", iconId: "wallet-cards", accent: true },
];

const assistantNavItems: NavItem[] = [
  { href: "/assistant", label: "Chats", iconId: "sparkles", accent: true },
];

const documentsNavItems: NavItem[] = [
  { href: "/documents", label: "All Documents", iconId: "folder-open", accent: true },
];

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
  {
    id: "calendar",
    label: "Calendar",
    shortLabel: "Calendar",
    iconId: "calendar-days",
    basePath: "/calendar",
    enabled: true,
    acceptsShares: true,
    navItems: calendarNavItems,
  },
  {
    id: "setup",
    label: "Home Setup",
    shortLabel: "Setup",
    iconId: "home",
    basePath: "/setup",
    enabled: true,
    acceptsShares: true,
    navItems: homeSetupNavItems,
  },
  {
    id: "household",
    label: "Tasks",
    shortLabel: "Tasks",
    iconId: "list-checks",
    basePath: "/tasks",
    enabled: true,
    acceptsShares: true,
    navItems: householdNavItems,
  },
  {
    id: "costs",
    label: "Costs & Budget",
    shortLabel: "Costs",
    iconId: "wallet",
    basePath: "/costs",
    enabled: true,
    acceptsShares: false,
    navItems: costsNavItems,
  },
  {
    id: "search",
    label: "Home Search",
    shortLabel: "Search",
    iconId: "layout-dashboard",
    basePath: "/homesearch",
    enabled: true,
    acceptsShares: true,
    navItems: homeSearchNavItems,
  },
  {
    id: "groceries",
    label: "Groceries",
    shortLabel: "Groceries",
    iconId: "shopping-cart",
    basePath: "/groceries",
    enabled: true,
    acceptsShares: true,
    navItems: groceriesNavItems,
  },
  {
    id: "checklists",
    label: "Checklists",
    shortLabel: "Lists",
    iconId: "list-todo",
    basePath: "/checklists",
    enabled: true,
    acceptsShares: false,
    navItems: checklistsNavItems,
  },
  {
    id: "recipes",
    label: "Recipes",
    shortLabel: "Recipes",
    iconId: "chef-hat",
    basePath: "/recipes",
    enabled: true,
    acceptsShares: false,
    navItems: recipesNavItems,
  },
  {
    id: "shopper",
    label: "Shopper",
    shortLabel: "Shopper",
    iconId: "shopping-bag",
    basePath: "/shopper",
    enabled: true,
    acceptsShares: false,
    navItems: shopperNavItems,
  },
  {
    id: "rewards",
    label: "Rewards",
    shortLabel: "Rewards",
    iconId: "wallet-cards",
    basePath: "/rewards",
    enabled: true,
    acceptsShares: false,
    navItems: rewardsNavItems,
  },
  {
    id: "assistant",
    label: "Assistant",
    shortLabel: "Assistant",
    iconId: "sparkles",
    basePath: "/assistant",
    enabled: true,
    acceptsShares: false,
    navItems: assistantNavItems,
  },
  {
    id: "documents",
    label: "Documents",
    shortLabel: "Docs",
    iconId: "folder-open",
    basePath: "/documents",
    enabled: true,
    acceptsShares: false,
    navItems: documentsNavItems,
  },
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
  if (matchesBase(pathname, "/home")) {
    const hubSection = getSection("home");
    if (hubSection) return hubSection;
  }
  if (matchesBase(pathname, "/calendar")) {
    const calendarSection = getSection("calendar");
    if (calendarSection) return calendarSection;
  }
  if (matchesBase(pathname, "/setup")) {
    const setupSection = getSection("setup");
    if (setupSection) return setupSection;
  }
  if (matchesBase(pathname, "/tasks")) {
    const householdSection = getSection("household");
    if (householdSection) return householdSection;
  }
  if (matchesBase(pathname, "/costs")) {
    const costsSection = getSection("costs");
    if (costsSection) return costsSection;
  }
  if (matchesBase(pathname, "/groceries")) {
    const groceriesSection = getSection("groceries");
    if (groceriesSection) return groceriesSection;
  }
  // "/checklist" (singular, apartment scoring) does NOT start with "/checklists"
  // (it's the shorter string), so it correctly falls through to the Home Search
  // default below regardless of branch order.
  if (matchesBase(pathname, "/checklists")) {
    const checklistsSection = getSection("checklists");
    if (checklistsSection) return checklistsSection;
  }
  if (matchesBase(pathname, "/recipes")) {
    const recipesSection = getSection("recipes");
    if (recipesSection) return recipesSection;
  }
  if (matchesBase(pathname, "/shopper")) {
    const shopperSection = getSection("shopper");
    if (shopperSection) return shopperSection;
  }
  if (matchesBase(pathname, "/rewards")) {
    const rewardsSection = getSection("rewards");
    if (rewardsSection) return rewardsSection;
  }
  if (matchesBase(pathname, "/assistant")) {
    const assistantSection = getSection("assistant");
    if (assistantSection) return assistantSection;
  }
  if (matchesBase(pathname, "/documents")) {
    const documentsSection = getSection("documents");
    if (documentsSection) return documentsSection;
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
  for (const section of sections) {
    if (!isModuleId(section.id)) continue;
    const bases = [section.basePath, ...section.navItems.map((n) => n.href)].map(
      (href) => `/${href.split('/').filter(Boolean)[0] ?? ''}`
    );
    if (bases.some((base) => base !== '/' && matchesBase(pathname, base))) return section.id;
  }
  return null;
}
