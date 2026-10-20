// HOUP-169: shared section-screen shell owning ScreenBackground + ScrollView
// + safe-area math + padding/gap + the lede slot. Screens previously
// hand-rolled this scaffold with drifting spacing (gap-4 vs gap-6, flush vs
// px-1 lede rows, ad hoc bottom-inset padding) - one screen's tweak never
// propagated to the others.
//
// HOUP-208 decision (deferred from HOUP-205): this shell stays ScrollView-
// based, NOT FlashList-based. Every screen migrated to FlashList so far
// (tasks/groceries/setup/documents/costs/appointments/checklists/recipes)
// already bypasses this shell entirely in favor of ScreenBackground + a
// screen-owned FlashList with ListHeaderComponent — virtualization is
// inherently per-screen-shaped (each screen's union row type differs), so a
// generic FlashList wrapper here would buy nothing. Also: this package is
// react-native-web-compatible ("rendering on native (Expo) and web" above)
// and apps/web depends on it, while @shopify/flash-list is an apps/mobile-
// only dependency with no react-native-web support — baking FlashList in
// here would break that compile contract for screens (settings, home) that
// aren't list screens anyway.
import * as React from 'react';
import { ScrollView, Text, View, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenBackground } from './screen-background';
import { cn } from '../lib/cn';

export interface SectionScreenProps
  extends Omit<ScrollViewProps, 'children' | 'contentContainerClassName' | 'contentContainerStyle'> {
  /**
   * HOUP-170 (pixel audit G5): the current section's name, rendered as a
   * `cap-inscription` micro-label directly above `lede` — mirrors the group
   * headers in section-switcher-sheet.tsx / global-search-results.tsx.
   * Optional because not every SectionScreen consumer is a switchable app
   * section (e.g. Settings' lede already reads "Settings").
   */
  sectionLabel?: string;
  /** H1: the screen's one lede - a headline (and optional trailing actions row). Rendered as the first item in the gapped column, not a sticky header. */
  lede: React.ReactNode;
  children: React.ReactNode;
  /** Vertical gap between lede and body sections. Default `4` (16px, `gap-4`). */
  gap?: 4 | 6;
  /** Extra bottom clearance beyond the safe-area inset. `96` (default) for screens living under the floating tab bar; `24` for stack-pushed screens (settings, detail views) with no tab bar to clear. */
  bottomClearance?: 96 | 24;
  /** Applied to the ScrollView's contentContainer alongside the gap/padding classes. */
  className?: string;
}

export function SectionScreen({
  sectionLabel,
  lede,
  children,
  gap = 4,
  bottomClearance = 96,
  className,
  ...props
}: SectionScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <ScreenBackground>
      <ScrollView
        className="flex-1"
        contentContainerClassName={cn(gap === 6 ? 'gap-6' : 'gap-4', 'p-4', className)}
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + bottomClearance }}
        {...props}
      >
        {sectionLabel ? (
          <View>
            <Text className="cap-inscription mb-1 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {sectionLabel}
            </Text>
            {lede}
          </View>
        ) : (
          lede
        )}
        {children}
      </ScrollView>
    </ScreenBackground>
  );
}
