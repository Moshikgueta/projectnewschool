import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// API-level tests against a running local Supabase (`pnpm db:start`).
// Locally the values come from .env.local; in CI from the environment.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
