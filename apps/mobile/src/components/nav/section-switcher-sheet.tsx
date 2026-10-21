// HOUP-68: native port of the overflow `<Sheet>` inside
// apps/web/src/components/section-switcher.tsx's `SectionTabBar`.
//
// HOUP-142: web reaches a section's extra NavItems (Map View, Apartment
// Checklist, ...) through the persistent sidebar/drawer, which always shows
// the CURRENT section's navItems. Native has no such drawer, so this sheet
// opens with the active section's own navItems, the only surface that can
// reach them here.
//
// Below them (Guy's pick, Oct 21): a Recent strip of the last spaces you
// opened (core recent-sections.ts; never the bar's own or the one you're on),
// then every visible section as a 4-across tile grid, so a dozen modules fit
// without scrolling and each keeps a fixed spot. The bar's sections wear an
// outlined tile. Settings sits in the footer, Edit bar in the header.
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Settings } from 'lucide-react-native';
import {
  Text,
  BottomSheet,
  BottomSheetScrollView,
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemTitle,
  ListItemTrailing,
  useThemeMaterial,
} from '@homeup/ui';
import { sectionHueSwatch, type NavItem, type Section } from '@homeup/core';
import { sectionIcons } from '@/lib/section-icons';

// A shared NavItem can point at a route that doesn't have a mobile screen
// yet — web has apps/web/src/app/map/page.tsx, mobile has no /map screen
// (deferred, per this ticket's audit). Drop it rather than link to a 404.
const UNAVAILABLE_ON_MOBILE = new Set(['/map']);

// Settings > Global settings holds the Navigation panel (bar order, hidden).
const EDIT_BAR_HREF = '/settings/global';

const MICRO_LABEL =
  'cap-inscription px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground';

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View className="min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1.5 py-0.5">
      <Text className="text-[10px] font-semibold leading-none text-white">{count}</Text>
    </View>
  );
}

export interface SectionSwitcherSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sections to render as switch targets: every visible one, in order. */
  sections: Section[];
  /** The ones the tab bar already shows, drawn with an outlined tile. */
  barSectionIds?: ReadonlySet<string>;
  /** The Recent strip, most recent first (core pickRecentSections). */
  recentSections?: Section[];
  currentSectionId?: string;
  onSelect: (section: Section) => void;
  /** The active section's own navItems (may include the active section
      itself, whether or not it's also in `sections`). */
  currentSectionLabel?: string;
  currentSectionNavItems?: NavItem[];
  overdueCount: number;
  onSelectNavItem: (href: string) => void;
}

