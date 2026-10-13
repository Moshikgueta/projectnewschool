import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Page-level timings against the local stack loaded with scripts/perf/seed-scale.sql
// (docs/PERFORMANCE.md). Not part of `pnpm test` or `pnpm test:api`.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['scripts/perf/**/*.perf.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
