// HOUP-84: native port of apps/web/src/components/navigation-settings.tsx
// (FLUX-65 + FLUX-165: whole-section visibility and per-user ordering).
// Web reorders via @dnd-kit drag handles; HOUP-175 ports the same long-press
// drag interaction natively via packages/ui's `ReorderableList` (the HOUP-129
// primitive) — rows here have no competing swipe/tap/long-press gesture of
// their own, so no explicit "reorder mode" is needed (unlike Setup's cards).
// Move up/down chevrons are kept as the Hearth M3 non-gesture proof path.
// usePathname()/getSectionByPath() are
// the same calls web uses (expo-router's usePathname has an identical
// signature to next/navigation's), so the "current section stays visible"
// guard ports verbatim. Persists hidden_sections/section_order via the same
// getCurrentSupabaseClient() upsert pattern as this ticket's sibling panels.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { usePathname } from 'expo-router';
import { ChevronDown, ChevronUp, GripVertical, Navigation } from 'lucide-react-native';
import {
  Text,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  ReorderableList,
  Switch,
  cn,
} from '@homeup/ui';
import { getEnabledSections, getSectionByPath, orderSections, useModules, type Section } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { sectionIcons } from '@/lib/section-icons';
import { SettingsPanel } from './settings-panel';

async function persistUserSettings(payload: Record<string, unknown>) {
  try {
    const supabase = getCurrentSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, updated_at: new Date().toISOString(), ...payload }, { onConflict: 'user_id' });
  } catch {
    // Offline, or the client isn't bound yet — local state already reflects
    // the change; the next successful edit will persist it.
  }
}

