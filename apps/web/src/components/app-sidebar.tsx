"use client";

import { AssistantAnswers } from "@/components/assistant-answers";
import { AssistantChatPopup } from "@/components/assistant-chat-popup";
import { CookAlarms } from "@/components/cook/cook-alarms";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSelectedLayoutSegment } from "next/navigation";
import {
  Settings,
  Menu,
  X,
  LogOut,
  User,
  ArrowLeft,
  Bell,
  Blocks,
  KeyRound,
  Plug,
  Palette,
  Sparkles,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { DataCacheProvider } from "@/lib/data-cache";
import { LegendSyncBootstrap } from "@/lib/legend/sync-status";
import { ModulePicker } from "@/components/module-picker";
import { WhatsNewDialog } from "@/components/whats-new";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { OfflineIndicator } from "@/components/offline-indicator";
import { RevalidatingIndicator } from "@/components/revalidating-indicator";
import { clearThreadCache, sections, assignTabSlot, reorderVisibleSections, getSectionByPath, getEnabledSections, getModuleIdForPath, orderSections, settingsMenuHue, tabTravelDirection, glowDriftX, useModules } from "@homeup/core";
import { sectionIcons } from "@/lib/section-icons";
import { globalMenus, sectionPanels, visiblePanels } from "@/app/settings/settings-registry";
import { SectionSwitcherGrid, SectionTabBar } from "@/components/section-switcher";
import { useSectionSettings } from "@/lib/use-section";
import { useOverdueTaskCount } from "@/hooks/use-overdue-task-count";
import { useAnySheetOpen } from "@/hooks/use-sheet-gestures";
import { flushSync } from "react-dom";
import { runNavTransition, notifyRouteSettled } from "@/lib/view-transitions";
import { CaptureProvider } from "@/components/capture/capture-context";
import { CaptureSheet } from "@/components/capture/capture-sheet";
import { DesktopCaptureButton, DockCaptureFab } from "@/components/capture/capture-buttons";
import { SectionSubnav, TopBar } from "@/components/top-bar";
import { SectionGlow } from "@/components/ui/section-glow";
import { useApplyNavSpeed } from "@/lib/nav-speed";
import { LeadingTile } from "@/components/ui/leading-tile";

function OfflineBanner() {
  return <OfflineIndicator />;
}

// Glyph for each General settings row; the tile colour comes from core's
// SETTINGS_MENU_HUES so web and the app's Settings screen match.
const GLOBAL_MENU_ICONS: Record<string, LucideIcon> = {
  global: SlidersHorizontal,
  modules: Blocks,
  users: Users,
  appearance: Palette,
  notifications: Bell,
  connectors: Plug,
  integrations: KeyRound,
  "whats-new": Sparkles,
};

// HOUP-48: the settings menu (General + App sections) — shared by the
// desktop nav and the mobile drawer so there is one source of truth for
// "what settings screens exist" instead of two hand-kept lists.
function SettingsMenuNav({
  settingsSectionRows,
  isActive,
  onNavigate,
  compact = false,
  backLabel,
  onBack,
}: {
  settingsSectionRows: ReturnType<typeof getEnabledSections>;
  isActive: (href: string) => boolean;
  onNavigate?: () => void;
  compact?: boolean;
  /** HOUP-50: label for the "back to section" row — set only when the menu was
      opened in place from a section page (state-driven), not via a /settings
      deep link, since a deep link has no prior section to return to. */
  backLabel?: string;
  onBack?: () => void;
}) {
  const itemClass = (active: boolean) =>
    cn(
      "relative flex items-center gap-3 rounded-lg px-3 font-medium transition-all duration-150",
      compact ? "py-1 text-[13px]" : "py-1.5 text-sm",
      active
        ? "bg-sidebar-accent text-sidebar-accent-foreground before:content-[''] before:absolute before:-left-0.5 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[3px] before:rounded-full before:bg-primary"
        : "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/40"
    );

  return (
    <>
      {backLabel && onBack && (
        <button
          type="button"
          onClick={onBack}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-all duration-150 mb-1",
            compact ? "py-2 text-[13px]" : "py-2.5 text-sm"
          )}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          {backLabel}
        </button>
      )}
      <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/50">
        General
      </div>
      {globalMenus.map((menu) => {
        const href = menu.key === "global" ? "/settings" : `/settings/${menu.key}`;
        return (
          <Link
            key={menu.key}
            href={href}
            prefetch={true}
            onClick={onNavigate}
            className={itemClass(isActive(href))}
          >
            <LeadingTile hue={settingsMenuHue(menu.key)} Icon={GLOBAL_MENU_ICONS[menu.key] ?? SlidersHorizontal} size="sm" />
            {menu.label}
          </Link>
        );
      })}

      {settingsSectionRows.length > 0 && (
        <>
          <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/50">
            App sections
          </div>
          {settingsSectionRows.map((section) => {
            const href = `/settings/${section.id}`;
            const Icon = sectionIcons[section.iconId];
            return (
              <Link
                key={section.id}
                href={href}
                prefetch={true}
                onClick={onNavigate}
                className={itemClass(isActive(href))}
              >
                <LeadingTile sectionId={section.id} Icon={Icon} size="sm" />
                {section.label}
              </Link>
            );
          })}
        </>
      )}
    </>
  );
}

