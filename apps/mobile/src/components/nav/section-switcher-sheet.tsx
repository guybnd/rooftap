// HOUP-68: native port of the overflow `<Sheet>` inside
// apps/web/src/components/section-switcher.tsx's `SectionTabBar`. Unlike the
// web version (a flat list of plain buttons), this dogfoods the kit's own
// ListGroup/ListItem slot components — a concrete proof the ported
// primitives compose for a real internal consumer, not just the demo screens.
//
// HOUP-142: web reaches a section's extra NavItems (Map View, Apartment
// Checklist, ...) through the persistent sidebar/drawer, which always shows
// the CURRENT section's navItems. Native has no such drawer, so this sheet
// gained a second group above the section-switcher list: the active
// section's own navItems, the only surface that can reach them here.
//
// The section list holds every visible section, not only the ones that
// don't fit the bar; the bar's own are marked "In bar".
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Settings } from 'lucide-react-native';
import {
  Text,
  BottomSheet,
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
  /** The ones the tab bar already shows, marked as such. */
  barSectionIds?: ReadonlySet<string>;
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

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="pb-4">
      <View className="flex-row items-center justify-between px-4 pb-2">
        <Text className="text-title font-medium text-foreground">More</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => {
            onOpenChange(false);
            router.push('/settings');
          }}
          className="p-1"
        >
          <Settings size={20} className="text-muted-foreground" />
        </Pressable>
      </View>

      {showNavItemsGroup && (
        <View className="px-3 pb-3">
          {currentSectionLabel && (
            <Text className="cap-inscription px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {currentSectionLabel}
            </Text>
          )}
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

      {sections.length > 0 && (
        <ListGroup className="mx-3 border-0 bg-transparent">
          {sections.map((section) => {
            const Icon = sectionIcons[section.iconId];
            const active = section.id === currentSectionId;
            const showBadge = overdueCount > 0 && section.navItems.some((i) => i.badge === 'overdueTasks');
            const inBar = !!barSectionIds?.has(section.id);
            // Same language as the tab bar (Hearth v2 H2, navigation): every
            // section leads with its own identity tile, and the one you're on
            // names itself in its glyph hue.
            return (
              <ListItem
                key={section.id}
                onPress={() => onSelect(section)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className="items-center"
              >
                {Icon && <LeadingTile sectionId={section.id} Icon={Icon} size="sm" />}
                <ListItemContent>
                  <ListItemTitle
                    className={active ? 'font-semibold' : undefined}
                    style={active ? { color: sectionHueSwatch(section.id, scheme).glyph } : undefined}
                  >
                    {section.label}
                  </ListItemTitle>
                </ListItemContent>
                {(showBadge || inBar) && (
                  <ListItemTrailing className="items-center gap-2">
                    {inBar && <Text className="text-caption text-muted-foreground">In bar</Text>}
                    {showBadge && <NavBadge count={overdueCount} />}
                  </ListItemTrailing>
                )}
              </ListItem>
            );
          })}
        </ListGroup>
      )}

      <ListGroup className="mx-3 mt-2 border-0 bg-transparent">
        <ListItem
          onPress={() => {
            onOpenChange(false);
            router.push('/settings');
          }}
          className="items-center"
        >
          {/* Tile-sized slot so the label lines up with the section rows above. */}
          <ListItemLeading className="mt-0 h-7 w-7">
            <Settings size={20} className="text-muted-foreground" />
          </ListItemLeading>
          <ListItemTitle>Settings</ListItemTitle>
        </ListItem>
      </ListGroup>
    </BottomSheet>
  );
}
