import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Screen render tests (src/test/*.screen.test.tsx): the real phone screens on
// react-native-web in jsdom, with native modules stubbed (src/test/screen-setup.tsx)
// and rows served through the real stores (src/test/render-screen.tsx). The
// pure-logic suite stays on vitest.config.ts.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: 'react-native-web' },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, 'src/$1') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.screen.test.tsx'],
    setupFiles: ['src/test/screen-setup.tsx'],
    // The first screen pays the cold transform of react-native-web, the UI kit and core.
    testTimeout: 30000,
  },
});
