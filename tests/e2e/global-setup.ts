import { createClient } from '@supabase/supabase-js';

// Remove MFA factors left on seed staff accounts by an earlier run, so the MFA
// enrollment test always starts from "not set up". Local/CI databases only.
export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret)
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required');
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
    throw new Error(`Refusing to run E2E setup against a non-local database: ${url}`);
  }

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const user of data?.users ?? []) {
    if (!user.email?.endsWith('@example.com')) continue;
    const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
    for (const factor of factors?.factors ?? []) {
      await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: factor.id });
    }
  }
}
