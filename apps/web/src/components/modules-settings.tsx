"use client";

// Settings > Modules (.docs/modules.md): the household owner switches whole
// features on and off for everyone. A module that's off disappears from nav,
// the hub, capture and search; its data is kept. Applies live, no Save (M4);
// switching off offers an undo instead of a confirm, since nothing is lost.
// HOUP-616: this is the Settings > Tiles tab, so a tile's name opens its own
// settings.
import Link from "next/link";
import { toast } from "sonner";
import { Blocks, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { sectionIcons } from "@/lib/section-icons";
import { toastUndoAction } from "@/lib/undo-toast";
import { SettingsPanel } from "@/components/settings-panel";
import { Switch } from "@/components/ui/switch";
import { LeadingTile } from "@/components/ui/leading-tile";
import {
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
} from "@/components/ui/list-item";
import { dependantsOf, getSection, hasModuleSettings, saveModuleSwitch, serverUpdateNote, useModules, type ModuleId } from "@homeup/core";

export function ModulesSettings() {
  const { group, isGroupOwner, currentUserId, groupMembers, memberProfiles } = useDataCache();
  const modules = useModules();

  const ownerId = groupMembers.find((m) => m.role === "owner")?.user_id;
  const ownerName = ownerId ? memberProfiles[ownerId]?.name : null;

  const flip = async (id: ModuleId, label: string, on: boolean) => {
    if (!group) return;
    const error = await saveModuleSwitch(createClient(), group.id, id, on, currentUserId);
    if (error) {
      toast.error(`Couldn't change ${label}. Try again.`);
      return;
    }
    if (!on) {
      toastUndoAction(`${label} turned off`, () => {
        void saveModuleSwitch(createClient(), group.id, id, true, currentUserId);
      });
    }
  };

  return (
    <SettingsPanel
      icon={Blocks}
      title="Tiles"
      description={
        isGroupOwner
          ? "Choose what your household uses. A tile you turn off disappears for everyone, and its data is kept for when you turn it back on."
          : ownerName
            ? `${ownerName} manages these for your household. You can still hide sections just for yourself under You, in Navigation.`
            : "Your household owner manages these. You can still hide sections just for yourself under You, in Navigation."
      }
    >
      {/* Hearth H4: the panel owns the border; the list is an inset fill. */}
      <ListGroup className="rounded-xl border-0 bg-muted/30 shadow-none divide-border/60">
        {modules.offered.map((m) => {
          const on = modules.isEnabled(m.id);
          const usedBy = on ? dependantsOf(m.id, modules.enabled) : [];
          const locked = usedBy.length > 0;
          const Icon = sectionIcons[m.iconId];
          // A tile with settings of its own opens them (/settings/<section>).
          const opensSettings = on && !!getSection(m.id) && hasModuleSettings(m.id, modules.enabled);
          return (
            <ListItem key={m.id} className="relative min-h-[52px] gap-3 px-3.5 py-3">
              <ListItemLeading>
                {Icon && <LeadingTile sectionId={m.id} Icon={Icon} size="sm" />}
              </ListItemLeading>
              <ListItemContent>
                <ListItemTitle>
                  {opensSettings ? (
                    <Link
                      href={`/settings/${m.id}`}
                      className="inline-flex items-center gap-1 hover:underline focus-visible:outline-none after:absolute after:inset-y-0 after:left-0 after:right-20"
                    >
                      {m.label}
                      <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
                    </Link>
                  ) : (
                    m.label
                  )}
                </ListItemTitle>
                <ListItemMeta>
                  {locked ? `${usedBy.map((d) => d.label).join(", ")} uses this` : m.description}
                </ListItemMeta>
              </ListItemContent>
              <ListItemTrailing>
                <Switch
                  checked={on}
                  disabled={!isGroupOwner || !group || locked}
                  onChange={(next) => flip(m.id, m.label, next)}
                  label={m.label}
                />
              </ListItemTrailing>
            </ListItem>
          );
        })}
      </ListGroup>
      {modules.serverUpdateAdds.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {serverUpdateNote(modules.serverUpdateAdds)}
        </p>
      )}
    </SettingsPanel>
  );
}
