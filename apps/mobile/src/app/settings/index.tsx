// HOUP-69 built this screen as a single Server row; HOUP-84 extends it into
// the full settings hub — Global Settings menu rows + one row per enabled
// section that owns settings panels, both routing to /settings/[key], with
// the original Server row preserved verbatim as its own group.
//
// HOUP-208 audit: deliberately NOT migrated to FlashList. This is a fixed,
// small nav-row menu (Global Settings + one row per enabled section +
// Connection + Sign out) that never grows past a couple dozen rows and never
// scales with any user dataset — virtualizing it would add ceremony with zero
// perf benefit. Mirrors apartment-grid.tsx's own stated rationale for staying
// off FlashList (small, bounded row counts).
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import * as Application from 'expo-application';
import {
  Bell,
  Blocks,
  ChevronRight,
  Info,
  KeyRound,
  Plug,
  LogOut,
  Palette,
  Server,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import {
  Text,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  LeadingTile,
  SectionScreen,
  Avatar,
  haptics,
} from '@homeup/ui';
import { firstName, getEnabledSections, householdPeopleLine, settingsMenuHue, useModules, dialog, hasModuleSettings } from '@homeup/core';
import { OFFICIAL_SERVER_LABEL, getStoredServer, type ServerSelection } from '@/lib/server-config';
import { sectionIcons } from '@/lib/section-icons';
import { signOut } from '@/lib/supabase-client';
import { useAppTheme } from '@/lib/theme-context';
import { themePreferenceLabel } from '@/lib/theme-meta';
import { useDataCache } from '@/lib/data-cache';
import { globalMenus } from '@/features/settings/settings-registry';
import { TOKEN_KEY as PUSH_TOKEN_KEY } from '@/features/settings/panels/notifications-settings';

const GLOBAL_MENU_ICONS: Record<string, LucideIcon> = {
  global: SlidersHorizontal,
  modules: Blocks,
  users: Users,
  appearance: Palette,
  notifications: Bell,
  connectors: Plug,
  integrations: KeyRound,
  about: Info,
};

// HOUP-174 (E2): micro-label group headers, same class combo as the tasks
// screen's "cap-inscription section headers" (tasks/index.tsx) and the
// section-switcher sheet's group label — not invented here.
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="cap-inscription px-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
      {children}
    </Text>
  );
}

// HOUP-174: 28px tinted icon square, kept for the Sign out row only. The
// other rows lead with a coloured LeadingTile (core SETTINGS_MENU_HUES).
function IconSquare({ icon: Icon, tint = 'bg-muted', tone = 'text-muted-foreground' }: { icon: LucideIcon; tint?: string; tone?: string }) {
  return (
    <View className={`h-7 w-7 items-center justify-center rounded-lg ${tint}`}>
      <Icon size={16} className={tone} />
    </View>
  );
}

/**
 * Hearth §13.12: the hub's lede. The household's name, where it lives and
 * the app version, then its people as faces and first names with Invite.
 * Tapping it opens Users, so the list doesn't need a Users row.
 */
