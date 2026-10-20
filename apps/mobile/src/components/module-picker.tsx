// Modules (.docs/modules.md, step 9): native port of apps/web's
// components/module-picker.tsx. The owner of a household that has never
// chosen its modules gets one full-screen step listing them with the defaults
// ticked. Continue saves the ticks, Skip (or Android back) saves the
// defaults; either way a row per module is written, so it never comes back.
// Settings > Modules changes them later.
//
// An overlay above the stack and tab bar rather than a route or a Modal, so
// the toast host (mounted after it) still shows a failed save.
import * as React from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  ScreenBackground,
  Switch,
  Text,
  toast,
} from '@homeup/ui';
import { MOTION_DURATIONS_MS, saveModuleChoices, useModulePicker, type ModuleId } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { sectionIcons } from '@/lib/section-icons';

export function ModulePicker() {
  const insets = useSafeAreaInsets();
  const { group, isGroupOwner, currentUserId, pendingInvitations } = useDataCache();
  const picker = useModulePicker({ isOwner: isGroupOwner, pendingInvitations: pendingInvitations.length });
  const open = picker.open && !!group;

  const save = async (choice: ReadonlySet<ModuleId>, skipped: boolean) => {
    if (!group) return;
    // A skip doesn't come back this session even if its write fails offline;
    // a failed Continue reopens the picker with the ticks kept.
    if (skipped) picker.dismiss();
    const error = await saveModuleChoices(getCurrentSupabaseClient(), group.id, choice, currentUserId);
    if (error && !skipped) toast.error("Couldn't save your modules. Try again.");
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
              Choose what your household uses
            </Text>
            <Text className="text-body text-muted-foreground">
              Start with what you need. You can change this any time in Settings, and anything you turn off keeps its
              data.
            </Text>
          </View>

          <ListGroup>
            {picker.offered.map((m) => {
              const on = picker.chosen.has(m.id);
              const usedBy = on ? picker.lockedBy(m.id) : [];
              const locked = usedBy.length > 0;
              const Icon = sectionIcons[m.iconId];
              return (
                <ListItem key={m.id}>
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
                      disabled={locked}
                      onChange={(next) => picker.toggle(m.id, next)}
                      label={m.label}
                    />
                  </ListItemTrailing>
                </ListItem>
              );
            })}
          </ListGroup>

          {/* M1: the step's actions sit in the thumb zone, the primary last. */}
          <View className="mt-auto gap-2">
            <Button className="h-11 rounded-xl px-5" onPress={() => void save(picker.chosen, false)}>
              Continue
            </Button>
            <Button variant="ghost" className="h-11 rounded-xl px-5" onPress={skip}>
              Skip
            </Button>
          </View>
        </ScrollView>
      </ScreenBackground>
    </Animated.View>
  );
}
