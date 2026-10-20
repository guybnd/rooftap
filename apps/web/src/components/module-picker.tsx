"use client";

// Modules (.docs/modules.md, step 9): the first-run module picker. The owner
// of a household that has never chosen its modules gets one full-page step
// listing them with the defaults ticked. Continue saves the ticks, Skip (or
// Escape) saves the defaults; either way a row per module is written, so it
// never comes back. Settings > Modules changes them later.
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { sectionIcons } from "@/lib/section-icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
} from "@/components/ui/list-item";
import { saveModuleChoices, useModulePicker, type ModuleId } from "@homeup/core";

export function ModulePicker() {
  const { group, isGroupOwner, currentUserId, pendingInvitations } = useDataCache();
  const picker = useModulePicker({ isOwner: isGroupOwner, pendingInvitations: pendingInvitations.length });

  const save = async (choice: ReadonlySet<ModuleId>, skipped: boolean) => {
    if (!group) return;
    // A skip doesn't come back this session even if its write fails offline;
    // a failed Continue reopens the picker with the ticks kept.
    if (skipped) picker.dismiss();
    const error = await saveModuleChoices(createClient(), group.id, choice, currentUserId);
    if (error && !skipped) toast.error("Couldn't save your modules. Try again.");
  };

  return (
    <DialogPrimitive.Root
      open={picker.open && !!group}
      onOpenChange={(next) => {
        if (!next) void save(picker.defaults, true);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup className="fixed inset-0 z-50 overflow-y-auto bg-background outline-none transition-opacity duration-[var(--motion-slow)] ease-[var(--motion-ease-out)] data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-6 p-4 py-10 sm:p-8">
            <div className="space-y-1">
              <DialogPrimitive.Title className="font-heading text-2xl font-bold tracking-tight">
                Choose what your household uses
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-muted-foreground">
                Start with what you need. You can change this any time in Settings, and anything you turn off keeps its data.
              </DialogPrimitive.Description>
            </div>

            <ListGroup>
              {picker.offered.map((m) => {
                const on = picker.chosen.has(m.id);
                const usedBy = on ? picker.lockedBy(m.id) : [];
                const locked = usedBy.length > 0;
                const Icon = sectionIcons[m.iconId];
                return (
                  <ListItem key={m.id} className="gap-3 p-3">
                    <ListItemLeading>
                      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    </ListItemLeading>
                    <ListItemContent>
                      <ListItemTitle>{m.label}</ListItemTitle>
                      <ListItemMeta>
                        {locked ? `${usedBy.map((d) => d.label).join(", ")} uses this` : m.description}
                      </ListItemMeta>
                    </ListItemContent>
                    <ListItemTrailing>
                      <Switch
                        checked={on}
                        disabled={locked}
                        onChange={(next) => picker.toggle(m.id, next)}
                        label={m.label}
                      />
                    </ListItemTrailing>
                  </ListItem>
                );
              })}
            </ListGroup>

            <div className="mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" className="h-11 rounded-xl px-5" onClick={() => void save(picker.defaults, true)}>
                Skip
              </Button>
              <Button className="h-11 rounded-xl px-5" onClick={() => void save(picker.chosen, false)}>
                Continue
              </Button>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