export function NavigationSettings() {
  const pathname = usePathname();
  const { userSettings, refresh } = useDataCache();
  // Only modules the household has on; switched-off ones live in Settings > Modules.
  const modules = useModules();

  // Locally-owned, optimistic copies of the two synced columns — updated
  // immediately on toggle/reorder for a responsive UI, persisted in the
  // background, and re-hydrated once (not on every refresh, so an in-flight
  // edit's optimistic state is never clobbered by a slower network echo).
  const [hidden, setHidden] = React.useState<string[]>([]);
  const [order, setOrder] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const hydrated = React.useRef(false);

  React.useEffect(() => {
    if (hydrated.current || !userSettings) return;
    hydrated.current = true;
    setHidden(userSettings.hidden_sections ?? []);
    setOrder(userSettings.section_order ?? []);
  }, [userSettings]);

  const currentSection = getSectionByPath(pathname);
  const orderedSections = orderSections(getEnabledSections(modules.enabled), order);
  const visibleSections = orderedSections.filter((s) => !hidden.includes(s.id));
  const visibleCount = visibleSections.length;
  const lastPrimaryVisibleId = visibleCount > 4 ? visibleSections[2]?.id : undefined;

  const toggle = async (id: string, isHidden: boolean) => {
    const next = isHidden ? hidden.filter((h) => h !== id) : [...hidden, id];
    setHidden(next);
    setBusy(true);
    try {
      await persistUserSettings({ hidden_sections: next });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const move = async (id: string, dir: -1 | 1) => {
    const ids = orderedSections.map((s) => s.id);
    const idx = ids.indexOf(id);
    const swapIdx = idx + dir;
    if (idx === -1 || swapIdx < 0 || swapIdx >= ids.length) return;
    const next = [...ids];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setOrder(next);
    setBusy(true);
    try {
      await persistUserSettings({ section_order: next });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const reorderSections = async (nextIds: string[]) => {
    setOrder(nextIds);
    setBusy(true);
    try {
      await persistUserSettings({ section_order: nextIds });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPanel
      icon={Navigation}
      title="Navigation"
      description="Hold and drag to reorder, or switch off sections you don't use. On a phone the first four sit in the tab bar and the rest under More; hold a tab to choose what sits there. Hidden sections stay reachable here."
    >
      {/* H4: the panel owns this view's one border level, so the list is the
          inset FILL (no second border). ReorderableList renders its own
          ListGroup, so the override lands on it directly. */}
      <ReorderableList
        data={orderedSections}
        keyExtractor={(section) => section.id}
        onReorder={reorderSections}
        disabled={busy}
        bordered={false}
        className="overflow-hidden rounded-xl bg-muted/30"
        renderItem={(section) => {
          const index = orderedSections.findIndex((s) => s.id === section.id);
          const isHidden = hidden.includes(section.id);
          const isCurrent = section.id === currentSection.id;
          // Can't hide the last remaining visible section.
          const blockHide = !isHidden && visibleCount <= 1;
          return (
            <>
              <SectionRow
                section={section}
                isHidden={isHidden}
                isCurrent={isCurrent}
                blockHide={blockHide}
                busy={busy}
                canMoveUp={index > 0}
                canMoveDown={index < orderedSections.length - 1}
                onMoveUp={() => move(section.id, -1)}
                onMoveDown={() => move(section.id, 1)}
                onToggle={() => toggle(section.id, isHidden)}
              />
              {section.id === lastPrimaryVisibleId && (
                <View className="flex-row items-center gap-2 px-3.5 py-1.5" accessibilityElementsHidden>
                  <View className="h-px flex-1 bg-border" />
                  <Text className="text-micro-label uppercase text-muted-foreground">Under More on a phone</Text>
                  <View className="h-px flex-1 bg-border" />
                </View>
              )}
            </>
          );
        }}
      />
    </SettingsPanel>
  );
}

interface SectionRowProps {
  section: Section;
  isHidden: boolean;
  isCurrent: boolean;
  blockHide: boolean;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: () => void;
}

function SectionRow({
  section,
  isHidden,
  isCurrent,
  blockHide,
  busy,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onToggle,
}: SectionRowProps) {
  const SectionIcon = sectionIcons[section.iconId];

  return (
    <ListItem className="min-h-[52px] items-center gap-2 py-2 pl-2 pr-3.5">
      <ListItemLeading className="mt-0 gap-1.5">
        <GripVertical size={14} className="text-muted-foreground/50" />
        {SectionIcon && (
          <SectionIcon size={16} className={isHidden ? 'text-muted-foreground/60' : 'text-muted-foreground'} />
        )}
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle>
          <Text numberOfLines={1} className={cn('font-medium', isHidden ? 'text-muted-foreground' : 'text-foreground')}>
            {section.label}
          </Text>
        </ListItemTitle>
        {isHidden && isCurrent && (
          <ListItemMeta>
            <Text className="text-caption text-muted-foreground">Still shown while you're in it</Text>
          </ListItemMeta>
        )}
      </ListItemContent>
      <ListItemTrailing className="mt-0 gap-0.5">
        {/* M3 non-gesture proof path for the long-press drag. */}
        <Pressable
          onPress={onMoveUp}
          disabled={!canMoveUp || busy}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Move ${section.label} up`}
          className="size-9 items-center justify-center rounded-full active:bg-accent/40"
        >
          <ChevronUp size={16} className={canMoveUp ? 'text-muted-foreground' : 'text-muted-foreground/30'} />
        </Pressable>
        <Pressable
          onPress={onMoveDown}
          disabled={!canMoveDown || busy}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Move ${section.label} down`}
          className="size-9 items-center justify-center rounded-full active:bg-accent/40"
        >
          <ChevronDown size={16} className={canMoveDown ? 'text-muted-foreground' : 'text-muted-foreground/30'} />
        </Pressable>
        <View className="ml-1">
          <Switch
            checked={!isHidden}
            onChange={() => onToggle()}
            disabled={busy || blockHide}
            label={blockHide ? 'At least one section must stay visible' : `Show ${section.label}`}
          />
        </View>
      </ListItemTrailing>
    </ListItem>
  );
}
