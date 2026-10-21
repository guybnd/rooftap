# Rooftap mobile (Expo)

This workspace is the Android and iOS app. Shared logic lives in `packages/core`, and shared UI lives in `packages/ui`. This workspace holds the screens and the platform code only. A screen change lands on web and mobile together.

## Layout

- `src/app/` is the Expo Router tree. Tabbed sections live under `src/app/(tabs)/<section>/`. Full-screen routes (login, server picker, settings, detail pages) sit beside it.
- `src/features/<section>/` holds the section components and hooks for those screens.
- `src/components/` holds UI that more than one section uses and that is not in `packages/ui` yet.
- `src/lib/` holds app-level code: server config, sync and auth.
- `src/widgets/` is the Android home-screen widget.

## Checks

```bash
npm run typecheck -w mobile
npm run test -w mobile
```

`test` first runs `scripts/check-router-dir.mjs`. **Never put a test file under `src/app/`.** Expo Router bundles every file there into the native build, so a test file there breaks every Android build. The script header explains the details. Tests run in vitest in a node environment and test logic only. Mock native modules in each test.

## Builds and updates

- A change to JavaScript only ships as an EAS update when it merges to `main`.
- A new or changed native dependency changes the runtime fingerprint. It needs a new APK: `npx eas-cli build --profile preview`.
- A local release build signs the APK with the key in the Gradle properties `ROOFTAP_UPLOAD_STORE_FILE`, `ROOFTAP_UPLOAD_STORE_PASSWORD`, `ROOFTAP_UPLOAD_KEY_ALIAS` and `ROOFTAP_UPLOAD_KEY_PASSWORD`. Put them in `~/.gradle/gradle.properties`, outside the repo. Without them the build uses the public debug key. That APK works, but it cannot update or be updated by an APK signed with another key.
