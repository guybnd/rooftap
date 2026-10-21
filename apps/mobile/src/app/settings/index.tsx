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
import { View } from 'react-native';
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
  SectionScreen,
  haptics,
} from '@homeup/ui';
import { getEnabledSections, useModules, dialog } from '@homeup/core';
import { OFFICIAL_SERVER_LABEL, getStoredServer, type ServerSelection } from '@/lib/server-config';
import { sectionIcons } from '@/lib/section-icons';
import { signOut } from '@/lib/supabase-client';
import { useAppTheme } from '@/lib/theme-context';
import { themeMeta } from '@/lib/theme-meta';
import { useDataCache } from '@/lib/data-cache';
import { globalMenus, sectionPanels, visiblePanels } from '@/features/settings/settings-registry';
import { TOKEN_KEY as PUSH_TOKEN_KEY } from '@/features/settings/panels/notifications-settings';

const GLOBAL_MENU_ICONS: Record<string, LucideIcon> = {
  global: SlidersHorizontal,
  modules: Blocks,
  users: Users,
  appearance: Palette,
  notifications: Bell,
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

// HOUP-174: 28px rounded-lg tinted icon square, the idiom already used for
// leading icons elsewhere (e.g. home/index.tsx's hero-row + tile icons).
function IconSquare({ icon: Icon, tint = 'bg-muted', tone = 'text-muted-foreground' }: { icon: LucideIcon; tint?: string; tone?: string }) {
  return (
    <View className={`h-7 w-7 items-center justify-center rounded-lg ${tint}`}>
      <Icon size={16} className={tone} />
    </View>
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
    (section) => visiblePanels(sectionPanels[section.id] ?? [], modules.enabled).length > 0
  );

  const themeName = themeMeta.find((t) => t.id === preference)?.name ?? preference;
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
      <View className="gap-2">
        <GroupLabel>General</GroupLabel>
        <ListGroup>
          {globalMenus.map((menu) => {
            const Icon = GLOBAL_MENU_ICONS[menu.key] ?? SlidersHorizontal;
            const value = GLOBAL_MENU_VALUES[menu.key];
            return (
              <ListItem key={menu.key} onPress={() => router.push({ pathname: '/settings/[key]', params: { key: menu.key } })}>
                <ListItemLeading>
                  <IconSquare icon={Icon} />
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
                    <IconSquare icon={Icon} />
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
              <IconSquare icon={Server} />
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
