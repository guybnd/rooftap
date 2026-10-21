// HOUP-74: id -> lucide-react-native icon map, mirroring the icon choices in
// packages/core/src/sections.ts. Keyed by the section's platform-neutral
// `iconId` (not the section id) so this map also covers NavItem icons, which
// have no section id of their own.
import {
  BookOpen,
  Bot,
  CalendarDays,
  CalendarSync,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  FolderOpen,
  Hammer,
  Home,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  ListChecks,
  ListPlus,
  ListTodo,
  Map,
  PlusCircle,
  ShoppingBag,
  WalletCards,
  ShoppingCart,
  Sparkles,
  UserCog,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';
import { getSection, profileSection } from '@homeup/core';

// HOUP-142: filled out to match apps/web/src/lib/section-icons.ts's full
// 19-iconId set — this map previously only covered section-level icons, so
// every NavItem row (never rendered until HOUP-142) had no icon to resolve.
export const sectionIcons: Record<string, LucideIcon> = {
  'layout-grid': LayoutGrid,
  'calendar-days': CalendarDays,
  home: Home,
  'list-checks': ListChecks,
  wallet: Wallet,
  'layout-dashboard': LayoutDashboard,
  'shopping-cart': ShoppingCart,
  'shopping-bag': ShoppingBag,
  'wallet-cards': WalletCards,
  sparkles: Sparkles,
  'list-todo': ListTodo,
  'chef-hat': ChefHat,
  'folder-open': FolderOpen,
  'user-cog': UserCog,
  'plus-circle': PlusCircle,
  'list-plus': ListPlus,
  map: Map,
  'clipboard-list': ClipboardList,
  'clipboard-check': ClipboardCheck,
  hammer: Hammer,
  'book-open': BookOpen,
  'layout-template': LayoutTemplate,
  // Integration modules (Settings > Modules only; they have no section).
  'calendar-sync': CalendarSync,
  bot: Bot,
};

/** A section's own glyph (its sections.ts iconId), for leading tiles. */
export function sectionIconFor(sectionId: string): LucideIcon {
  const section = getSection(sectionId) ?? (sectionId === profileSection.id ? profileSection : undefined);
  return (section && sectionIcons[section.iconId]) ?? LayoutGrid;
}
