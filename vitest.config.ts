import { defineConfig } from 'vitest/config';

// Root Vitest config. Runs every package's unit/property tests in a single pass.
// Playwright e2e tests live in packages/web/e2e and are excluded here; they run
// via the dedicated `e2e` script.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.{test,spec}.ts', 'packages/*/src/**/*.{test,spec}.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', 'packages/web/e2e/**'],
  },
});
