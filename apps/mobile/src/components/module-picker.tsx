// Modules (.docs/modules.md, step 9): native port of apps/web's
// components/module-picker.tsx. The owner of a household that has never
// chosen its modules gets one full-screen step. It leads with three starting
// sets (core first-run.ts), one tap each; the full list of switches, each
// tile with a line on what it does for the others, folds under "Choose
// myself" (Hearth §13.12, Guy's pick on 2026-11-10). The button saves the
// ticks, Android back saves the defaults; either way a row per module is
// written, so it never comes back. "Look around a sample home first" opens
// the live demo household in an in-app browser. Settings > Tiles changes them
// later.
//
// An overlay above the stack and tab bar rather than a route or a Modal, so
// the toast host (mounted after it) still shows a failed save.
import * as React from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { ChevronDown } from 'lucide-react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  ScreenBackground,
  Switch,
  Text,
  toast,
} from '@homeup/ui';
import {
  MOTION_DURATIONS_MS,
  sampleHomeHref,
  saveModuleChoices,
  useModulePicker,
  type ModuleDef,
  type ModuleId,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { sectionIcons } from '@/lib/section-icons';

function ModuleTile({ module: m, size }: { module: ModuleDef; size: 'xs' | 'sm' }) {
  const Icon = sectionIcons[m.iconId];
  return Icon ? <LeadingTile sectionId={m.id} Icon={Icon} size={size} /> : null;
}

export function ModulePicker() {
  const insets = useSafeAreaInsets();
  const { group, isGroupOwner, currentUserId, pendingInvitations } = useDataCache();
  const picker = useModulePicker({ isOwner: isGroupOwner, pendingInvitations: pendingInvitations.length });
  const open = picker.open && !!group;
  const [ownList, setOwnList] = React.useState(false);
  const current = picker.sets.find((x) => x.id === picker.set);
  const startLabel = current ? `Start with ${current.label}` : 'Start with my tiles';

  const save = async (choice: ReadonlySet<ModuleId>, skipped: boolean) => {
    if (!group) return;
    // A skip doesn't come back this session even if its write fails offline;
    // a failed Continue reopens the picker with the ticks kept.
    if (skipped) picker.dismiss();
    const error = await saveModuleChoices(getCurrentSupabaseClient(), group.id, choice, currentUserId);
    if (error && !skipped) toast.error("Couldn't save your tiles. Try again.");
  };
  const skip = () => void save(picker.defaults, true);

  // Android back skips, the same as Escape on web.
  React.useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      skip();
      return true;
    });
    return () => sub.remove();
  });

  if (!open) return null;

  return (
    <Animated.View
      // Above the tab bar (z-30) and banners, under the toasts (z-50) and the splash.
      style={[StyleSheet.absoluteFill, { zIndex: 40 }]}
      entering={FadeIn.duration(MOTION_DURATIONS_MS.slow)}
      exiting={FadeOut.duration(MOTION_DURATIONS_MS.exit)}
      accessibilityViewIsModal
    >
      <ScreenBackground>
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow gap-6 p-4"
          contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
        >
          <View className="gap-1">
            <Text accessibilityRole="header" className="text-display font-semibold text-foreground">
              What does your household need?
            </Text>
            <Text className="text-body text-muted-foreground">
              Start with a set. You can change it any time in Settings, and anything you turn off keeps its data.
            </Text>
          </View>

          <ListGroup accessibilityRole="radiogroup">
            {picker.sets.map((set) => {
              const on = picker.set === set.id;
              const tiles = picker.offered.filter((m) => set.modules.has(m.id));
              return (
                <ListItem
                  key={set.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${set.label}, ${tiles.length} tiles. ${set.description}`}
                  onPress={() => picker.chooseSet(set.id)}
                  className={on ? 'bg-primary/5 p-4' : 'p-4'}
                >
                  <View
                    className={on ? 'mt-0.5 size-[18px] rounded-full border-[5px] border-primary' : 'mt-0.5 size-[18px] rounded-full border-2 border-border'}
                  />
                  <ListItemContent className="gap-1.5">
                    <View className="flex-row items-baseline gap-2">
                      <Text className="font-heading text-title text-foreground">{set.label}</Text>
                      <Text className="ml-auto text-caption tabular-nums text-muted-foreground">{tiles.length} tiles</Text>
                    </View>
                    <Text className="text-caption text-muted-foreground">{set.description}</Text>
                    <View className="flex-row flex-wrap gap-1">
                      {tiles.map((m) => (
                        <ModuleTile key={m.id} module={m} size="xs" />
                      ))}
                    </View>
                  </ListItemContent>
                </ListItem>
              );
            })}
          </ListGroup>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: ownList }}
            onPress={() => setOwnList((v) => !v)}
            hitSlop={8}
            className="min-h-[44px] flex-row items-center gap-1.5 self-start"
          >
            <ChevronDown size={16} className="text-primary" style={ownList ? { transform: [{ rotate: '180deg' }] } : undefined} />
            <Text className="text-body font-semibold text-primary">Choose myself ({picker.chosen.size} on)</Text>
          </Pressable>

          {ownList && (
            <ListGroup>
              {picker.offered.map((m) => {
                const on = picker.chosen.has(m.id);
                const usedBy = on ? picker.lockedBy(m.id) : [];
                const locked = usedBy.length > 0;
                return (
                  <ListItem key={m.id} className="items-center">
                    <ModuleTile module={m} size="sm" />
                    <ListItemContent>
                      <ListItemTitle>{m.label}</ListItemTitle>
                      <ListItemMeta>
                        <Text className="text-caption text-muted-foreground">
                          {locked ? `${usedBy.map((d) => d.label).join(', ')} uses this` : (m.feeds ?? m.description)}
                        </Text>
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

          {/* M1: the step's actions sit in the thumb zone, the primary first. */}
          <View className="mt-auto gap-2">
            <Button className="h-11 rounded-xl px-5" onPress={() => void save(picker.chosen, false)}>
              {startLabel}
            </Button>
            <Button
              variant="ghost"
              className="h-11 rounded-xl px-5"
              onPress={() => void WebBrowser.openBrowserAsync(sampleHomeHref())}
            >
              Look around a sample home first
            </Button>
          </View>
        </ScrollView>
      </ScreenBackground>
    </Animated.View>
  );
}
