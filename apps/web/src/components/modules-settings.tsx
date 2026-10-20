"use client";

// Settings > Modules (.docs/modules.md): the household owner switches whole
// features on and off for everyone. A module that's off disappears from nav,
// the hub, capture and search; its data is kept. Applies live, no Save (M4);
// switching off offers an undo instead of a confirm, since nothing is lost.
import { toast } from "sonner";
import { Blocks } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { sectionIcons } from "@/lib/section-icons";
import { toastUndoAction } from "@/lib/undo-toast";
import { SettingsPanel } from "@/components/settings-panel";
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
import { dependantsOf, saveModuleSwitch, serverUpdateNote, useModules, type ModuleId } from "@homeup/core";

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
      title="Modules"
      description={
        isGroupOwner
          ? "Choose what your household uses. A module you turn off disappears for everyone, and its data is kept for when you turn it back on."
          : ownerName
            ? `${ownerName} manages these for your household. You can still hide sections just for yourself under Global settings.`
            : "Your household owner manages these. You can still hide sections just for yourself under Global settings."
      }
    >
      {/* Hearth H4: the panel owns the border; the list is an inset fill. */}
      <ListGroup className="rounded-xl border-0 bg-muted/30 shadow-none divide-border/60">
        {modules.offered.map((m) => {
          const on = modules.isEnabled(m.id);
          const usedBy = on ? dependantsOf(m.id, modules.enabled) : [];
          const locked = usedBy.length > 0;
          const Icon = sectionIcons[m.iconId];
          return (
            <ListItem key={m.id} className="min-h-[52px] gap-3 px-3.5 py-3">
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
