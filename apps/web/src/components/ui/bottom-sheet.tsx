"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { useSheetDragDismiss, useCloseOnBack, useSheetOpenSignal, dragDismissStyle } from "@/hooks/use-sheet-gestures"

// FLUX-203: the single mobile bottom-sheet primitive for the app. Owns the
// portal, backdrop, transition-based entrance/exit, drag-to-dismiss (handle +
// content, via use-sheet-gestures), Android/browser back-close, and the handle
// bar — the integration wiring that used to be re-implemented separately by
// SheetContent (side="bottom"), ItemFormSheet, and PopMenu's mobileSheet mode.
// Those three stay thin adapters: they own their own visual finish (colors,
// radius, shadow, desktop presentation) via `className`/`overlayClassName`,
// but none of them touch a gesture handler, a drag style, or a contentRef
// directly anymore — that was the root cause of FLUX-201's bug rounds.

type BottomSheetChildren =
  | React.ReactNode
  | ((contentRef: (el: HTMLElement | null) => void) => React.ReactNode)

interface BottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Plain content: BottomSheet wires the drag/content ref to the Popup itself
   * (it doubles as the scroll container — add `overflow-y-auto` in `className`
   * if the content should scroll). Pass a function instead when the consumer
   * has its own scroll container nested inside other chrome (header/footer) —
   * it receives the merged ref to attach there.
   */
  children: BottomSheetChildren
  className?: string
  style?: React.CSSProperties
  overlayClassName?: string
  /** Render the built-in drag handle. Default true. */
  showHandle?: boolean
  handleClassName?: string
  handleIndicatorClassName?: string
  /** Extra props spread onto the Popup element (role, data-slot, aria-*, id…). */
  popupProps?: Omit<SheetPrimitive.Popup.Props, "className" | "style" | "children"> &
    Record<string, unknown>
}

export function BottomSheet({
  open,
  onOpenChange,
  children,
  className,
  style,
  overlayClassName,
  showHandle = true,
  handleClassName,
  handleIndicatorClassName,
  popupProps,
}: BottomSheetProps) {
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange])
  useCloseOnBack(open, close)
  useSheetOpenSignal(open)
  const { dragY, dragging, handleHandlers, contentRef } = useSheetDragDismiss(close)

  const isRenderProp = typeof children === "function"

  return (
    <SheetPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <SheetPrimitive.Portal>
        <SheetPrimitive.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/10 transition-opacity duration-[var(--motion-fast)] data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
            overlayClassName
          )}
        />
        <SheetPrimitive.Popup
          data-slot="bottom-sheet"
          ref={isRenderProp ? undefined : contentRef}
          className={cn(
            // Hearth §8: slides up on entry at --motion-slow (swift-out); exits
            // faster + softer at --motion-exit ease-in (data-ending-style overrides
            // the base transition-duration/timing-function declared for entry).
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] translate-y-0 flex-col overscroll-none outline-none transition-[transform,opacity] duration-[var(--motion-slow)] ease-[var(--motion-ease-out)] data-ending-style:translate-y-full data-ending-style:opacity-0 data-ending-style:duration-[var(--motion-exit)] data-ending-style:ease-[var(--motion-ease-in)] data-starting-style:translate-y-full data-starting-style:opacity-0",
            className
          )}
          style={{
            ...style,
            ...dragDismissStyle(dragY, dragging),
          }}
          {...popupProps}
        >
          {showHandle && (
            <div
              {...handleHandlers}
              aria-hidden
              className={cn(
                "flex shrink-0 touch-none justify-center px-6 py-3 -mb-4",
                handleClassName
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-12 rounded-full bg-foreground/20",
                  handleIndicatorClassName
                )}
              />
            </div>
          )}
          {isRenderProp ? children(contentRef) : children}
        </SheetPrimitive.Popup>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  )
}
