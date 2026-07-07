import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit suites only — e2e/ belongs to Playwright (npm run test:e2e).
    include: ['src/**/*.test.ts'],
  },
});
