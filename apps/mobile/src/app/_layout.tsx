// HOUP-68: replaces the create-expo-app starter shell (the old `AppTabs` +
// its expo-router `ThemeProvider`/DarkTheme-DefaultTheme). Root native-stack
// (Expo Router's `Stack` is react-native-screens-backed — this is what gives
// descend/back + edge back-swipe transitions "for free") with a persistent
// `PrimaryTabBar` sibling below it, exactly like the web layout renders
// `SectionTabBar` as a fixed bar alongside routed content rather than as part
// of a tab navigator. `AnimatedSplashOverlay` is kept as-is (unrelated to nav)
// — it owns the `SplashScreen.hideAsync()` call below.
import { AssistantAnswers } from '@/features/assistant/assistant-answers';
import { AssistantChatPopup } from '@/features/assistant/chat-popup';
import '@/global.css';
// HOUP-86: registers apps/mobile's StoreEnvironment (expo-sqlite persist,
// NetInfo/AppState online+reconnect detection) before any Legend-State store
// is used. Side-effect import only — see src/lib/legend/environment.ts.
import '@/lib/legend/environment';
// Where documents-store files live (R2 or Supabase), .docs/r2-storage.md.
import '@/lib/document-storage-env';
import '@/lib/haptics-pref';
import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import { Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { Fredoka_700Bold } from '@expo-google-fonts/fredoka';
import { Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist';
import { GeistMono_600SemiBold } from '@expo-google-fonts/geist-mono';
import { Stack, usePathname } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DialogHost, ToastHost } from '@homeup/ui';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { CaptureProvider } from '@/components/capture/capture-context';
import { CaptureSheet } from '@/components/capture/capture-sheet';
import { DataErrorBanner } from '@/components/data-error-banner';
import { ModulePicker } from '@/components/module-picker';
import { PrimaryTabBar } from '@/components/nav/primary-tab-bar';
import { OfflineBanner } from '@/components/offline-banner';
import { ShareIntentHandler } from '@/components/share-intent-handler';
import { WhatsNewSheet } from '@/components/whats-new/whats-new-sheet';
import { DataCacheProvider } from '@/lib/data-cache';
import { PRE_AUTH_ROUTES } from '@/lib/pre-auth-routes';
import { AppThemeProvider } from '@/lib/theme-context';
import { useAuthAutoRefresh } from '@/lib/use-auth-auto-refresh';
import { useAuthGuard } from '@/lib/use-auth-guard';
import { useModuleRouteGuard } from '@/lib/use-module-route-guard';
import { usePushNotificationRouting } from '@/lib/use-push-notification-routing';
import { useUpdateToasts } from '@/lib/use-update-toasts';
import { useWidgetSync } from '@/widgets/use-widget-sync';

SplashScreen.preventAutoHideAsync();

// Approximate visible height of PrimaryTabBar's own content (icon row + label,
// excluding the safe-area inset it separately pads for) — ToastHost adds the
// safe-area inset itself, so this only needs to clear the tab bar's chrome.
const TAB_BAR_CONTENT_HEIGHT = 58;

// HOUP-106: pushes the Android home-screen widget's snapshot from the live
// householdTasks$ store whenever it changes while the app is foregrounded.
// Mounted here (not per-screen) so it stays alive across the whole app, not
// just the /tasks screen.
function WidgetSync() {
  useWidgetSync();
  return null;
}

// "Update ready" / "App updated" OTA toasts (see use-update-toasts.ts).
// Mounted inside the tree, after fonts load, so ToastHost is already up.
function UpdateToasts() {
  useUpdateToasts();
  return null;
}

// Modules (.docs/modules.md): leaves any screen of a switched-off module.
function ModuleRouteGuard() {
  useModuleRouteGuard();
  return null;
}

// HOUP-69: the picker/login screens are pre-auth — no section content
// exists yet to navigate to, so the persistent tab bar hides on them
// (mirrors the web app's own (auth) route group rendering full-bleed, no
// SectionTabBar).
function useShowTabBar(): boolean {
  return !PRE_AUTH_ROUTES.includes(usePathname());
}

function RouteTabBar() {
  return useShowTabBar() ? <PrimaryTabBar /> : null;
}

function RouteToastHost() {
  return <ToastHost bottomOffset={useShowTabBar() ? TAB_BAR_CONTENT_HEIGHT : 0} />;
}

// Hooks that follow the route live in their own leaf, not in RootLayout:
// a pathname read up there re-rendered the whole shell (sheets, chat pop-up,
// picker, banners) in the same commit as every tab tap, ahead of the slide.
function RootEffects() {
  useAuthAutoRefresh();
  useAuthGuard();
  usePushNotificationRouting();
  return null;
}

export default function RootLayout() {
  // HOUP-170: Hearth's native type foundation — Bricolage Grotesque (heading),
  // Geist (sans), Geist Mono (mono),
  // Fredoka and Fraunces (the Hero number, Sorbet and Lavender only).
  // Blocks the splash (already held by preventAutoHideAsync() above) until
  // these are registered, so no surface flashes stock Roboto for a frame.
  //
  // HOUP-298: one static cut per TYPE_SCALE step (tailwind-preset.js) since
  // native can't vary a single font's weight — 600SemiBold/700Bold/500Medium
  // as needed per step, not just the default family weight.
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    // Hearth v2: the `hero` type step (tailwind-preset.js).
    BricolageGrotesque_800ExtraBold,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_600SemiBold,
    Fraunces_700Bold,
    Fredoka_700Bold,
  });

  return (
    <>
      {/* First and always mounted, so the guards run while fonts load too. */}
      <RootEffects />
      {fontsLoaded || fontError ? <AppShell /> : null}
    </>
  );
}

