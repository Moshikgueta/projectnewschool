import 'server-only';
import { z } from 'zod';

// Public configuration, validated once. The app refuses to run with a missing
// or malformed value instead of failing later in some request.
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url(),
  APP_ENV: z.enum(['local', 'preview', 'staging', 'production']).default('local'),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cached: PublicEnv | undefined;

export function getEnv(): PublicEnv {
  cached ??= publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    APP_ENV: process.env.APP_ENV,
  });
  return cached;
}

export function isProductionLike(): boolean {
  const { APP_ENV } = getEnv();
  return APP_ENV === 'staging' || APP_ENV === 'production';
}
