import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite — drives the real app against the LOCAL Supabase stack.
 *
 * Prerequisites (see TESTING.md):
 *   npm run dev:up        # local Supabase (Podman/Docker) + migrations + seed
 *   npm run test:e2e      # starts `next dev` itself via webServer below
 *
 * The specs read .env.local for the ingest secret, and several assert against
 * rows from supabase/seed.sql — a reset stack (`npm run dev:reset`) gives the
 * cleanest run, but specs are written to survive re-runs without one.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
