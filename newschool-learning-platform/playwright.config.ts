import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against a production build (`next start`) so the real
// CSP, cookies and headers are exercised. Requires a running local Supabase.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const PORT = 3000;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // No colour transitions: an accessibility scan right after a click would
    // otherwise measure a button half-way between its two colours.
    contextOptions: { reducedMotion: 'reduce' },
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    command: `pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    // Lists read in pages (src/server/queries/paging.ts) use pages of 3 rows
    // here, so the small seed exercises the paging that school-scale data
    // needs past PostgREST's 1,000-row cap. Ignored in staging and production.
    env: { FETCH_PAGE_SIZE: '3' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
