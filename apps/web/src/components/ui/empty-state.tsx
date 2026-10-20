// Hearth §11 empty state, the web twin of packages/ui's EmptyState: centered
// on the ground, the icon in a rounded-2xl bg-primary/10 p-5 tile, one
// headline, one short description, at most one CTA, plus an optional quiet
// text link that never competes with it.
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

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
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <div className="rounded-2xl bg-primary/10 p-5">
        <Icon className="h-7 w-7 text-primary" />
      </div>
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
