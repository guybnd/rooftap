import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { HoldFillOverlay } from "@/components/ui/hold-fill-overlay"

// Minimal `asChild` composition helper (no dependency exists in this repo yet).
// Clones the single child element, merging className/style and composing
// event handlers instead of letting one side silently clobber the other.
function mergeSlotProps(
  slotProps: Record<string, unknown>,
  childProps: Record<string, unknown>
) {
  const merged: Record<string, unknown> = { ...slotProps, ...childProps }

  for (const key in childProps) {
    const isHandler = key.startsWith("on") && typeof childProps[key] === "function"
    if (isHandler && typeof slotProps[key] === "function") {
      merged[key] = (...args: unknown[]) => {
        ;(childProps[key] as (...a: unknown[]) => void)(...args)
        // Radix Slot parity: the child handler can veto the slot's composed
        // handler by calling `event.preventDefault()`.
        const event = args[0] as { defaultPrevented?: boolean } | undefined
        if (!event?.defaultPrevented) {
          ;(slotProps[key] as (...a: unknown[]) => void)(...args)
        }
      }
    } else if (key === "className") {
      merged.className = cn(slotProps.className as string, childProps.className as string)
    } else if (key === "style") {
      merged.style = { ...(slotProps.style as object), ...(childProps.style as object) }
    }
  }

  return merged
}

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === "function") ref(node)
      else (ref as React.RefObject<T | null>).current = node
    }
  }
}

interface SlotProps extends React.HTMLAttributes<HTMLElement> {
  ref?: React.Ref<HTMLElement>
  children?: React.ReactNode
}

function Slot({ children, ref, ...slotProps }: SlotProps) {
  if (!React.isValidElement(children)) return null
  const child = children as React.ReactElement<
    Record<string, unknown> & { ref?: React.Ref<HTMLElement> }
  >

  return React.cloneElement(child, {
    ...mergeSlotProps(slotProps, child.props ?? {}),
    ref: mergeRefs(ref, child.props?.ref),
  })
}

// H4: the outer `ListGroup` owns the single border level per view; rows
// inside it are never individually bordered cards -- hairline dividers
// (`divide-y`) between them replace the old per-row border/rounded/bg.
const listItemVariants = cva(
  "group/list-item relative flex w-full items-center gap-3 p-3 text-left text-sm text-card-foreground outline-none transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset data-[expanded]:bg-accent/30 select-none [-webkit-touch-callout:none]"
)

interface ListItemProps extends Omit<React.ComponentProps<"div">, "ref"> {
  /** Render as the single child element (e.g. `Link`/`button`) instead of a `div`. */
  asChild?: boolean
  /** Whether the optional `ListItemBody` beneath this row is open. */
  expanded?: boolean
  /** FLUX-198: opt-in hold-to-edit fill (0→1, from `useLongPress`'s `trackProgress` option). Renders `<HoldFillOverlay>` behind the row's content. Omit for no behavior/DOM change. */
  holdProgress?: number
  ref?: React.Ref<HTMLElement>
}

function ListItem({
  asChild = false,
  expanded = false,
  holdProgress,
  className,
  children,
  ref,
  ...props
}: ListItemProps) {
  const Comp = (asChild ? Slot : "div") as React.ElementType
  return (
    <Comp
      ref={ref}
      data-slot="list-item"
      data-expanded={expanded ? "" : undefined}
      className={cn(listItemVariants(), className)}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {holdProgress !== undefined && <HoldFillOverlay progress={holdProgress} />}
          {children}
        </>
      )}
    </Comp>
  )
}

/**
 * H4 list container: single border + shadow for the whole list, with
 * hairline dividers between `ListItem` rows. Wrap every list of `ListItem`
 * rows in this instead of a bare `space-y-*` div. Hearth v2: the soft
 * rounded-3xl card every list and tile shares.
 */
function ListGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="list-group"
      className={cn(
        "overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)] divide-y divide-border",
        className
      )}
      {...props}
    />
  )
}

function ListItemLeading({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="list-item-leading"
      className={cn(
        "relative flex shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4",
        className
      )}
      {...props}
    />
  )
}

function ListItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="list-item-content"
      className={cn("relative flex min-w-0 flex-1 flex-col gap-0.5", className)}
      {...props}
    />
  )
}

function ListItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="list-item-title"
      className={cn(
        "flex min-w-0 items-center gap-1.5 truncate font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function ListItemMeta({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="list-item-meta"
      className={cn(
        // HOUP-253: `min-w-0` so this nested flex-wrap row can't push
        // `ListItemContent` wider than available space via its own
        // intrinsic content width, even though Content has `min-w-0 flex-1`.
        "flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function ListItemTrailing({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="list-item-trailing"
      className={cn("relative flex shrink-0 items-center gap-1 text-muted-foreground", className)}
      {...props}
    />
  )
}

interface ListItemBodyProps extends React.ComponentProps<"div"> {
  /** Controls the collapse/expand animation independent of the root's `expanded` (kept in sync by the consumer). */
  expanded?: boolean
}

function ListItemBody({ expanded = false, className, children, ...props }: ListItemBodyProps) {
  return (
    <div
      data-slot="list-item-body"
      data-expanded={expanded ? "" : undefined}
      className={cn(
        "grid grid-rows-[0fr] bg-muted/20 transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none data-[expanded]:grid-rows-[1fr]",
        className
      )}
      {...props}
    >
      <div className="min-h-0 overflow-hidden px-3 pb-3">{children}</div>
    </div>
  )
}

export {
  ListItem,
  ListGroup,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
  ListItemBody,
  listItemVariants,
}
