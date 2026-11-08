// Native port of apps/web/src/components/modules-settings.tsx (.docs/modules.md):
// the household owner switches whole features on and off for everyone. A
// module that's off disappears from the tab bar, the hub, capture and
// search; its data is kept. Applies live, no Save (M4); switching off offers
// an undo instead of a confirm, since nothing is lost. HOUP-616: this is the
// Settings > Tiles tab, so tapping a tile opens its own settings.
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Blocks, ChevronRight } from 'lucide-react-native';
import {
  Text,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  LeadingTile,
  Switch,
  toast,
} from '@homeup/ui';
import { dependantsOf, getSection, hasModuleSettings, saveModuleSwitch, serverUpdateNote, useModules, type ModuleId } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { sectionIcons } from '@/lib/section-icons';
import { SettingsInset, SettingsPanel } from './settings-panel';

export function ModulesSettings() {
  const { group, isGroupOwner, currentUserId, groupMembers, memberProfiles } = useDataCache();
  const modules = useModules();
  const router = useRouter();

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
      title="Tiles"
      description={
        isGroupOwner
          ? 'Choose what your household uses. A tile you turn off disappears for everyone, and its data is kept for when you turn it back on.'
          : ownerName
            ? `${ownerName} manages these for your household. You can still hide sections just for yourself under You, in Navigation.`
            : 'Your household owner manages these. You can still hide sections just for yourself under You, in Navigation.'
      }
    >
      {/* H4: the panel owns the one border level; the list is an inset fill. */}
      <SettingsInset>
        {modules.offered.map((m) => {
          const on = modules.isEnabled(m.id);
          const usedBy = on ? dependantsOf(m.id, modules.enabled) : [];
          const locked = usedBy.length > 0;
          const Icon = sectionIcons[m.iconId];
          // A tile with settings of its own opens them (/settings/<section>).
          const opensSettings = on && !!getSection(m.id) && hasModuleSettings(m.id, modules.enabled);
          return (
            <ListItem
              key={m.id}
              className="min-h-[52px] px-3.5"
              onPress={opensSettings ? () => router.push({ pathname: '/settings/[key]', params: { key: m.id } }) : undefined}
              accessibilityHint={opensSettings ? `Opens ${m.label} settings` : undefined}
            >
              <ListItemLeading>{Icon && <LeadingTile sectionId={m.id} Icon={Icon} size="sm" />}</ListItemLeading>
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
                <View className="w-4">{opensSettings && <ChevronRight size={16} className="text-muted-foreground" />}</View>
              </ListItemTrailing>
            </ListItem>
          );
        })}
      </SettingsInset>
      {modules.serverUpdateAdds.length > 0 && (
        <Text className="px-1 text-caption text-muted-foreground">{serverUpdateNote(modules.serverUpdateAdds)}</Text>
      )}
    </SettingsPanel>
  );
}