function HouseholdHeader({ serverLabel, version, onOpen }: { serverLabel: string | null; version: string | null; onOpen: () => void }) {
  const { group, groupMembers, memberProfiles, currentUserId } = useDataCache();
  const others = groupMembers.filter((m) => m.user_id !== currentUserId);
  const faces = [currentUserId, ...others.map((m) => m.user_id)].filter((id): id is string => !!id).slice(0, 4);
  const line = householdPeopleLine(others.map((m) => firstName(memberProfiles[m.user_id]?.name, memberProfiles[m.user_id]?.email)));
  const where = [serverLabel, version ? `Rooftap ${version}` : null].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onOpen();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${group?.name ?? 'Your household'}. ${line}. Open people and invites`}
      className="gap-3 rounded-2xl border border-border bg-card px-4 py-4 active:bg-accent/30"
    >
      <View className="gap-0.5">
        <Text className="font-heading text-title font-semibold text-foreground" numberOfLines={1}>
          {group?.name ?? 'Your household'}
        </Text>
        {!!where && (
          <Text className="text-caption text-muted-foreground" numberOfLines={1}>
            {where}
          </Text>
        )}
      </View>
      <View className="flex-row items-center gap-3">
        <View className="flex-row">
          {faces.map((id, i) => (
            <View key={id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
              <Avatar userId={id} profiles={memberProfiles} size={28} ringed />
            </View>
          ))}
        </View>
        <Text className="min-w-0 flex-1 text-body text-foreground" numberOfLines={1}>
          {line}
        </Text>
        <Text className="text-body font-medium text-primary">Invite</Text>
      </View>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const [server, setServer] = React.useState<ServerSelection | null>(null);
  const { preference } = useAppTheme();
  const { groupMembers } = useDataCache();
  const modules = useModules();
  const { isUpdatePending } = Updates.useUpdates();

  // Mirrors notifications-settings.tsx's own OS-permission + registered-token
  // check (same TOKEN_KEY) so this row's E2 value reflects the real current
  // state instead of guessing.
  const [notifGranted, setNotifGranted] = React.useState<boolean | null>(null);
  const [notifToken, setNotifToken] = React.useState<string | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      getStoredServer().then((stored) => {
        if (!cancelled) setServer(stored);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      Promise.all([Notifications.getPermissionsAsync(), SecureStore.getItemAsync(PUSH_TOKEN_KEY)]).then(
        ([perm, storedToken]) => {
          if (!cancelled) {
            setNotifGranted(perm.granted);
            setNotifToken(storedToken);
          }
        }
      );
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const sectionsWithPanels = getEnabledSections(modules.enabled).filter(
    (section) => hasModuleSettings(section.id, modules.enabled)
  );

  const themeName = themePreferenceLabel(preference);
  const memberCountLabel = `${groupMembers.length} member${groupMembers.length === 1 ? '' : 's'}`;
  const notificationsEnabled = notifGranted === null ? null : notifGranted && !!notifToken;
  const notificationsLabel = notificationsEnabled === null ? null : notificationsEnabled ? 'On' : 'Off';

  // E2: the current value for the global-menu rows that represent a live
  // setting (theme, modules on, member count, notification state) — right-aligned
  // before the trailing chevron. Rows with no single current value (Global
  // settings, Integrations & keys) stay chevron-only.
  const GLOBAL_MENU_VALUES: Record<string, string | null> = {
    appearance: themeName,
    modules: `${modules.enabled.size} of ${modules.offered.length} on`,
    users: memberCountLabel,
    notifications: notificationsLabel,
    about: isUpdatePending ? 'Update ready' : Application.nativeApplicationVersion ? `v${Application.nativeApplicationVersion}` : null,
  };

  const handleSignOut = () => {
    if (!server) return;
    dialog.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut(server.config);
          haptics.warn();
          router.replace('/login');
        },
      },
    ]);
  };

  return (
    <SectionScreen
      lede={<Text className="px-1 text-display font-semibold text-foreground">Settings</Text>}
      bottomClearance={24}
    >
      <HouseholdHeader
        serverLabel={server ? (server.isOfficial ? OFFICIAL_SERVER_LABEL : server.origin) : null}
        version={Application.nativeApplicationVersion ? `v${Application.nativeApplicationVersion}` : null}
        onOpen={() => router.push({ pathname: '/settings/[key]', params: { key: 'users' } })}
      />

      <View className="gap-2">
        <GroupLabel>General</GroupLabel>
        <ListGroup>
          {globalMenus.filter((menu) => menu.key !== 'users').map((menu) => {
            const Icon = GLOBAL_MENU_ICONS[menu.key] ?? SlidersHorizontal;
            const value = GLOBAL_MENU_VALUES[menu.key];
            return (
              <ListItem key={menu.key} onPress={() => router.push({ pathname: '/settings/[key]', params: { key: menu.key } })}>
                <ListItemLeading>
                  <LeadingTile hue={settingsMenuHue(menu.key)} Icon={Icon} size="sm" />
                </ListItemLeading>
                <ListItemContent>
                  <ListItemTitle>{menu.label}</ListItemTitle>
                </ListItemContent>
                <ListItemTrailing>
                  {value !== undefined && value !== null && (
                    <Text className="text-caption text-muted-foreground">{value}</Text>
                  )}
                  <ChevronRight size={16} className="text-muted-foreground" />
                </ListItemTrailing>
              </ListItem>
            );
          })}
        </ListGroup>
      </View>

      {sectionsWithPanels.length > 0 && (
        <View className="gap-2">
          <GroupLabel>Sections</GroupLabel>
          <ListGroup>
            {sectionsWithPanels.map((section) => {
              const Icon = sectionIcons[section.iconId] ?? SlidersHorizontal;
              return (
                <ListItem
                  key={section.id}
                  onPress={() => router.push({ pathname: '/settings/[key]', params: { key: section.id } })}
                >
                  <ListItemLeading>
                    <LeadingTile sectionId={section.id} Icon={Icon} size="sm" />
                  </ListItemLeading>
                  <ListItemContent>
                    <ListItemTitle>{section.label}</ListItemTitle>
                  </ListItemContent>
                  <ListItemTrailing>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </ListItemTrailing>
                </ListItem>
              );
            })}
          </ListGroup>
        </View>
      )}

      <View className="gap-2">
        <GroupLabel>Connection</GroupLabel>
        <ListGroup>
          <ListItem onPress={() => router.push({ pathname: '/server-picker', params: { mode: 'switch' } })}>
            <ListItemLeading>
              <LeadingTile hue={settingsMenuHue('server')} Icon={Server} size="sm" />
            </ListItemLeading>
            <ListItemContent>
              <ListItemTitle>Server</ListItemTitle>
              <ListItemMeta>
                <Text numberOfLines={1} className="text-caption text-muted-foreground">
                  {server ? (server.isOfficial ? OFFICIAL_SERVER_LABEL : server.origin) : '...'}
                </Text>
              </ListItemMeta>
            </ListItemContent>
            <ListItemTrailing>
              <ChevronRight size={16} className="text-muted-foreground" />
            </ListItemTrailing>
          </ListItem>
        </ListGroup>
      </View>

      <ListGroup>
        <ListItem onPress={handleSignOut} disabled={!server}>
          <ListItemLeading>
            {/* H2: danger is a word or a glyph, never a tinted block. */}
            <IconSquare icon={LogOut} tone="text-destructive" />
          </ListItemLeading>
          <ListItemContent>
            <ListItemTitle className="text-destructive">Sign out</ListItemTitle>
          </ListItemContent>
        </ListItem>
      </ListGroup>
    </SectionScreen>
  );
}