export function AppSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The landing page is served at `/` by a middleware rewrite, so the address
  // (usePathname) says "/" while the matched route segment says "landing".
  const segment = useSelectedLayoutSegment();
  const router = useRouter();
  // The device's navigation speed drives --motion-nav (globals.css).
  useApplyNavSpeed();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; avatarUrl: string | null } | null>(null);
  const { settings, updateLastUsedSection, updateHiddenSections, updateSectionOrder } = useSectionSettings();
  const overdueCount = useOverdueTaskCount();
  const sheetOpen = useAnySheetOpen();
  // HOUP-50: tapping Settings opens the shared menu in place (state-driven)
  // instead of navigating — reverses HOUP-48's route-driven swap, which made
  // the settings tap dead-feeling from some sections and skipped straight to
  // a settings screen instead of showing the menu first. `settingsMenuOrigin`
  // remembers which section the menu was opened from so a back row can return
  // to it without a route change; it stays null for a genuine /settings deep
  // link (nothing to go "back" to).
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [settingsMenuOrigin, setSettingsMenuOrigin] = useState<{ id: string; label: string } | null>(null);

  // Hearth §8.1: resolve any in-flight nav view-transition once this route
  // has committed. Runs on every pathname change; a no-op unless a
  // runNavTransition() call is currently pending (tab switch / descend /
  // back / portal).
  useEffect(() => {
    notifyRouteSettled();
    setNavTarget(null);
  }, [pathname]);

  // A real navigation always supersedes the in-place menu state — whether the
  // user picked a settings item (lands on /settings/*, where `onSettings`
  // takes over) or switched sections entirely (the menu must not stick).
  useEffect(() => {
    setShowSettingsMenu(false);
    setSettingsMenuOrigin(null);
  }, [pathname]);

  const modules = useModules();
  // A tab switch starts its slide before the new route has rendered
  // (runNavTransition's holdUntilSlid), so the bar, the subnav and the glow
  // follow the section being switched to from the moment the slide starts.
  const [navTarget, setNavTarget] = useState<string | null>(null);
  const currentSection = (navTarget && sections.find((s) => s.id === navTarget)) || getSectionByPath(pathname);
  const CurrentSectionIcon = sectionIcons[currentSection.iconId];
  // FLUX-165: apply the user's saved section order first (single ordering point
  // for both the desktop grid and the mobile bar); unknown/new sections keep
  // declaration order at the end.
  const enabledSections = orderSections(getEnabledSections(modules.enabled), settings.sectionOrder ?? []);
  // FLUX-65: hide whole sections from the switcher, but never strand the user —
  // the active section is always shown even if marked hidden.
  const hiddenSections = settings.hiddenSections ?? [];
  const visibleSections = enabledSections.filter(
    (s) => !hiddenSections.includes(s.id) || s.id === currentSection.id
  );
  const onSettings = pathname.startsWith("/settings");
  // HOUP-50: the Settings tap opens the menu in place — it no longer computes
  // a deep-link href for the tap itself (see `openSettingsMenu` below).
  // HOUP-42: on /settings/** routes the mobile drawer shows the settings menu
  // (General + App sections) instead of the current section's nav items —
  // this is the single drawer everywhere, contextual by route.
  const settingsSectionRows = getEnabledSections(modules.enabled).filter(
    (s) => visiblePanels(sectionPanels[s.id] ?? [], modules.enabled).length > 0
  );

  // Modules (.docs/modules.md): a switched-off module's routes are gone for
  // this household, including deep links and stale tabs. Send them home.
  const routeModuleId = getModuleIdForPath(pathname);
  const routeModuleOff = routeModuleId !== null && !modules.isSectionEnabled(routeModuleId);
  useEffect(() => {
    if (routeModuleOff) router.replace("/home");
  }, [routeModuleOff, router]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (u) {
        setUser({
          name: u.user_metadata?.full_name || u.email || "User",
          avatarUrl: u.user_metadata?.avatar_url || null,
        });
      }
    }).catch(() => {
      // Auth unavailable (network/refresh failure) — leave the avatar unset
      // rather than an unhandled rejection; no redirect involved (FLUX-1549).
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const isAuthPage =
    pathname === "/login" || pathname === "/callback" || segment === "landing" || pathname.startsWith("/oauth/");
  if (isAuthPage) return <>{children}</>;

  const isActive = (href: string) => {
    if (href === "/settings") return pathname === "/settings";
    return pathname.startsWith(href);
  };

  // HOUP-50: open the settings menu in place from the current section, no
  // navigation. Only reachable from a real section (the Settings tap only
  // renders in the non-onSettings branch below), so currentSection is never
  // the standalone `profile` section here.
  const openSettingsMenu = () => {
    setSettingsMenuOrigin({ id: currentSection.id, label: currentSection.label });
    setShowSettingsMenu(true);
  };

  const closeSettingsMenu = () => {
    setShowSettingsMenu(false);
    setSettingsMenuOrigin(null);
  };

  const handleSectionChange = (sectionId: string) => {
    const section = sections.find((s) => s.id === sectionId);
    if (section) {
      setOpen(false);
      // FLUX-1553 review: re-tapping the already-active tab is a normal
      // gesture — router.push to the unchanged path never re-fires the
      // `[pathname]` effect that settles the view transition, freezing the
      // app on the stale snapshot. Skip the transition entirely rather than
      // relying only on the settle fallback in runNavTransition.
      if (currentSection.id === sectionId) return;
      updateLastUsedSection(sectionId);
      // Hearth §8.1: a lateral tab switch shifts the page the way the tab
      // bar's pebble travels (toward the end of the bar = forward); a
      // section that isn't in the bar just crossfades.
      const travel = tabTravelDirection(
        visibleSections.map((s) => s.id),
        currentSection.id,
        sectionId
      );
      const type = travel > 0 ? "shift-forward" : travel < 0 ? "shift-back" : "crossfade";
      runNavTransition(type, () => router.push(section.basePath), {
        holdUntilSlid: true,
        target: section.basePath,
        onStart: () => flushSync(() => setNavTarget(sectionId)),
      });
    }
  };

  // Holding a phone tab picks what sits in its slot (core assignTabSlot);
  // it saves the same order/visibility Settings > Navigation edits.
  const handleChooseForSlot = (slotId: string, chosenId: string) => {
    const ids = enabledSections.map((s) => s.id);
    const next = assignTabSlot(ids, hiddenSections, slotId, chosenId);
    if (next.order === ids) return;
    updateSectionOrder(next.order);
    if (next.hidden.length !== hiddenSections.length) updateHiddenSections(next.hidden);
  };

  // The More sheet's rearrange mode hands back every visible section in its
  // new order; hidden ones keep their places (core reorderVisibleSections).
  const handleReorder = (visibleIds: string[]) => {
    const ids = enabledSections.map((s) => s.id);
    const next = reorderVisibleSections(
      ids,
      visibleSections.map((s) => s.id),
      visibleIds
    );
    if (next !== ids) updateSectionOrder(next);
  };

  return (
    <CaptureProvider>
    <AssistantAnswers />
    <AssistantChatPopup />
    <CookAlarms />
    <div className="flex h-[100svh] overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="desk-classic hidden md:flex w-[220px] flex-col border-r border-sidebar-border/60 bg-sidebar shrink-0">
        <div className="flex flex-col border-b border-sidebar-border/60">
          {/* Logo section */}
          <div className="flex items-center gap-2.5 px-5 h-14">
            <div className="size-7 rounded-lg bg-primary/15 flex items-center justify-center ring-1 ring-primary/20">
              <span className="text-primary font-semibold text-sm">H</span>
            </div>
            <span className="font-semibold text-[15px] tracking-tight text-sidebar-foreground">Rooftap</span>
          </div>

          {/* Section switcher: always-visible tile grid */}
          {visibleSections.length > 1 && (
            <SectionSwitcherGrid
              sections={visibleSections}
              currentSectionId={currentSection.id}
              onSelect={handleSectionChange}
            />
          )}
        </div>

        {/* Global capture entry point */}
        <DesktopCaptureButton />

        {/* HOUP-50 bug 3: overflow-y-auto + min-h-0 lets the settings menu (up to
            5 General + 6 App-section rows + 2 headers, taller than most section
            navs) scroll inside the sidebar instead of clipping under the footer. */}
        <nav className="flex-1 flex flex-col gap-px p-2.5 pt-3 overflow-y-auto min-h-0">
          {onSettings || showSettingsMenu ? (
            <SettingsMenuNav
              settingsSectionRows={settingsSectionRows}
              isActive={isActive}
              compact
              backLabel={settingsMenuOrigin?.label}
              onBack={closeSettingsMenu}
            />
          ) : (
            <>
              {currentSection.navItems.map((item) => {
                const ItemIcon = sectionIcons[item.iconId];
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={true}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150",
                      item.accent && !isActive(item.href) && "text-primary hover:bg-primary/8",
                      isActive(item.href)
                        ? "bg-sidebar-accent text-sidebar-accent-foreground before:content-[''] before:absolute before:-left-0.5 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[3px] before:rounded-full before:bg-primary"
                        : !item.accent && "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/40"
                    )}
                  >
                    <ItemIcon className="h-4 w-4 shrink-0" />
                    {item.label}
                    {item.badge === "overdueTasks" && overdueCount > 0 && (
                      <span className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                        {overdueCount}
                      </span>
                    )}
                  </Link>
                );
              })}

              {/* Settings tap - always visible, opens the menu in place (no
                  navigation) so it can never dead-tap regardless of section
                  (HOUP-50 bug 1) and always shows the menu first (bug 2). */}
              <button
                type="button"
                onClick={openSettingsMenu}
                className="relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/40"
              >
                <Settings className="h-4 w-4 shrink-0" />
                Settings
              </button>
            </>
          )}
        </nav>
        <div className="px-2.5 py-2.5 border-t border-sidebar-border/60 space-y-1">
          <ThemeSwitcher compact />
          {user && (
            <div className="flex items-center gap-2.5 px-3 py-1.5">
              {user.avatarUrl ? (
                <Image
                  src={user.avatarUrl}
                  alt={user.name}
                  width={24}
                  height={24}
                  className="rounded-full shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="size-6 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
                  <User className="h-3.5 w-3.5 text-sidebar-foreground/50" />
                </div>
              )}
              <span className="text-[13px] font-medium text-sidebar-foreground/80 truncate">{user.name}</span>
            </div>
          )}
          <form action="/logout" method="POST" onSubmit={clearThreadCache}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-all duration-150"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-sidebar border-r border-sidebar-border/60 transition-transform duration-200 ease-out md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex flex-col border-b border-sidebar-border/60">
          {/* Header */}
          <div className="flex items-center justify-between px-4 h-14">
            <div className="flex items-center gap-2.5">
              <div className="size-7 rounded-lg bg-primary/15 flex items-center justify-center ring-1 ring-primary/20">
                <span className="text-primary font-semibold text-sm">H</span>
              </div>
              <span className="font-semibold text-[15px] tracking-tight text-sidebar-foreground">Rooftap</span>
            </div>
            <button onClick={() => setOpen(false)} className="p-2 -mr-1 rounded-lg hover:bg-sidebar-accent text-sidebar-foreground/50">
              <X className="h-5 w-5" />
            </button>
          </div>

        </div>

        <nav className="flex-1 flex flex-col gap-px p-2.5 pt-3 overflow-y-auto min-h-0">
          {onSettings || showSettingsMenu ? (
            <SettingsMenuNav
              settingsSectionRows={settingsSectionRows}
              isActive={isActive}
              onNavigate={() => setOpen(false)}
              backLabel={settingsMenuOrigin?.label}
              onBack={closeSettingsMenu}
            />
          ) : (
            <>
              {/* Current section context */}
              <div className="flex items-center gap-2 px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/50">
                <CurrentSectionIcon className="h-3.5 w-3.5 shrink-0" />
                {currentSection.label}
              </div>
              {currentSection.navItems.map((item) => {
                const ItemIcon = sectionIcons[item.iconId];
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={true}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                      item.accent && !isActive(item.href) && "text-primary hover:bg-primary/8",
                      isActive(item.href)
                        ? "bg-sidebar-accent text-sidebar-accent-foreground before:content-[''] before:absolute before:-left-0.5 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[3px] before:rounded-full before:bg-primary"
                        : !item.accent && "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/40"
                    )}
                  >
                    <ItemIcon className="h-4 w-4 shrink-0" />
                    {item.label}
                    {item.badge === "overdueTasks" && overdueCount > 0 && (
                      <span className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                        {overdueCount}
                      </span>
                    )}
                  </Link>
                );
              })}

              {/* Settings tap - always visible on mobile too, section-aware.
                  Opens the settings sub-menu in place and keeps the drawer
                  open (HOUP-50 bug 2) — only picking an actual settings
                  screen closes the drawer (via onNavigate above). */}
              <button
                type="button"
                onClick={openSettingsMenu}
                className="relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/40"
              >
                <Settings className="h-4 w-4 shrink-0" />
                Settings
              </button>
            </>
          )}
        </nav>
        <div className="px-2.5 py-2.5 border-t border-sidebar-border/60 space-y-1">
          <ThemeSwitcher compact />
          {user && (
            <div className="flex items-center gap-2.5 px-3 py-2">
              {user.avatarUrl ? (
                <Image
                  src={user.avatarUrl}
                  alt={user.name}
                  width={24}
                  height={24}
                  className="rounded-full shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="size-6 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
                  <User className="h-3.5 w-3.5 text-sidebar-foreground/50" />
                </div>
              )}
              <span className="text-[13px] font-medium text-sidebar-foreground/80 truncate">{user.name}</span>
            </div>
          )}
          <form action="/logout" method="POST" onSubmit={clearThreadCache}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-all duration-150"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Hearth §13 "Desktop shell": the wide-screen top bar (the default;
            Settings > Appearance can bring the sidebar above back). */}
        <TopBar
          sections={visibleSections}
          currentSectionId={currentSection.id}
          onSelect={handleSectionChange}
          overdueCount={overdueCount}
          user={user}
          onSettings={onSettings}
        />
        {/* Mobile top bar */}
        <header className="flex items-center gap-3 px-4 h-12 border-b border-border/50 bg-background/90 backdrop-blur-md md:hidden shrink-0 sticky top-0 z-30">
          <button onClick={() => setOpen(true)} className="p-2 -ml-1.5 rounded-lg hover:bg-muted/60 active:bg-muted text-muted-foreground transition-colors">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold text-sm tracking-tight">{currentSection.label}</span>
        </header>

        {/* Hearth v2 §13.1: the section glow is ground. It sits behind the
            routed region (z -1 inside this `relative isolate` wrapper), in the
            unnamed root view-transition group, so it holds still while a tab
            switch shifts the page and blends into the next section's hue on
            the same timing (globals.css .section-glow). */}
        <div className="relative isolate flex min-h-0 flex-1 flex-col">
          <SectionGlow
            sectionId={currentSection.id}
            driftX={glowDriftX(
              visibleSections.map((s) => s.id),
              currentSection.id
            )}
          />
          {!onSettings && <SectionSubnav section={currentSection} isActive={isActive} />}
          <div
            className="route-transition-region relative isolate flex-1 overflow-y-auto origin-top transition-[transform,filter] duration-[var(--motion-slow)] ease-[var(--motion-ease-out)]"
            style={sheetOpen ? { transform: "scale(0.96)", filter: "brightness(0.85)" } : undefined}
          >
            <DataCacheProvider>
              {/* FLUX-263: activate every Legend store on app open so persisted
                  pending writes replay immediately, not on section-page visit. */}
              <LegendSyncBootstrap />
              <OfflineBanner />
              <RevalidatingIndicator />
              {onSettings ? (
                // Under the top bar the settings menu that lived in the
                // sidebar becomes the settings screens' own left column.
                <div className="md:mx-auto md:flex md:w-full md:max-w-5xl md:gap-2">
                  <nav aria-label="Settings" className="desk-top hidden w-56 shrink-0 flex-col gap-px self-start px-2 pt-8 md:sticky md:top-0 md:flex">
                    <SettingsMenuNav settingsSectionRows={settingsSectionRows} isActive={isActive} compact />
                  </nav>
                  <div className="min-w-0 flex-1">{children}</div>
                </div>
              ) : (
                children
              )}
              {/* Capture sheet: inside DataCacheProvider so it has the active groupId */}
              <CaptureSheet />
              {/* First-run module picker for a new household's owner (.docs/modules.md). */}
              <ModulePicker />
              {/* What's new since this browser last looked (whats-new/README.md). */}
              <WhatsNewDialog />
            </DataCacheProvider>
          </div>
        </div>

        {/* Mobile bottom tab bar with the raised capture "+" in its own slot */}
        {visibleSections.length > 1 && (
          <SectionTabBar
            enabledSections={visibleSections}
            allSections={enabledSections}
            hiddenSectionIds={hiddenSections}
            onChooseForSlot={handleChooseForSlot}
            onReorder={handleReorder}
            currentSectionId={currentSection.id}
            onSelect={handleSectionChange}
            overdueCount={overdueCount}
          />
        )}
      </div>
      {/* Desktop: the roof + docks bottom right; capture and the chat pop up from it. */}
      <DockCaptureFab />
    </div>
    </CaptureProvider>
  );
}
