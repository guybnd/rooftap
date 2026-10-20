import { defineConfig } from 'vitest/config';

// HOUP-68: covers the token-bridge (oklch -> RGB triplet, theme-vars caching)
// with plain Node-runnable unit tests. Full component render/snapshot
// coverage across RNW + native (the plan's "Cross-platform render" test)
// needs the jest-expo/Metro preset to resolve `react-native` correctly and
// isn't wired here — see the HOUP-68 completion notes for that follow-up.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
