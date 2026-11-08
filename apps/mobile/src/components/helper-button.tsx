// The way into a module helper's chat (core module-helpers.ts) from its
// module's screen: the Rooftap mark in the screen's head, with a dot while
// the helper's brief has something to add or put back. It opens the pop-up
// chat on the helper. Hidden while the Assistant is off or the server is too
// old for helper chats. Web twin: apps/web/src/components/helper-button.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { briefCount, helperAvailable, moduleHelper, openAssistantPopup, useHelperBrief, useModules } from '@homeup/core';
import { haptics } from '@homeup/ui';
import { RooftapTile } from '@/components/brand/rooftap-mark';
import { useDataCache } from '@/lib/data-cache';
import { useOpenRoute } from '@/lib/tab-routes';

export function HelperButton({ module }: { module: string }) {
  const modules = useModules();
  const openRoute = useOpenRoute();
  const { group, currentUserId } = useDataCache();
  const on = helperAvailable(module, (id) => modules.isEnabled(id)) && modules.server('assistant.helpers');
  const state = useHelperBrief({ helper: on ? module : null, groupId: group?.id, currentUserId });
  const helper = moduleHelper(module);
  if (!on || !helper) return null;
  const count = briefCount(state?.brief);
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        if (!openAssistantPopup({ helper: module })) openRoute('/assistant');
      }}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `${helper.label}, ${count} to look at` : helper.label}
      hitSlop={6}
      className="h-11 w-11 items-center justify-center rounded-lg active:bg-muted"
    >
      <RooftapTile size="sm" />
      {count > 0 ? <View className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" /> : null}
    </Pressable>
  );
}
