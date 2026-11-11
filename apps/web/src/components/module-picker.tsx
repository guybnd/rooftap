"use client";

// Modules (.docs/modules.md, step 9): the first-run tile picker. The owner of
// a household that has never chosen its modules gets one full-page step. It
// leads with three starting sets (core first-run.ts: Everyday, Moving house,
// Everything), one tap each; the full list of switches, each tile with a line
// on what it does for the others, folds under "Choose myself" (Hearth §13.12,
// Guy's pick on 2026-11-10). The button saves the ticks, Escape saves the
// defaults; either way a row per module is written, so it never comes back.
// "Look around a sample home first" opens the live demo household, which
// links back here. Settings > Tiles changes them later.
import { useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { sectionIcons } from "@/lib/section-icons";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { LeadingTile } from "@/components/ui/leading-tile";
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from "@/components/ui/list-item";
import { sampleHomeHref, saveModuleChoices, useModulePicker, type ModuleDef, type ModuleId } from "@homeup/core";

function ModuleTile({ module: m, size }: { module: ModuleDef; size: "xs" | "sm" }) {
  const Icon = sectionIcons[m.iconId];
  return Icon ? <LeadingTile sectionId={m.id} Icon={Icon} size={size} /> : null;
}

export function ModulePicker() {
  const { group, isGroupOwner, currentUserId, pendingInvitations } = useDataCache();
  const picker = useModulePicker({ isOwner: isGroupOwner, pendingInvitations: pendingInvitations.length });
  const [ownList, setOwnList] = useState(false);

  const save = async (choice: ReadonlySet<ModuleId>, skipped: boolean) => {
    if (!group) return;
    // A skip doesn't come back this session even if its write fails offline;
    // a failed save reopens the picker with the ticks kept.
    if (skipped) picker.dismiss();
    const error = await saveModuleChoices(createClient(), group.id, choice, currentUserId);
    if (error && !skipped) toast.error("Couldn't save your tiles. Try again.");
  };

  const current = picker.sets.find((s) => s.id === picker.set);
  const startLabel = current ? `Start with ${current.label}` : "Start with my tiles";

  return (
    <DialogPrimitive.Root
      open={picker.open && !!group}
      onOpenChange={(next) => {
        if (!next) void save(picker.defaults, true);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup className="fixed inset-0 z-50 overflow-y-auto bg-background outline-none transition-opacity duration-[var(--motion-slow)] ease-[var(--motion-ease-out)] data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-5 p-4 py-10 sm:p-8">
            <div className="space-y-1">
              <DialogPrimitive.Title className="font-heading text-2xl font-bold tracking-tight">
                What does your household need?
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-muted-foreground">
                Start with a set. You can change it any time in Settings, and anything you turn off keeps its data.
              </DialogPrimitive.Description>
            </div>

            <ListGroup role="radiogroup" aria-label="Starting sets">
              {picker.sets.map((set) => {
                const on = picker.set === set.id;
                const tiles = picker.offered.filter((m) => set.modules.has(m.id));
                return (
                  <ListItem key={set.id} asChild className={cn("items-start gap-3 p-4", on && "bg-primary/5")}>
                    <button type="button" role="radio" aria-checked={on} onClick={() => picker.chooseSet(set.id)}>
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 size-[18px] shrink-0 rounded-full border-2 border-border transition-[border-width,border-color] duration-[var(--motion-fast)]",
                          on && "border-[5px] border-primary"
                        )}
                      />
                      <ListItemContent className="gap-1.5">
                        <span className="flex items-baseline gap-2">
                          <span className="font-heading text-[15px] font-semibold">{set.label}</span>
                          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{tiles.length} tiles</span>
                        </span>
                        <ListItemMeta>{set.description}</ListItemMeta>
                        <span className="flex flex-wrap gap-1">
                          {tiles.map((m) => (
                            <ModuleTile key={m.id} module={m} size="xs" />
                          ))}
                        </span>
                      </ListItemContent>
                    </button>
                  </ListItem>
                );
              })}
            </ListGroup>

            <button
              type="button"
              aria-expanded={ownList}
              onClick={() => setOwnList((v) => !v)}
              className="flex items-center gap-1.5 self-start rounded-lg px-1 py-1 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ChevronDown className={cn("size-4 transition-transform duration-[var(--motion-fast)]", ownList && "rotate-180")} />
              Choose myself ({picker.chosen.size} on)
            </button>

            {ownList && (
              <ListGroup>
                {picker.offered.map((m) => {
                  const on = picker.chosen.has(m.id);
                  const usedBy = on ? picker.lockedBy(m.id) : [];
                  const locked = usedBy.length > 0;
                  return (
                    <ListItem key={m.id} className="gap-3 p-3">
                      <ModuleTile module={m} size="sm" />
                      <ListItemContent>
                        <ListItemTitle>{m.label}</ListItemTitle>
                        <ListItemMeta>
                          {locked ? `${usedBy.map((d) => d.label).join(", ")} uses this` : (m.feeds ?? m.description)}
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
            )}

            <div className="mt-auto flex flex-col gap-2">
              <Button className="h-11 rounded-xl px-5" onClick={() => void save(picker.chosen, false)}>
                {startLabel}
              </Button>
              {/* The picker only opens on the client, once the household's tiles have loaded. */}
              <a
                href={sampleHomeHref(typeof window === "undefined" ? null : window.location.href)}
                className={cn(buttonVariants({ variant: "ghost" }), "h-11 rounded-xl px-5")}
              >
                Look around a sample home first
              </a>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
