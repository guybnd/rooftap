# Rooftap mobile (Expo)

The Android/iOS app. Shared logic lives in `packages/core`, shared UI in
`packages/ui`; this workspace holds screens and platform glue only (see the
platform-parity contract in the root `CLAUDE.md`).

## Layout

- `src/app/` is the Expo Router tree. Tabbed sections live under
  `src/app/(tabs)/<section>/`; full-screen routes (login, server picker,
  settings, detail pages) sit beside it.
- `src/features/<section>/` holds section components and hooks used by those
  screens. `src/components/` is cross-section UI not yet promoted to
  `packages/ui`. `src/lib/` is app-level glue (server config, sync, auth).
- `src/widgets/` is the Android home-screen widget.

## Checks

```bash
npm run typecheck -w mobile
npm run test -w mobile
```

`test` first runs `scripts/check-router-dir.mjs`: **never put a test file under
`src/app/`**. Expo Router bundles every file there into the native build, and a
test file breaks every Android build (see that script's header). Tests are
vitest in a node environment, logic only; mock native modules per test.

## Builds and updates

- JS-only changes ship as an EAS OTA update from CI on merge to `main`.
- A new or changed native dependency changes the runtime fingerprint and needs
  a fresh APK. Local builds go through `scripts/build-android.ps1` (Windows);
  cloud builds use `npx eas-cli build --profile preview`.
- Agents: don't run Gradle, `expo prebuild` or device installs yourself; state
  the on-device step in the ticket or PR (see the root `CLAUDE.md`).
