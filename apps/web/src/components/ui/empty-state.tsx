"use client";

// Hearth §11 empty state, the web twin of packages/ui's EmptyState: centered
// on the ground, the icon in the section's tile, one headline, one short
// description, at most one CTA, plus an optional quiet text link that never
// competes with it. With first steps (children) it becomes the left-aligned
// "Try" layout of Hearth §13.9.
import type { ComponentType, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getSectionByPath } from "@homeup/core";
import { cn } from "@/lib/utils";
import { LeadingTile } from "@/components/ui/leading-tile";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  /** Rendered before the label, e.g. `<Plus className="h-4 w-4" />`. */
  icon?: ReactNode;
  disabled?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  sectionId,
  children,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /** The section whose hue the tile wears. Defaults to the page's own. */
  sectionId?: string;
  /** First steps under the words (the app's "Try" group); the state then takes no CTA of its own. */
  children?: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const section = sectionId ?? getSectionByPath(pathname ?? "/").id;
  if (children) {
    return (
      <div className={cn("space-y-4 pt-2", className)}>
        <div className="space-y-2 px-0.5">
          <LeadingTile sectionId={section} Icon={Icon} size="lg" />
          <h2 className="font-heading text-2xl font-bold leading-tight text-foreground">{title}</h2>
          <p className="max-w-prose text-sm leading-snug text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      {/* Hearth §13.9: the tile wears the section's hue; coral stays on what you click. */}
      <LeadingTile sectionId={section} Icon={Icon} size="xl" />
      <div className="space-y-1">
        <h2 className="font-heading text-base font-semibold text-foreground">{title}</h2>
        <p className="mx-auto max-w-[280px] text-sm text-muted-foreground">{description}</p>
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className="mt-1 inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50 sm:h-9"
        >
          {action.icon}
          {action.label}
        </button>
      )}
      {secondaryAction && (
        <button
          type="button"
          onClick={secondaryAction.onClick}
          disabled={secondaryAction.disabled}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80 disabled:opacity-50 sm:min-h-9"
        >
          {secondaryAction.icon}
          {secondaryAction.label}
        </button>
      )}
    </div>
  );
}
