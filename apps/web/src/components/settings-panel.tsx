"use client";

// Hearth v2 settings panel shell, shared by every Settings panel so they all
// read as one system: one bordered rounded-3xl card per panel (H4), a header
// of a neutral 36px glyph tile + a Title-step name (+ optional trailing
// action), an optional muted description, then the panel body. Inside, rows
// sit on an inset fill (`SettingsInset`), never a second border.
// The glyph tile is deliberately neutral: section identity hues belong to
// LeadingTile + the glow only (H2), and Settings is not a section.
// Native twin: apps/mobile/src/features/settings/panels/settings-panel.tsx.

import * as React from "react";
import { Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type PanelIcon = React.ComponentType<{ className?: string; strokeWidth?: number }>;

export function SettingsPanel({
  icon: Icon,
  title,
  description,
  action,
  className,
  children,
}: {
  icon?: PanelIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned header control (e.g. "Add agent"). */
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "space-y-4 rounded-3xl border border-border/60 bg-card p-4 text-card-foreground shadow-[var(--card-shadow)] sm:p-5",
        className
      )}
    >
      <div className="space-y-2">
        <div className="flex min-h-9 items-center gap-3">
          {Icon && (
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-muted text-muted-foreground"
            >
              <Icon className="size-[18px]" strokeWidth={2.1} />
            </span>
          )}
          <h2 className="flex min-w-0 flex-1 items-center gap-1.5 font-heading text-base font-semibold text-foreground">
            {title}
          </h2>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** H4 inset group: the panel owns the border, rows sit on a fill with hairlines. */
export function SettingsInset({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/30", className)}
      {...props}
    />
  );
}

/** Micro label heading a group inside a panel (T4: >= 10.5px, +0.1em). */
export function SettingsLabel({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground", className)}
      {...props}
    />
  );
}

/** An on/off setting: title + optional caption, the app's Switch trailing. */
export function SettingsSwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-[52px] items-center gap-3 px-3.5 py-3", disabled && "opacity-60", className)}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} />
    </div>
  );
}

/**
 * One choice in a pick-one list (E3: selection = accent check). Used where a
 * segmented control would overflow at phone width.
 */
export function SettingsChoiceRow({
  selected,
  onSelect,
  leading,
  title,
  description,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  leading?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      disabled={disabled}
      className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
    >
      {leading && <span className="flex shrink-0 items-center justify-center text-muted-foreground">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
      <Check
        aria-hidden
        className={cn("size-4 shrink-0 text-primary transition-opacity", selected ? "opacity-100" : "opacity-0")}
      />
    </button>
  );
}

/** The app's own checkbox (multi-select lists): a rounded box, accent when on. */
export function SettingsCheckbox({
  checked,
  onChange,
  disabled,
  children,
  className,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={cn(
        "flex min-h-10 w-full items-center gap-3 px-3.5 py-2 text-left text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-border"
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

/** "Saving…" whisper for debounce-saved fields. */
export function SavingHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="px-1 text-xs text-muted-foreground">Saving…</p>;
}
