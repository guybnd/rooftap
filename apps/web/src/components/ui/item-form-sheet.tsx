"use client";

// FLUX-182: the shared shell every "add / edit an item" modal (grocery, cost,
// to-do, setup) is built on. Replaces four bespoke `fixed inset-0` overlays with
// one consistent, keyboard-aware sheet: a compact bottom sheet on mobile that
// floats above the on-screen keyboard, a centered dialog on desktop.
//
// Behaviour baked in here (so each modal stops re-implementing it):
//   - header (title + optional icon) with a close ✕
//   - a scrollable, grouped body (use <FormSection> / <FieldRow>)
//   - a sticky footer: Cancel / Save, plus Delete in edit mode
//   - Enter submits from single-line inputs (the body is a real <form>; textareas
//     keep their newline behaviour natively)
//   - Escape closes, focus is trapped, background scroll is locked
//     (all three come from base-ui's Dialog)
//   - the keyboard inset (iOS Safari) offsets the sheet up so fields stay visible
//
// Autofocus is left to each modal's first field (`autoFocus`) so the caller
// decides which input is the "first meaningful" one.

import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { LeadingTile } from "@/components/ui/leading-tile";

interface ItemFormSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Small leading glyph/emoji shown before the title. */
  icon?: React.ReactNode;
  /**
   * FLUX-234: replaces the static icon+title header row with a richer live
   * item preview (e.g. emoji/name/status/price). `title` is still required
   * and rendered `sr-only` for accessibility (base-ui's Dialog needs one
   * regardless of what's visually shown).
   */
  previewContent?: React.ReactNode;
  /**
   * Hearth v2 (E1, Feed): the section the item belongs to. The header then
   * leads with that section's identity tile, the same one the item's row
   * wears in lists and the Home feed.
   */
  section?: { id: string; Icon: React.ComponentType<{ className?: string; strokeWidth?: number }> };
  onSubmit: () => void;
  submitLabel?: string;
  /** Save is disabled until this is true (defaults to true). */
  canSubmit?: boolean;
  /** Disables the footer buttons + shows a saving label. */
  saving?: boolean;
  /**
   * When provided, a Delete button is rendered (edit mode). HOUP-191: the
   * footer always confirms before calling this — callers must not layer
   * their own confirm() on top (that would show two dialogs in a row).
   */
  onDelete?: () => void;
  deleteLabel?: string;
  /** Confirm dialog message override. Defaults to `${deleteLabel}? This cannot be undone.` */
  deleteConfirmMessage?: string;
  children: React.ReactNode;
}

