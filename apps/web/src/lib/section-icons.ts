import {
  Bot,
  Lightbulb,
  Wrench,
  CalendarSync,
  LayoutDashboard,
  LayoutGrid,
  Map,
  PlusCircle,
  ListPlus,
  CalendarDays,
  ClipboardList,
  ClipboardCheck,
  Home,
  Hammer,
  ListChecks,
  Wallet,
  ShoppingCart,
  ShoppingBag,
  WalletCards,
  Gift,
  Sparkles,
  BookOpen,
  FolderOpen,
  UserCog,
  ListTodo,
  LayoutTemplate,
  ChefHat,
  Trash2,
} from "lucide-react";
import { getSection, profileSection } from "@homeup/core";

export type IconComponent = React.ComponentType<{ className?: string }>;

// HOUP-74: iconId -> lucide-react component, mirroring the icon choices in
// packages/core/src/sections.ts. Keyed by the section/NavItem's
// platform-neutral `iconId`, covering all 19 iconIds used across sections
// and their nav items.
export const sectionIcons: Record<string, IconComponent> = {
  "layout-grid": LayoutGrid,
  "calendar-days": CalendarDays,
  home: Home,
  "list-checks": ListChecks,
  wallet: Wallet,
  "layout-dashboard": LayoutDashboard,
  "shopping-cart": ShoppingCart,
  "shopping-bag": ShoppingBag,
  "wallet-cards": WalletCards,
  gift: Gift,
  "trash-2": Trash2,
  sparkles: Sparkles,
  "list-todo": ListTodo,
  "chef-hat": ChefHat,
  "folder-open": FolderOpen,
  "user-cog": UserCog,
  "plus-circle": PlusCircle,
  "list-plus": ListPlus,
  map: Map,
  "clipboard-list": ClipboardList,
  "clipboard-check": ClipboardCheck,
  hammer: Hammer,
  "book-open": BookOpen,
  "layout-template": LayoutTemplate,
  // Integration modules (Settings > Modules only; they have no section).
  "calendar-sync": CalendarSync,
  bot: Bot,
  lightbulb: Lightbulb,
  wrench: Wrench,
};

/** A section's own glyph (its sections.ts iconId), for leading tiles. */
export function sectionIconFor(sectionId: string): IconComponent {
  const section = getSection(sectionId) ?? (sectionId === profileSection.id ? profileSection : undefined);
  return (section && sectionIcons[section.iconId]) ?? LayoutGrid;
}
