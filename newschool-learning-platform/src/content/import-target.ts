// Where `pnpm content:import` may write (scripts/content.ts). Pure, so the
// rules are unit-tested.
//
//   * local (http://127.0.0.1 or localhost): always.
//   * staging: APP_ENV=staging and --confirm=<host of the URL>.
//   * production: APP_ENV=production, --production and --confirm=<host>. Run
//     by the operator from their own machine with the secret key in their
//     environment, never from a file in the repository (docs/GO-LIVE.md).
//     Before the pilot release (ADR-040) production was refused outright.

export type ImportTarget = { url: string; secret: string; env: 'local' | 'staging' | 'production' };

export function decideImportTarget(input: {
  url: string;
  secret: string;
  appEnv: string | undefined;
  argv: readonly string[];
}): ImportTarget {
  const { url, secret, argv } = input;
  const appEnv = input.appEnv || 'local';
  if (!url || !secret)
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required');

  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url);
  if (local) {
    if (appEnv === 'production')
      throw new Error('APP_ENV=production with a local database URL: check the environment.');
    return { url, secret, env: 'local' };
  }

  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error();
    host = parsed.host;
  } catch {
    throw new Error(`Not an https URL: ${url}`);
  }
  const confirm = argv.find((a) => a.startsWith('--confirm='))?.slice('--confirm='.length);

  if (appEnv === 'staging' && confirm === host) return { url, secret, env: 'staging' };
  if (appEnv === 'production' && argv.includes('--production') && confirm === host)
    return { url, secret, env: 'production' };

  throw new Error(
    appEnv === 'production'
      ? `Refusing to import into production (${url}) without --production --confirm=${host}.`
      : `Refusing to import into ${url}. For staging set APP_ENV=staging and pass --confirm=${host}; for production see docs/GO-LIVE.md.`,
  );
}