export function ItemFormSheet({
  isOpen,
  onClose,
  title,
  icon,
  previewContent,
  section,
  onSubmit,
  submitLabel = "Save",
  canSubmit = true,
  saving = false,
  onDelete,
  deleteLabel = "Delete",
  deleteConfirmMessage,
  children,
}: ItemFormSheetProps) {
  const keyboardInset = useKeyboardInset(isOpen);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || saving) return;
    onSubmit();
  };

  // HOUP-191: destructive confirm lives here, once, instead of every caller
  // hand-rolling (or forgetting) its own confirm() before onDelete.
  const requestDelete = () => {
    if (!onDelete) return;
    if (!window.confirm(deleteConfirmMessage ?? `${deleteLabel}? This cannot be undone.`)) return;
    onDelete();
  };

  return (
    <BottomSheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      overlayClassName="bg-black/40 duration-200"
      // Mobile: full-width bottom sheet, half-ish height, rounded top.
      // Desktop (sm+): a centered, rounded card.
      className={cn(
        "flex-col bg-popover text-popover-foreground shadow-xl",
        "max-h-[88dvh] rounded-t-2xl border-t border-border",
        "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
      )}
      style={
        keyboardInset > 0
          ? { bottom: keyboardInset, maxHeight: `calc(100dvh - ${keyboardInset}px - 1rem)` }
          : undefined
      }
      handleClassName="px-0 py-3 mb-0 sm:hidden"
      popupProps={{ "data-slot": "item-form-sheet" }}
    >
      {(contentRef) => (
        <>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          {/* Header — the close button is rendered LAST (below, absolutely
              positioned) so the first meaningful input keeps autofocus. */}
          <div className={cn("flex shrink-0 items-center border-b border-border px-4 py-3 pr-12", section ? "gap-3" : "gap-2")}>
            {section && <LeadingTile sectionId={section.id} Icon={section.Icon} />}
            {previewContent != null ? (
              <>
                <SheetPrimitive.Title className="sr-only">{title}</SheetPrimitive.Title>
                <div className="flex min-w-0 flex-1 items-center gap-2">{previewContent}</div>
              </>
            ) : (
              <>
                {icon != null && <span className="text-xl leading-none">{icon}</span>}
                <SheetPrimitive.Title className="min-w-0 flex-1 truncate font-heading text-base font-semibold text-foreground">
                  {title}
                </SheetPrimitive.Title>
              </>
            )}
          </div>

          {/* Scrollable grouped body — once scrolled to the top, continuing
              to pull down also dismisses (native touch listeners; they keep
              working when the touch starts on an input or button). */}
          <div
            ref={contentRef}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-none px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            {children}
          </div>

          {/* Sticky footer */}
          <div className="flex shrink-0 items-center gap-2 border-t border-border bg-muted/40 px-4 py-3">
            {onDelete && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={requestDelete}
                disabled={saving}
              >
                {deleteLabel}
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit || saving}>
                {saving ? "Saving…" : submitLabel}
              </Button>
            </div>
          </div>
        </form>
        {/* Close — absolutely positioned + rendered last so it never steals
            initial focus from the first field. */}
        <SheetPrimitive.Close
          render={<Button type="button" variant="ghost" size="icon-sm" className="absolute top-9 right-3 sm:top-2.5" /* offset below the mobile-only drag handle (sm: has no handle, keeps the original position) */ />}
          aria-label="Close"
        >
          <XIcon />
        </SheetPrimitive.Close>
        </>
      )}
    </BottomSheet>
  );
}

// ── Layout helpers ────────────────────────────────────────────────────────────

/** A titled group of fields in the sheet body. */
export function FormSection({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {title && (
        <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {title}
        </p>
      )}
      {/* Hearth H4: one border level per view — the sheet chrome already owns
          the border, so the group is an inset FILL with hairline dividers
          between rows, never its own border (card-in-card is the smell H4 bans). */}
      <div className="divide-y divide-border/60 rounded-xl bg-muted/30 [&>*]:px-3.5 [&>*]:py-3">
        {children}
      </div>
    </div>
  );
}

/**
 * FLUX-234: Quick/Details split — wraps the less-frequently-edited fields of a
 * drawer behind a "Show N more details" disclosure so the always-relevant
 * fields fit above the on-screen keyboard without scrolling.
 */
export function DetailsDisclosure({
  count,
  children,
  className,
}: {
  /** Number of fields hidden behind the disclosure (shown in its label). */
  count: number;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  if (open) {
    return <div className={cn("space-y-4", className)}>{children}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        "text-left text-sm font-medium text-primary hover:underline",
        className
      )}
    >
      Show {count} more detail{count === 1 ? "" : "s"}
    </button>
  );
}

/** A labelled field row: label (+ optional inline action), control, inline error. */
export function FieldRow({
  label,
  htmlFor,
  required,
  action,
  error,
  hint,
  children,
  className,
}: {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  /** Right-aligned control next to the label (e.g. a Clear button). */
  action?: React.ReactNode;
  error?: string | null;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {(label || action) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
              {label}
              {required && <span className="ml-0.5 text-destructive">*</span>}
            </label>
          )}
          {action}
        </div>
      )}
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
