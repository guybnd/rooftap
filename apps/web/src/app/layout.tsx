import type { CSSProperties } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
// HOUP-73: registers apps/web's StoreEnvironment (browser IndexedDB persist,
// online/visibility detection) before any Legend-State store is used. Must
// run on every route, including ~offline and share-target — import for its
// side effect only, here, not per-route.
import "@/lib/legend/environment";
import { Geist, Geist_Mono, Bricolage_Grotesque, Fraunces, Fredoka } from "next/font/google";
import { cn } from "@/lib/utils";
import { LIGHT_THEME_IDS, SYSTEM_THEME_IDS, THEME_IDS, THEME_PREFERENCE_STORAGE_KEY } from "@homeup/core";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ChunkReload } from "@/components/chunk-reload";
import { PersistentStorage } from "@/components/persistent-storage";
import { sectionHueCss } from "@/lib/section-hue-css";
import { Toaster } from "sonner";
import { DialogHost } from "@/components/ui/dialog-host";
import { DESKTOP_LAYOUT_STORAGE_KEY } from "@/lib/desktop-layout-key";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-heading",
  display: "swap",
});
// Sorbet's Hero number face (globals.css `[data-theme^="sorbet"] .text-hero`).
// Not preloaded, so only a Sorbet theme ever fetches it.
const fredoka = Fredoka({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-hero-sorbet",
  display: "swap",
  preload: false,
});
// Lavender's Hero number face, fetched only under a Lavender theme.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-hero-lavender",
  display: "swap",
  preload: false,
});

// Hearth v2: paints the right theme before first paint (no flash). Mirrors
// ThemeProvider + @homeup/core's resolveThemePreference: a pinned theme id
// wins, anything else ("system", unset, stale) follows the device scheme.
const PINNABLE_THEMES = JSON.stringify(THEME_IDS);
const LIGHT_THEMES = JSON.stringify(LIGHT_THEME_IDS);
const THEME_BOOT_SCRIPT = `try{var p=localStorage.getItem(${JSON.stringify(THEME_PREFERENCE_STORAGE_KEY)}),ids=${PINNABLE_THEMES},light=${LIGHT_THEMES},t=ids.indexOf(p)>=0?p:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?${JSON.stringify(SYSTEM_THEME_IDS.dark)}:${JSON.stringify(SYSTEM_THEME_IDS.light)});document.documentElement.setAttribute("data-theme",t);if(light.indexOf(t)<0)document.documentElement.classList.add("dark");if(localStorage.getItem(${JSON.stringify(DESKTOP_LAYOUT_STORAGE_KEY)})==="classic")document.documentElement.setAttribute("data-layout","classic")}catch(e){}`;

export const metadata: Metadata = {
  title: "Rooftap",
  description: "Welcome home. One calm app for the whole household.",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  // Hearth v2: browser chrome matches the Ember ground for each scheme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F3EF" },
    { media: "(prefers-color-scheme: dark)", color: "#121016" },
  ],
  // Let the browser reflow page content when the on-screen keyboard opens so
  // `dvh` units and bottom-anchored sheets track the shrunken viewport
  // (Chrome/Android). iOS Safari ignores this — the VisualViewport-based
  // useKeyboardInset hook handles that platform.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "font-sans",
        geist.variable,
        geistMono.variable,
        bricolage.variable,
        fredoka.variable,
        fraunces.variable
      )}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_BOOT_SCRIPT,
          }}
        />
        {/* Hearth v2: section identity hues as CSS variables (lib/section-hue-css.ts). */}
        <style dangerouslySetInnerHTML={{ __html: sectionHueCss() }} />
        {process.env.NODE_ENV !== "production" && (
          <script
            dangerouslySetInnerHTML={{
              __html: `if('serviceWorker'in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(sw){sw.unregister();});});caches.keys().then(function(k){k.forEach(function(c){caches.delete(c);});});}`,
            }}
          />
        )}
      </head>
      <body className="antialiased noise-overlay">
        <ChunkReload />
        <PersistentStorage />
        <ThemeProvider>
          <AppSidebar>{children}</AppSidebar>
          {/* Hearth-themed: the toast is the app's own glass card (same as
              native ToastHost), status hues only on the icon, Undo/Edit in
              coral text. Colours come from the theme vars, so a pinned
              Ember Day/Night wins over the OS scheme. */}
          <Toaster
            position="bottom-right"
            // On a desktop the roof + docks bottom right (Hearth §13 "Desktop shell"): toasts stack above it.
            offset={{ bottom: 96, right: 24 }}
            style={
              {
                "--normal-bg": "var(--glass-bg)",
                "--normal-border": "var(--glass-border)",
                "--normal-text": "var(--popover-foreground)",
                "--border-radius": "0.75rem",
              } as CSSProperties
            }
            toastOptions={{
              classNames: {
                toast: "!shadow-md !font-sans",
                description: "!text-muted-foreground",
                success: "[&_[data-icon]]:text-success",
                error: "[&_[data-icon]]:text-destructive",
                actionButton: "!bg-transparent !text-primary !font-semibold !px-1",
                cancelButton: "!bg-transparent !text-muted-foreground",
              },
            }}
          />
          <DialogHost />
        </ThemeProvider>
      </body>
    </html>
  );
}
