"use client"

// Web twin of @homeup/ui's DialogHost: renders the head of @homeup/core's
// `dialog` queue as a themed center dialog, in place of window.confirm and
// window.prompt (the browser draws those in its own chrome, outside Hearth).
// Call sites `await dialog.confirm({ title, message, destructive })` or
// `await dialog.prompt({ title, defaultValue })`.
//
// Hearth M4: center dialogs are for destructive confirms and the few
// questions that must block. E4/HA: `warn()` fires as a destructive confirm
// appears. A destructive button wears the danger hue on a soft tint; a plain
// confirm is the coral primary. Escape and a backdrop click answer with the
// dialog's cancel button.

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import {
  getDialogs,
  isDestructiveDialog,
  resolveDialog,
  subscribeDialogs,
  type DialogEntry,
} from "@homeup/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { warn } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/** Mount once near the app root (see src/app/layout.tsx). */
export function DialogHost() {
  const dialogs = React.useSyncExternalStore(subscribeDialogs, getDialogs, getDialogs)
  const entry = dialogs[0]
  if (!entry) return null
  // Keyed so a queued dialog mounts fresh (its own field value, its own entrance).
  return <DialogCard key={entry.id} entry={entry} />
}

function DialogCard({ entry }: { entry: DialogEntry }) {
  const [value, setValue] = React.useState(entry.input?.defaultValue ?? "")
  const stacked = entry.buttons.length > 2
  // The confirm-side button takes Enter in a prompt.
  const submitIndex = entry.buttons.findIndex((b) => b.style !== "cancel")

  React.useEffect(() => {
    if (isDestructiveDialog(entry)) warn()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) resolveDialog(entry.id, null, value)
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 isolate z-[60] bg-black/40 duration-150 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Popup
          role="alertdialog"
          className="glass-surface fixed top-1/2 left-1/2 z-[60] flex w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-5 text-popover-foreground shadow-xl outline-none duration-150 sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (submitIndex >= 0) resolveDialog(entry.id, submitIndex, value)
            }}
          >
            <div className="flex flex-col gap-1.5">
              <DialogPrimitive.Title className="font-heading text-base font-semibold text-foreground">
                {entry.title}
              </DialogPrimitive.Title>
              {entry.message && (
                <DialogPrimitive.Description className="text-sm text-muted-foreground">
                  {entry.message}
                </DialogPrimitive.Description>
              )}
            </div>
            {entry.input && (
              <Input
                autoFocus
                value={value}
                placeholder={entry.input.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                className="h-10"
              />
            )}
            <div className={cn("flex gap-2", stacked ? "flex-col" : "flex-row justify-end")}>
              {entry.buttons.map((button, index) => {
                const tone = button.style ?? "default"
                return (
                  <Button
                    key={`${index}-${button.text}`}
                    type={index === submitIndex && entry.input ? "submit" : "button"}
                    // A list of choices stays quiet; coral marks the one confirm of a pair.
                    variant={
                      tone === "destructive"
                        ? "destructive"
                        : tone === "cancel"
                          ? "ghost"
                          : stacked
                            ? "secondary"
                            : "default"
                    }
                    className={cn("h-10 px-4", stacked ? "w-full" : "min-w-20")}
                    onClick={(e) => {
                      e.preventDefault()
                      resolveDialog(entry.id, index, value)
                    }}
                  >
                    {button.text}
                  </Button>
                )
              })}
            </div>
          </form>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
