// Entry for the screen demo (see vite.config.mjs): mounts the app shell and
// the scene's page with the seeded household.
/// <reference types="vite/client" />
import { Component, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ALL_MODULE_IDS, setAvailableModules, setModuleRows, THEME_PREFERENCE_STORAGE_KEY } from "@homeup/core";
import "../../src/app/globals.css";
import { sectionHueCss } from "../../src/lib/section-hue-css";
import { AppSidebar } from "../../src/components/app-sidebar";
import { ThemeProvider } from "../../src/components/theme-provider";
import { installFetchShim } from "./fetch-shim";
import { seedLiveExtras } from "./live-extras";
import { findScene, livePage, SCENES } from "./scenes";
import { navigate, setDemoRoute, useDemoRoute } from "./route";

declare global {
  interface Window {
    __demo?: { scene: string; scenes: string[]; actions: unknown[]; marks: Record<string, string | [string, number]> };
    /** A host page that cannot set the query (a sandboxed preview) passes it here instead. */
    __demoSearch?: string;
  }
}

const RELOAD_KEY = "demo-reload-path";
const RELOAD_AT_KEY = "demo-reload-at";

const params = new URLSearchParams(window.__demoSearch ?? location.search);
const scene = findScene(params.get("scene"));
/** The live demo: people tap through the pages, and their changes stay until they reload. */
const live = params.has("live");

installFetchShim();
localStorage.clear();
// ?theme= pins the theme; without it the demo follows the device, as the app does.
if (params.get("theme")) localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, params.get("theme")!);
scene.prepare?.();
if (live) seedLiveExtras();
setDemoRoute({ path: scene.path, search: "", params: scene.params ?? {} });
// A reload after a stale page file (see PageBoundary) comes back to that page.
if (live) {
  try {
    const reloadedTo = sessionStorage.getItem(RELOAD_KEY);
    sessionStorage.removeItem(RELOAD_KEY);
    if (reloadedTo && reloadedTo !== scene.path) navigate(reloadedTo);
  } catch {
    // Storage is blocked: the demo opens on Home.
  }
}
// Every module is on, and the server offers them all.
setModuleRows(ALL_MODULE_IDS.map((id) => ({ group_id: "demo-home", module_id: id, enabled: true, updated_by: null, updated_at: "" })));
setAvailableModules(null);
window.__demo = { scene: scene.id, scenes: SCENES.map((s) => s.id), actions: scene.actions ?? [], marks: scene.marks ?? {} };

const hues = document.createElement("style");
hues.textContent = sectionHueCss();
document.head.appendChild(hues);

// The live demo opens on Home with the first-run tips already read.
if (live) localStorage.setItem("homeup_shopping_tooltip_dismissed", "1");

/**
 * The live demo points at the roof button until someone first presses it:
 * a ring pulses out of it and a label says the hold opens the Assistant.
 */
