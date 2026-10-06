import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

export const PASSWORD = 'Local-dev-password-1'; // supabase/seed.sql — local only

export const USERS = {
  studentA: 'student.a@example.com',
  studentB: 'student.b@example.com',
  studentC: 'student.c@example.com',
  studentD: 'student.d@example.com',
  office: 'office@example.com',
  teacherX: 'teacher.x@example.com',
  teacherY: 'teacher.y@example.com',
  manager: 'manager@example.com',
  admin: 'admin@example.com',
} as const;

export const IDS = {
  attemptOfA: 'c0000000-0000-4000-8000-000000000001',
  attemptOfB: 'c0000000-0000-4000-8000-000000000002',
  groupX: 'a0000000-0000-4000-8000-000000000001',
  groupY: 'a0000000-0000-4000-8000-000000000002',
  /** Spanish L1, published, group X's active cycle. */
  sectionHola: '60000000-0000-4000-8000-000000000001',
  /** Spanish L1, draft. */
  sectionDraft: '60000000-0000-4000-8000-000000000002',
  /** French L1, published. */
  sectionBonjour: '60000000-0000-4000-8000-000000000003',
  /** Spanish L1 workbook section that embeds the every-type exercise. */
  sectionPractica: '60000000-0000-4000-8000-000000000005',
  /** Spanish L1 exercise with one item of every type. */
  activityAllTypes: '70000000-0000-4000-8000-000000000006',
  studentA: '00000000-0000-4000-8000-0000000000a1',
  studentB: '00000000-0000-4000-8000-0000000000a2',
} as const;

/** Service-role client for test setup and for checking what was stored. Local only. */
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url))
    throw new Error(`Not a local database: ${url}`);
  return createClient(url, process.env.SUPABASE_SECRET_KEY ?? '', {
    auth: { persistSession: false },
  });
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — what an authenticator app computes. */
export function totp(base32Secret: string, now = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of base32Secret.replace(/=+$/, '').toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

/** Authenticator secrets enrolled during this run, shared between test files. */
export const MFA_SECRETS_FILE = join(tmpdir(), 'newschool-e2e-mfa-secrets.json');

function readSecrets(): Record<string, string> {
  return existsSync(MFA_SECRETS_FILE) ? JSON.parse(readFileSync(MFA_SECRETS_FILE, 'utf8')) : {};
}

/**
 * Complete two-step verification on /account/mfa, enrolling an authenticator
 * on first use in this run and verifying with it afterwards.
 */
export async function passMfa(page: Page, email: string) {
  await expect(page).toHaveURL(/\/account\/mfa/);
  const secrets = readSecrets();
  const setUp = page.getByRole('button', { name: 'Set up authenticator app' });
  // Wait for the page to show one or the other before deciding.
  await expect(setUp.or(page.getByLabel('6-digit code'))).toBeVisible();
  if (await setUp.isVisible()) {
    await setUp.click();
    const secret = (await page.locator('code').innerText()).trim();
    writeFileSync(MFA_SECRETS_FILE, JSON.stringify({ ...secrets, [email]: secret }));
    await page.getByLabel('6-digit code').fill(totp(secret));
  } else {
    const secret = secrets[email];
    if (!secret) throw new Error(`No authenticator secret recorded for ${email} in this run`);
    // A code is accepted once: if this account already used the current
    // 30-second code in this run, wait for the next one.
    const used = Number(secrets[`${email}#step`] ?? -1);
    while (Math.floor(Date.now() / 30_000) <= used) await page.waitForTimeout(1_000);
    await page.getByLabel('6-digit code').fill(totp(secret));
  }
  writeFileSync(
    MFA_SECRETS_FILE,
    JSON.stringify({
      ...readSecrets(),
      [`${email}#step`]: String(Math.floor(Date.now() / 30_000)),
    }),
  );
  await page.getByRole('button', { name: 'Verify' }).click();
}
