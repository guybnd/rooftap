// Hearth v2 (H2): a cost's category reads by its glyph in a neutral chip, the
// same chip native's cost row leads with (apps/mobile/src/features/costs/
// cost-card.tsx). Category hues stay in the chart and its breakdown, where
// they key a series; on rows and menus they were decoration that borrowed the
// status hues (amber, green, rose).
import {
  ArrowDownLeft,
  Banknote,
  Car,
  HeartPulse,
  PawPrint,
  Users,
  Ellipsis,
  Repeat,
  ShieldCheck,
  ShoppingBag,
  Ticket,
  ShoppingCart,
  Truck,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { CATEGORY_COLOR, type CostCategory } from '@homeup/core';
import { cn } from '@/lib/utils';

export const CATEGORY_ICON: Record<CostCategory, LucideIcon> = {
  rent: Banknote,
  utilities: Zap,
  internet: Wifi,
  insurance: ShieldCheck,
  subscription: Repeat,
  grocery_estimate: ShoppingCart,
  moving: Truck,
  purchase: ShoppingBag,
  outing: Ticket,
  transport: Car,
  health: HeartPulse,
  pets: PawPrint,
  family: Users,
  other: Ellipsis,
  income: ArrowDownLeft,
};

export function CategoryGlyph({ category, className }: { category: CostCategory; className?: string }) {
  const Icon = CATEGORY_ICON[category] ?? Ellipsis;
  return (
    <span
      aria-hidden
      className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-[9px]', CATEGORY_COLOR[category]?.tile ?? 'bg-muted text-muted-foreground', className)}
    >
      <Icon className="size-[15px]" strokeWidth={2} />
    </span>
  );
}