if (live) {
  const roof = 'button[aria-label^="Add (hold"]';
  const hint = document.createElement("style");
  hint.textContent = `
    @keyframes demo-roof-pulse { 0% { opacity: .7; transform: scale(1); } 100% { opacity: 0; transform: scale(1.9); } }
    @keyframes demo-roof-bob { 0%, 100% { translate: -50% 0; } 50% { translate: -50% -3px; } }
    html:not(.demo-roof-found) ${roof}::after {
      content: ""; position: absolute; inset: 0; border-radius: 9999px; pointer-events: none;
      box-shadow: 0 0 0 3px var(--primary); animation: demo-roof-pulse 1.6s cubic-bezier(.2,.7,.3,1) infinite;
    }
    html:not(.demo-roof-found) ${roof}::before {
      content: "Hold to ask Rooftap"; position: absolute; left: 50%; bottom: calc(100% + 14px); white-space: nowrap; pointer-events: none;
      padding: 6px 12px; border-radius: 9999px; background: var(--foreground); color: var(--background);
      font: 600 12px/1.2 var(--font-sans, system-ui); box-shadow: 0 6px 18px rgb(0 0 0 / .18);
      animation: demo-roof-bob 2.4s ease-in-out infinite;
    }
    @media (prefers-reduced-motion: reduce) { ${roof}::after, ${roof}::before { animation: none !important; } }
  `;
  document.head.appendChild(hint);

  // An empty chat lists asks the demo has answers for; a tap sends one.
  const STARTERS = ["Add milk and bread to the list", "What can we cook tonight?", "Turn off the lights", "What's on this week?"];
  const chips = document.createElement("style");
  chips.textContent = `
    .demo-starters { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; padding: 0 4px 24px; }
    .demo-starters button { padding: 8px 14px; border-radius: 9999px; border: 1px solid var(--border); background: var(--card); color: var(--foreground); font: 500 14px/1.2 var(--font-sans, system-ui); }
  `;
  document.head.appendChild(chips);
  const ask = (from: Element, text: string) => {
    let box: Element | null = from;
    while (box && !box.querySelector("form textarea")) box = box.parentElement;
    const field = box?.querySelector<HTMLTextAreaElement>("form textarea");
    if (!field) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    // After React has the text, so the form's submit sends it.
    setTimeout(() => field.form?.requestSubmit(), 30);
  };
  new MutationObserver(() => {
    // React does not know the row, so it goes when the empty state does.
    for (const row of document.querySelectorAll(".demo-starters")) {
      if (!row.previousElementSibling?.textContent?.startsWith("Ask about tasks")) row.remove();
    }
    for (const p of document.querySelectorAll("p")) {
      if (!p.textContent?.startsWith("Ask about tasks") || p.nextElementSibling?.classList.contains("demo-starters")) continue;
      const row = document.createElement("div");
      row.className = "demo-starters";
      for (const text of STARTERS) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.onclick = () => ask(p, text);
        row.append(b);
      }
      p.after(row);
    }
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("pointerdown", (e) => {
    if ((e.target as Element | null)?.closest?.(roof)) document.documentElement.classList.add("demo-roof-found");
  });
}

/** In the live demo, a tap on an in-app link moves the demo's route instead of the frame. */
if (live) {
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      const href = a?.getAttribute("href");
      if (!href || !href.startsWith("/") || e.defaultPrevented) return;
      e.preventDefault();
      navigate(href);
    }
    // Bubble phase: a link whose own handler already moved the router has prevented the default.
  );
}

function LivePage() {
  const { path } = useDemoRoute();
  const Page = livePage(path);
  if (!Page) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-8 text-center text-muted-foreground">
        <p>
          This page is not in the demo.{" "}
          <a href="/home" className="font-medium text-primary">
            Back to Home
          </a>
        </p>
      </div>
    );
  }
  return <Page key={path} />;
}

/**
 * Each demo page is its own file, loaded when someone first opens it. After
 * the site is published again those file names change, so a demo left open
 * from before asks for a file that is gone. That reloads the demo once, back
 * on the same page. Any other error shows a note in place of the page, so the
 * rest of the demo keeps working.
 */
class PageBoundary extends Component<{ path: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/dynamically imported module|importing a module script|error loading dynamically/i.test(message)) return;
    try {
      // Once a minute at most, so a file that is really missing cannot loop.
      if (Date.now() - Number(sessionStorage.getItem(RELOAD_AT_KEY) ?? 0) < 60_000) return;
      sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
      sessionStorage.setItem(RELOAD_KEY, this.props.path);
    } catch {
      return;
    }
    location.reload();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-[60vh] place-items-center p-8 text-center text-muted-foreground">
        <p>
          This page did not load.{" "}
          <button type="button" className="font-medium text-primary" onClick={() => location.reload()}>
            Reload the demo
          </button>
        </p>
      </div>
    );
  }
}

function Boundary({ children }: { children: ReactNode }) {
  const { path } = useDemoRoute();
  // A new page starts with a fresh boundary.
  return (
    <PageBoundary key={path} path={path}>
      {children}
    </PageBoundary>
  );
}

const Page = live ? LivePage : scene.page;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AppSidebar>
        <Boundary>
          <Suspense fallback={null}>
            <Page />
          </Suspense>
        </Boundary>
      </AppSidebar>
    </ThemeProvider>
  </StrictMode>
);
