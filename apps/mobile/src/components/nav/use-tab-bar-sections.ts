// The sections the tab bar shows, in the household's order (Settings >
// Navigation), shared by the bar and the (tabs) navigator: the navigator
// ranks its screens by the same order so a tab switch slides the page the
// way the bar's highlight travels.
//
// HOUP-142: mirrors apps/web/src/components/app-sidebar.tsx: orderSections()
// first, then drop hidden ids (except the currently active section, which
// always stays reachable).
import { usePathname } from 'expo-router';
import { getEnabledSections, getSectionByPath, orderSections, useModules } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';

export function useTabBarSections() {
  const pathname = usePathname();
  const { userSettings } = useDataCache();
  const modules = useModules();

  // Ground truth for "which section is this path in", independent of the
  // user's order/hidden settings (mirrors web's getSectionByPath(pathname)).
  const currentSection = getSectionByPath(pathname);

  // Modules (.docs/modules.md): a switched-off module has no tab, even while
  // its route is open (the (tabs) layout redirects away from it).
  const orderedSections = orderSections(getEnabledSections(modules.enabled), userSettings?.section_order ?? []);
  const hiddenSections = userSettings?.hidden_sections ?? [];
  // FLUX-65 parity: hide whole sections, but never strand the user on the
  // section they're currently viewing.
  const visibleSections = orderedSections.filter(
    (s) => !hiddenSections.includes(s.id) || s.id === currentSection.id
  );

  return { pathname, currentSection, orderedSections, hiddenSections, visibleSections };
}
