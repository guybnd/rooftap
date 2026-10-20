"use client";

// HOUP-327: web's parallel-kit Switch, lifted from the summary-hero customize
// sheet's page-local `HeroModuleToggle` (apps/web/src/app/home/hero-customize-sheet.tsx)
// — apps/web does not consume @homeup/ui in component code, so this is web's
// own copy of the same primitive (packages/ui/src/components/switch.tsx is
// the universal one for apps/mobile).

import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted-foreground/30",
        className,
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
