// Entry for the screen demo (see vite.config.mjs): mounts the app shell and
// the scene's page with the seeded household.
/// <reference types="vite/client" />
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ALL_MODULE_IDS, setAvailableModules, setModuleRows, THEME_PREFERENCE_STORAGE_KEY } from "@homeup/core";
import "../../src/app/globals.css";
import { sectionHueCss } from "../../src/lib/section-hue-css";
import { AppSidebar } from "../../src/components/app-sidebar";
import { ThemeProvider } from "../../src/components/theme-provider";
import { installFetchShim } from "./fetch-shim";
import { findScene, livePage, SCENES } from "./scenes";
import { navigate, setDemoRoute, useDemoRoute } from "./route";

declare global {
  interface Window {
    __demo?: { scene: string; scenes: string[]; actions: unknown[]; marks: Record<string, string | [string, number]> };
  }
}

const params = new URLSearchParams(location.search);
const scene = findScene(params.get("scene"));
/** The live demo: people tap through the pages, and their changes stay until they reload. */
const live = params.has("live");

installFetchShim();
localStorage.clear();
// ?theme= pins the theme; without it the demo follows the device, as the app does.
if (params.get("theme")) localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, params.get("theme")!);
scene.prepare?.();
setDemoRoute({ path: scene.path, search: "", params: scene.params ?? {} });
// Every module is on, and the server offers them all.
setModuleRows(ALL_MODULE_IDS.map((id) => ({ group_id: "demo-home", module_id: id, enabled: true, updated_by: null, updated_at: "" })));
setAvailableModules(null);
window.__demo = { scene: scene.id, scenes: SCENES.map((s) => s.id), actions: scene.actions ?? [], marks: scene.marks ?? {} };

const hues = document.createElement("style");
hues.textContent = sectionHueCss();
document.head.appendChild(hues);

// The live demo opens on Home with the first-run tips already read.
if (live) localStorage.setItem("homeup_shopping_tooltip_dismissed", "1");

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

const Page = live ? LivePage : scene.page;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AppSidebar>
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      </AppSidebar>
    </ThemeProvider>
  </StrictMode>
);
