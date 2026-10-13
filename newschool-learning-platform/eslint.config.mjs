import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Module boundaries from docs/ARCHITECTURE.md §4, enforced rather than hoped for.
const noSupabaseOutsideServer = {
  group: ['@supabase/*', '@/server/*'],
  message:
    'Only server code talks to Supabase. Pages call functions from @/server/queries or @/server/actions.',
};
const noPrivileged = {
  group: ['@/server/privileged/*', '**/privileged/*'],
  message:
    'The privileged (secret-key) module may only be used by server actions and other privileged code.',
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
    'src/server/db.types.ts',
  ]),
  {
    rules: {
      // Content is never rendered as raw HTML (XSS control, docs/SECURITY.md).
      'react/no-danger': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/ui/**', 'src/content/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noSupabaseOutsideServer, noPrivileged] }],
    },
  },
  {
    // Routes may import server queries/actions/auth, but never Supabase or the privileged module.
    files: ['src/app/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@supabase/*'], message: noSupabaseOutsideServer.message },
            noPrivileged,
          ],
        },
      ],
    },
  },
  {
    // Pure domain logic: no I/O, no framework.
    files: ['src/domain/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/server/*',
                '@/app/*',
                '@/ui/*',
                'react',
                'react-dom',
                'next',
                'next/*',
                '@supabase/*',
              ],
              message: 'src/domain is framework-free, pure TypeScript.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/server/queries/**', 'src/server/auth/**', 'src/server/supabase/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noPrivileged] }],
    },
  },
]);
