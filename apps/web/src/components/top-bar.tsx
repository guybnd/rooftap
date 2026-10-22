"use client";

// Hearth §13 "Desktop shell": the wide-screen top bar. Every visible space
// sits in one row as its glyph in its identity hue (H2 navigation exception),
// each in a fixed slot so nothing shifts: the active space's name sits
// underneath its glyph (globals.css .topbar-label), and a hovered or focused
// one names itself in a tooltip under the bar (Guy, 2026-10-22: a second name
// inside the bar ran into its neighbours).
// The active slot rides the same gliding pebble as the phone tab bar (§8 "Tab
// glide"), drawn horizontally on the page's Shift clock. Settings and the
// profile menu sit at the right end. The roof + docks bottom right instead
// (capture-buttons.tsx DockCaptureFab), and a space's own pages (Item Library,
// Templates) show as a row of links under the bar (SectionSubnav).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { LogOut, Settings, User } from "lucide-react";
import { clearThreadCache, openAssistantPopup, sectionHue, setAssistantCounts, useAssistantPending, type Section } from "@homeup/core";
import { assistantApi } from "@/lib/assistant-client";
import { PromptBadge } from "@/components/ui/prompt-badge";
import { cn } from "@/lib/utils";
import { sectionIcons } from "@/lib/section-icons";
import { RooftapMark } from "@/components/brand/rooftap-mark";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { TabGlide, type TabGlideTarget } from "@/components/ui/tab-glide";
import { TabDrip, type TabDripState } from "@/components/ui/tab-drip";
import { PopMenu } from "@/app/setup/pop-menu";

export interface TopBarUser {
  name: string;
  avatarUrl: string | null;
}

