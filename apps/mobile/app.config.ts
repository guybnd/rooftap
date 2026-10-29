import type { ExpoConfig } from 'expo/config';
import { withGradleProperties } from 'expo/config-plugins';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// HOUP-130: APP_VARIANT=development installs alongside the release build as
// a distinct app (own package, name, icon tint) instead of replacing it, so
// a dev-client build tethered to Metro never doubles as the daily-use app.
const IS_DEV = process.env.APP_VARIANT === 'development';

// The Firebase config is not in the public repo. A build without it still
// works, it just has no FCM push. google-services.example.json shows the shape.
const HAS_GOOGLE_SERVICES = existsSync(join(__dirname, 'google-services.json'));

const config: ExpoConfig = {
  name: IS_DEV ? 'Rooftap Dev' : 'Rooftap',
  slug: 'mobile',
  version: '1.1.3',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'mobile',
  userInterfaceStyle: 'automatic',
  // Android window background (via expo-system-ui), seen before the first
  // React frame and behind any screen that hasn't drawn yet. Matches the
  // splash; theme-context.tsx retints it to the active theme at runtime.
  // Native: takes effect from the next APK build.
  backgroundColor: '#030406',
  ios: {
    icon: './assets/expo.icon',
    bundleIdentifier: IS_DEV ? 'com.homeup.mobile.dev' : 'com.homeup.mobile',
  },
  android: {
    package: IS_DEV ? 'com.homeup.mobile.dev' : 'com.homeup.mobile',
    // FCM binding for push (HOUP-154). Release-only: the Firebase project
    // registers com.homeup.mobile; the dev variant has no entry and the
    // google-services plugin fails the build on a missing package.
    ...(IS_DEV || !HAS_GOOGLE_SERVICES ? {} : { googleServicesFile: './google-services.json' }),
    adaptiveIcon: {
      backgroundColor: IS_DEV ? '#FCE3C2' : '#121016',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  // EAS project link (push tokens + EAS builds/updates). Created via
  // `eas init`; safe to commit like any app identifier.
  owner: 'guybnd',
  extra: {
    eas: { projectId: '4a9e9340-0bd0-451a-bfbf-593a88495d82' },
    // The main-branch commit an OTA was built from, set by CI's publish step
    // (.github/workflows/ci.yml). It rides in the update's manifest, so the
    // app reads it with lib/build-info.ts. An inlined EXPO_PUBLIC_ variable
    // does not work here: Metro's transform cache ignores env values and kept
    // serving a screen bundled without it.
    gitSha: process.env.ROOFTAP_GIT_SHA || null,
  },
  // OTA updates (HOUP-168): release builds fetch JS-only bundles from the
  // `production` channel (see eas.json). The dev client (IS_DEV) carries no
  // updates config and keeps loading from Metro.
  //
  // HOUP-294: runtimeVersion is a MANUAL pin, not the fingerprint policy —
  // the fingerprint hashed the prebuild-generated android/ dir in the main
  // tree, so CI and local publishes computed different runtimes and OTAs
  // silently never reached installed builds. Format: <SDK major>.<native rev>.
  // CONTRACT: bump this string whenever native code/deps change (new native
  // module, Expo SDK upgrade, config-plugin change) and ship a fresh APK.
  // JS-only changes must NOT bump it, or existing installs stop receiving OTAs.
  ...(IS_DEV
    ? {}
    : {
        runtimeVersion: '57.6',
        updates: {
          url: 'https://u.expo.dev/4a9e9340-0bd0-451a-bfbf-593a88495d82',
          checkAutomatically: 'ON_LOAD',
          fallbackToCacheTimeout: 0,
          // EAS cloud builds inject the channel automatically from eas.json;
          // locally-built (gradlew) APKs do NOT get one, and without this
          // header the update server can't resolve a branch and 404s every
          // check. Baked here so sideloaded release builds update too.
          requestHeaders: { 'expo-channel-name': 'production' },
        },
      }),
  plugins: [
    'expo-router',
    // Signs release APKs with the private upload key when the build machine
    // has one configured, else with the debug key. See the plugin header.
    './plugins/release-signing',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#030406',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    'expo-sharing',
    // The Assistant asks where the phone is for one "near me" question at a
    // time, only while the app is open. No background location.
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'Rooftap uses your location to find places near you when you ask the Assistant.',
        isAndroidBackgroundLocationEnabled: false,
        isIosBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/images/icon.png',
        color: '#030406',
      },
    ],
    // HOUP-148: Android share-target intake. Single-share filters cover a
    // listing URL/text share and a viewing-invite `.ics`; the multi-share
    // filter covers one-or-more shared screenshots. No `application/pdf`
    // filter — raw PDF-file ingest is HOUP-215, so Rooftap intentionally
    // doesn't appear in the share sheet for a PDF.
    [
      'expo-share-intent',
      {
        androidIntentFilters: ['text/plain', 'image/*', 'text/calendar'],
        androidMultiIntentFilters: ['image/*'],
      },
    ],
    [
      'react-native-android-widget',
      {
        widgets: [
          {
            name: 'TodaysTasks',
            label: "Today's Tasks",
            // HOUP-110: widened from the read-only-tasks-list era (4x2) to fit
            // the summary strip + tasks + groceries sections; resizable up to
            // a larger dashboard-ish size, but never smaller than this floor.
            minWidth: '260dp',
            minHeight: '220dp',
            targetCellWidth: 4,
            targetCellHeight: 3,
            resizeMode: 'horizontal|vertical',
            maxResizeWidth: '400dp',
            maxResizeHeight: '400dp',
            description: "Shows today's Rooftap tasks, cached offline — no network required.",
            previewImage: './assets/images/icon.png',
            updatePeriodMillis: 1800000,
          },
        ],
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: false,
  },
};

// Prebuild writes android/gradle.properties with -Xmx2048m and a 512m
// metaspace; since the SDK 57 patch bump, expo-updates' KSP step and the
// release lint pass run out of metaspace on that and kill the Gradle daemon.
// Set here rather than in android/, which prebuild regenerates every build.
const GRADLE_JVM_ARGS =
  '-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8';

export default withGradleProperties(config, (cfg) => {
  cfg.modResults = cfg.modResults.filter(
    (item) => !(item.type === 'property' && item.key === 'org.gradle.jvmargs'),
  );
  cfg.modResults.push({ type: 'property', key: 'org.gradle.jvmargs', value: GRADLE_JVM_ARGS });
  return cfg;
});
