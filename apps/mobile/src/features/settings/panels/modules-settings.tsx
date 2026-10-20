// Native port of apps/web/src/components/modules-settings.tsx (.docs/modules.md):
// the household owner switches whole features on and off for everyone. A
// module that's off disappears from the tab bar, the hub, capture and
// search; its data is kept. Applies live, no Save (M4); switching off offers
// an undo instead of a confirm, since nothing is lost.
import * as React from 'react';
import { Blocks } from 'lucide-react-native';
import {
  Text,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  Switch,
  toast,
} from '@homeup/ui';
import { dependantsOf, saveModuleSwitch, useModules, type ModuleId } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { sectionIcons } from '@/lib/section-icons';
import { SettingsInset, SettingsPanel } from './settings-panel';

export function ModulesSettings() {
  const { group, isGroupOwner, currentUserId, groupMembers, memberProfiles } = useDataCache();
  const modules = useModules();

  const ownerId = groupMembers.find((m) => m.role === 'owner')?.user_id;
  const ownerName = ownerId ? memberProfiles[ownerId]?.name : null;

  const flip = async (id: ModuleId, label: string, on: boolean) => {
    if (!group) return;
    const error = await saveModuleSwitch(getCurrentSupabaseClient(), group.id, id, on, currentUserId);
    if (error) {
      toast.error(`Couldn't change ${label}. Try again.`);
      return;
    }
    if (!on) {
      toast.message(`${label} turned off`, {
        action: {
          label: 'Undo',
          onPress: () => {
            void saveModuleSwitch(getCurrentSupabaseClient(), group.id, id, true, currentUserId);
          },
        },
      });
    }
  };

  return (
    <SettingsPanel
      icon={Blocks}
      title="Modules"
      description={
        isGroupOwner
          ? 'Choose what your household uses. A module you turn off disappears for everyone, and its data is kept for when you turn it back on.'
          : ownerName
            ? `${ownerName} manages these for your household. You can still hide sections just for yourself under Global settings.`
            : 'Your household owner manages these. You can still hide sections just for yourself under Global settings.'
      }
    >
      {/* H4: the panel owns the one border level; the list is an inset fill. */}
      <SettingsInset>
        {modules.offered.map((m) => {
          const on = modules.isEnabled(m.id);
          const usedBy = on ? dependantsOf(m.id, modules.enabled) : [];
          const locked = usedBy.length > 0;
          const Icon = sectionIcons[m.iconId];
          return (
            <ListItem key={m.id} className="min-h-[52px] px-3.5">
              <ListItemLeading>{Icon && <Icon size={16} className="text-muted-foreground" />}</ListItemLeading>
              <ListItemContent>
                <ListItemTitle>{m.label}</ListItemTitle>
                <ListItemMeta>
                  <Text className="text-caption text-muted-foreground">
                    {locked ? `${usedBy.map((d) => d.label).join(', ')} uses this` : m.description}
                  </Text>
                </ListItemMeta>
              </ListItemContent>
              <ListItemTrailing>
                <Switch
                  checked={on}
                  disabled={!isGroupOwner || !group || locked}
                  onChange={(next) => void flip(m.id, m.label, next)}
                  label={m.label}
                />
              </ListItemTrailing>
            </ListItem>
          );
        })}
      </SettingsInset>
    </SettingsPanel>
  );
}