export function TopBar({
  sections,
  currentSectionId,
  onSelect,
  overdueCount,
  user,
  onSettings,
}: {
  sections: Section[];
  currentSectionId: string;
  onSelect: (sectionId: string) => void;
  overdueCount: number;
  user: TopBarUser | null;
  /** Whether a settings screen is open (the gear then reads as current). */
  onSettings: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const tabRef = useCallback(
    (id: string) => (el: HTMLButtonElement | null) => {
      if (el) tabRefs.current.set(id, el);
      else tabRefs.current.delete(id);
    },
    []
  );
  const active = sections.some((s) => s.id === currentSectionId) && !onSettings ? currentSectionId : null;
  const [glideTarget, setGlideTarget] = useState<TabGlideTarget | null>(null);
  // Changes waiting on your OK mark the Assistant's icon (Guy, 2026-10-22).
  // The count comes from the status route: on load, when the tab comes back,
  // and every few minutes; the chat refreshes it after each decision.
  const hasAssistant = sections.some((s) => s.id === "assistant");
  const assistantPending = useAssistantPending();
  useEffect(() => {
    if (!hasAssistant) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void assistantApi.status().then(setAssistantCounts).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 3 * 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [hasAssistant]);
  const headerRef = useRef<HTMLElement>(null);
  // The chip keeps its last place while it fades out.
  const [tip, setTip] = useState<TabDripState>({ label: "", x: 0, y: 0, w: 0, h: 0, hue: "", on: false, seq: 0, slide: false });
  const showTip = (label: string, hue: string, el: HTMLElement) => {
    const header = headerRef.current;
    if (!header) return;
    const r = el.getBoundingClientRect();
    const hr = header.getBoundingClientRect();
    setTip((t) => ({
      label,
      hue,
      x: r.left - hr.left,
      y: r.top - hr.top,
      w: r.width,
      h: r.height,
      on: true,
      seq: t.on ? t.seq : t.seq + 1,
      slide: t.on,
    }));
  };
  const hideTip = () => setTip((t) => ({ ...t, on: false }));
  const keys = sections.map((s) => s.id).join(",");
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => {
      const tab = active ? tabRefs.current.get(active) : undefined;
      if (!tab) {
        setGlideTarget(null);
        return;
      }
      const box = bar.getBoundingClientRect();
      const r = tab.getBoundingClientRect();
      const next = { cx: r.left - box.left + r.width / 2, cy: r.top - box.top + r.height / 2 };
      setGlideTarget((prev) => (prev && prev.cx === next.cx && prev.cy === next.cy ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [active, keys]);

  // The space just arrived at pops its glyph once (not on first paint).
  const [arrival, setArrival] = useState<{ key: string | null; popped: string | null }>({ key: active, popped: null });
  if (arrival.key !== active) setArrival({ key: active, popped: active });

  return (
    <header ref={headerRef} className="desk-top relative z-30 hidden h-16 shrink-0 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur-md md:flex lg:px-6">
      <Link
        href="/home"
        aria-label="Rooftap home"
        className="flex shrink-0 items-center gap-2 rounded-lg pr-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RooftapMark spectrum className="h-6 w-6" />
        <span className="cap-inscription hidden font-heading text-[17px] font-semibold tracking-tight xl:inline">Rooftap</span>
      </Link>

      <nav aria-label="Spaces" className="flex min-w-0 flex-1 justify-center overflow-x-auto [scrollbar-width:none]">
        <div ref={barRef} className="topbar-tabs relative flex items-stretch">
          <TabGlide target={glideTarget} hue={active ? sectionHue(active) : undefined} />
          {sections.map((section) => {
            const Icon = sectionIcons[section.iconId];
            const current = section.id === active;
            const showBadge = overdueCount > 0 && section.navItems.some((i) => i.badge === "overdueTasks");
            const waiting = section.id === "assistant" ? assistantPending : 0;
            return (
              <button
                key={section.id}
                ref={tabRef(section.id)}
                type="button"
                data-hue={sectionHue(section.id)}
                aria-current={current ? "page" : undefined}
                aria-label={
                  showBadge
                    ? `${section.label}, ${overdueCount} overdue`
                    : waiting > 0
                      ? `${section.label}, ${waiting} waiting on your OK`
                      : section.label
                }
                // The Assistant is a docked pop-up chat here, not a page (Guy, 2026-10-22).
                onClick={() => (section.id === "assistant" && openAssistantPopup()) || onSelect(section.id)}
                onPointerEnter={(e) => !current && e.pointerType === "mouse" && showTip(section.label, sectionHue(section.id), e.currentTarget)}
                onPointerLeave={hideTip}
                onFocus={(e) => !current && e.currentTarget.matches(":focus-visible") && showTip(section.label, sectionHue(section.id), e.currentTarget)}
                onBlur={hideTip}
                className={cn(
                  "topbar-tab relative flex h-12 w-11 shrink-0 flex-col items-center pt-1.5 transition-[scale] duration-[var(--motion-base)] ease-[var(--motion-ease-out)] focus-visible:outline-none active:scale-[0.94] lg:w-[52px]",
                  current ? "text-[var(--hue-glyph)]" : "text-muted-foreground"
                )}
              >
                <span className="relative flex h-6 items-center justify-center">
                  <Icon
                    className={cn(
                      "h-5 w-5 text-[var(--hue-glyph)] transition-[scale] duration-[var(--motion-fast)]",
                      arrival.popped === section.id && "tab-arrive"
                    )}
                  />
                  {showBadge && (
                    <span className="absolute -right-2.5 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-white">
                      {overdueCount}
                    </span>
                  )}
                  {!showBadge && <PromptBadge count={waiting} className="-right-2.5 -top-1" />}
                </span>
                {current && (
                  <span aria-hidden className="topbar-label pointer-events-none absolute left-1/2 top-[30px] whitespace-nowrap text-[11px] font-semibold leading-none">
                    {section.shortLabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
      {/* The hovered space's name pops out under the bar, where it has room. */}
      <TabDrip state={tip} />

      <div className="flex shrink-0 items-center gap-1">
        <Link
          href="/settings"
          aria-label="Settings"
          aria-current={onSettings ? "page" : undefined}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            onSettings ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <Settings className="h-5 w-5" />
        </Link>
        <PopMenu
          align="right"
          width="w-64"
          triggerLabel={user ? `${user.name}, account` : "Account"}
          triggerClassName="flex h-10 w-10 items-center justify-center rounded-full hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          trigger={<Avatar user={user} size={28} />}
        >
          {() => (
            <>
              {user && (
                <div className="flex items-center gap-3 px-3.5 pb-2 pt-2.5">
                  <Avatar user={user} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-popover-foreground">{user.name}</span>
                </div>
              )}
              <ThemeSwitcher compact />
              <div className="my-1 h-px bg-border/60" />
              <form action="/logout" method="POST" onSubmit={clearThreadCache}>
                <button
                  type="submit"
                  role="menuitem"
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13px] font-medium text-popover-foreground transition-colors hover:bg-accent/60"
                >
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                  Sign out
                </button>
              </form>
            </>
          )}
        </PopMenu>
      </div>
    </header>
  );
}

function Avatar({ user, size }: { user: TopBarUser | null; size: number }) {
  if (user?.avatarUrl) {
    return (
      <Image
        src={user.avatarUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-secondary" style={{ width: size, height: size }}>
      <User className="h-4 w-4 text-muted-foreground" />
    </span>
  );
}

/**
 * A space's own pages (Groceries' Item Library, Checklists' Templates, Home
 * Search's map and viewings) as one row of links under the top bar. Spaces
 * with a single page show nothing.
 */
export function SectionSubnav({ section, isActive }: { section: Section; isActive: (href: string) => boolean }) {
  if (section.navItems.length < 2) return null;
  // The most specific match wins, so /groceries doesn't also light on /groceries/shelf-life.
  const current = section.navItems
    .filter((i) => isActive(i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label={`${section.label} pages`} className="desk-top hidden shrink-0 justify-center px-4 pt-3 md:flex">
      <div className="flex gap-1 overflow-x-auto rounded-full bg-secondary/70 p-1 [scrollbar-width:none]">
        {section.navItems.map((item) => {
          const on = item.href === current;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              aria-current={on ? "page" : undefined}
              className={cn(
                "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
