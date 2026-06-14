import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.{test,spec}.{ts,tsx}', 'apps/*/src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    server: {
      deps: {
        inline: ['react-native', '@react-navigation', 'react-native-gesture-handler', 'react-native-reanimated', 'react-native-screens', 'react-native-safe-area-context'],
      },
    },
    alias: {
      'react-native': new URL('./packages/ui/src/__mocks__/react-native.ts', import.meta.url).pathname,
    },
  },
});