// Renders once per launch (no props, no route hooks); route-driven pieces
// are leaves (RouteTabBar, RouteToastHost) so a navigation re-renders only them.
function AppShell() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* HOUP-274: a single root-level KeyboardProvider observes the keyboard
          inside every window, including a BottomSheet's own Modal Dialog
          window (Android Modal support since keyboard-controller v1.13.0) —
          no per-Modal nesting needed, unlike GestureHandlerRootView above.
          statusBarTranslucent matches BottomSheet's Modal `statusBarTranslucent`
          prop (bottom-sheet.tsx) so the Android keyboard-height measurement
          doesn't double-count the status bar. */}
      <KeyboardProvider statusBarTranslucent>
        <SafeAreaProvider>
          <AppThemeProvider>
            <DataCacheProvider>
              <CaptureProvider>
                <WidgetSync />
                <UpdateToasts />
                <AssistantAnswers />
                <ModuleRouteGuard />
                <ShareIntentHandler />
                <AnimatedSplashOverlay />
                <OfflineBanner />
                <DataErrorBanner />
                {/* Section roots live one level down in the (tabs) group
                    (src/app/(tabs)/_layout.tsx); detail screens push here. */}
                <Stack screenOptions={{ headerShown: false }} />
                <RouteTabBar />
                <CaptureSheet />
                {/* The pop-up chat that grows out of the + (features/assistant/chat-popup.tsx). */}
                <AssistantChatPopup />
                {/* First-run module picker for a new household's owner
                    (.docs/modules.md): above the tab bar, under the toasts. */}
                <ModulePicker />
                {/* What's new since this device last looked (whats-new/README.md):
                    on Home, after the picker, under the toasts. */}
                <WhatsNewSheet />
                <RouteToastHost />
                <DialogHost />
              </CaptureProvider>
            </DataCacheProvider>
          </AppThemeProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

// HOUP-138: expo-router's per-route ErrorBoundary convention — exporting
// this from the ROOT layout means it's the outermost boundary in the tree,
// catching any render throw that no closer (per-route) boundary handles.
// The (tabs) group layout doesn't export one, so this is still the app's
// only boundary.
export { ErrorBoundary } from '@/components/error-fallback';
