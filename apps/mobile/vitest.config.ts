import { defineConfig } from 'vitest/config';

// HOUP-96: apps/mobile had no test runner at all. Pure-logic-only, same as
// packages/core/ui's own configs — full RN component rendering would need
// the jest-expo/Metro preset to resolve `react-native` correctly, which
// isn't wired here (see packages/ui/vitest.config.ts for that same
// tradeoff). Native modules (NetInfo, AppState, expo-sqlite/kv-store) are
// mocked per-test instead.
export default defineConfig({
  test: {
    environment: 'node',
    // First test to import environment.ts pays the cold-start transform cost
    // of its full dependency chain (@homeup/core -> @supabase/supabase-js,
    // @legendapp/state) — the default 5s testTimeout flaked on that one.
    testTimeout: 15000,
  },
});