export function SectionSwitcherSheet({
  open,
  onOpenChange,
  sections,
  barSectionIds,
  recentSections = [],
  currentSectionId,
  onSelect,
  currentSectionLabel,
  currentSectionNavItems = [],
  overdueCount,
  onSelectNavItem,
}: SectionSwitcherSheetProps) {
  const router = useRouter();
  const { scheme } = useThemeMaterial();
  // Only worth its own group when there's actually something beyond the
  // section's single basePath entry to reach.
  const navItems = currentSectionNavItems.filter((item) => !UNAVAILABLE_ON_MOBILE.has(item.href));
  const showNavItemsGroup = navItems.length > 1;
  const sectionBadge = (section: Section) =>
    overdueCount > 0 && section.navItems.some((i) => i.badge === 'overdueTasks') ? overdueCount : 0;
  const hasBarTiles = sections.some((s) => barSectionIds?.has(s.id));

  const openPath = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="pb-4">
      <View className="flex-row items-center justify-between px-4 pb-3">
        <Text className="text-title font-medium text-foreground">More</Text>
        <Pressable accessibilityRole="link" onPress={() => openPath(EDIT_BAR_HREF)} hitSlop={8} className="p-1">
          <Text className="text-[13px] font-medium text-primary">Edit bar</Text>
        </Pressable>
      </View>

      {/* Short phones or more modules: the body scrolls under the fixed
          header instead of clipping. */}
      <BottomSheetScrollView>
        {showNavItemsGroup && (
          <View className="px-3 pb-3">
            {currentSectionLabel && <Text className={MICRO_LABEL}>{currentSectionLabel}</Text>}
            <ListGroup className="border-0 bg-transparent">
              {navItems.map((item) => {
                const Icon = sectionIcons[item.iconId];
                const showBadge = item.badge === 'overdueTasks' && overdueCount > 0;
                return (
                  <ListItem key={item.href} onPress={() => onSelectNavItem(item.href)}>
                    <ListItemLeading>
                      {Icon && <Icon size={20} className={item.accent ? 'text-primary' : 'text-muted-foreground'} />}
                    </ListItemLeading>
                    <ListItemContent>
                      <ListItemTitle className={item.accent ? 'text-primary' : undefined}>{item.label}</ListItemTitle>
                    </ListItemContent>
                    {showBadge && (
                      <ListItemTrailing>
                        <NavBadge count={overdueCount} />
                      </ListItemTrailing>
                    )}
                  </ListItem>
                );
              })}
            </ListGroup>
          </View>
        )}

        {recentSections.length > 0 && (
          <View className="px-4 pb-4">
            <Text className={MICRO_LABEL}>Recent</Text>
            <View className="flex-row gap-2">
              {recentSections.map((section) => {
                const Icon = sectionIcons[section.iconId];
                return (
                  <Pressable
                    key={section.id}
                    onPress={() => onSelect(section)}
                    accessibilityRole="button"
                    accessibilityLabel={section.label}
                    // Keeps a lone or paired chip at a third of the row, not stretched.
                    style={{ flexBasis: 0, flexGrow: 1, maxWidth: '33.34%' }}
                    className="min-h-[48px] flex-row items-center gap-2 rounded-2xl border border-border bg-card px-2.5 active:scale-[0.97]"
                  >
                    {Icon && <LeadingTile sectionId={section.id} Icon={Icon} size="sm" />}
                    <Text numberOfLines={2} className="flex-1 text-[13px] font-medium leading-tight text-foreground">
                      {section.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {sections.length > 0 && (
          <View className="px-3">
            {recentSections.length > 0 && <Text className={`${MICRO_LABEL} px-2`}>All spaces</Text>}
            <View className="flex-row flex-wrap">
              {sections.map((section) => {
                const Icon = sectionIcons[section.iconId];
                const active = section.id === currentSectionId;
                const inBar = !!barSectionIds?.has(section.id);
                const badge = sectionBadge(section);
                const swatch = sectionHueSwatch(section.id, scheme);
                // Same language as the tab bar (Hearth v2 H2, navigation):
                // every section leads with its own identity tile, and the one
                // you're on names itself in its glyph hue. A bar section's
                // tile is outlined: it's already a tap away below.
                return (
                  <Pressable
                    key={section.id}
                    onPress={() => onSelect(section)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={[section.label, inBar ? 'in bar' : null, badge ? `${badge} overdue` : null]
                      .filter(Boolean)
                      .join(', ')}
                    style={{ width: '25%' }}
                    className="min-h-[92px] items-center gap-2 px-1 py-1.5 active:scale-[0.95]"
                  >
                    {Icon && (
                      <LeadingTile
                        sectionId={section.id}
                        Icon={Icon}
                        size="xl"
                        style={inBar ? { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: swatch.glyph } : undefined}
                      />
                    )}
                    <View className="flex-row items-center gap-1">
                      <Text
                        numberOfLines={2}
                        className={`shrink text-center text-[12px] leading-tight ${
                          active ? 'font-semibold' : inBar ? 'font-medium text-muted-foreground' : 'font-medium text-foreground'
                        }`}
                        style={active ? { color: swatch.glyph } : undefined}
                      >
                        {section.label}
                      </Text>
                      {badge > 0 && <NavBadge count={badge} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <View className="mx-4 mt-3 flex-row items-center justify-between gap-3 border-t border-border pt-3">
          {hasBarTiles ? (
            <View className="flex-1 flex-row items-center gap-2">
              <View className="h-3.5 w-3.5 rounded-[5px] border-[1.5px] border-muted-foreground" />
              <Text className="text-caption text-muted-foreground">Outlined: already in your bar</Text>
            </View>
          ) : (
            <View className="flex-1" />
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => openPath('/settings')}
            className="min-h-[36px] flex-row items-center gap-1.5 rounded-full bg-secondary px-3 active:scale-[0.97]"
          >
            <Settings size={16} className="text-muted-foreground" />
            <Text className="text-[13px] font-medium text-foreground">Settings</Text>
          </Pressable>
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
