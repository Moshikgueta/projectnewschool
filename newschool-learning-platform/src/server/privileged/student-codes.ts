import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  afterMiss,
  CODE_LENGTH,
  generateCode,
  isThrottled,
  normalizeCode,
  type AttemptRow,
} from '@/domain/auth/codes';
import { isRole } from '@/domain/auth/access';
import { createPrivilegedClient } from './admin-client';

// Student entry codes (docs/STAFF-ROOM-MERGE.md, stage B). The tables have no
// grants for signed-in users at all, so everything goes through here, after
// the calling action has made its own checks.

// SECRET, server only. The same value as the staff room's Worker secret, so
// imported code hashes keep working. Without it there are no codes at all:
// failing closed beats hashing with an empty pepper.
const pepperSchema = z.string().min(32, 'STUDENT_CODE_PEPPER is missing or too short');

/** SHA-256 hex of pepper + "$" + code: the staff room's scheme, unchanged. */
export function codeHash(normalized: string): string {
  const pepper = pepperSchema.parse(process.env.STUDENT_CODE_PEPPER);
  return createHash('sha256').update(`${pepper}$${normalized}`).digest('hex');
}

/**
 * Whether the account may sign in with a code: a student and nothing else.
 * Staff powers need a password and, beyond teaching, a second factor, so a
 * code must never open a staff account.
 */
export async function isStudentOnly(userId: string): Promise<boolean> {
  const { data } = await createPrivilegedClient()
    .from('user_roles')
    .select('role')
    .eq('user_id', userId);
  const roles = (data ?? []).map((r) => r.role).filter(isRole);
  return roles.length > 0 && roles.every((r) => r === 'student');
}

/**
 * A new code for the student, replacing any earlier one (one live code per
 * student). Returns the code itself: the only time it exists readably.
 * The caller has checked that the issuer may do this.
 */
export async function issueCode(studentId: string, issuedBy: string): Promise<string> {
  const client = createPrivilegedClient();
  // A clash with another student's hash is astronomically unlikely, but the
  // unique index would refuse it, so draw again rather than fail.
  for (let tries = 0; tries < 3; tries++) {
    const code = generateCode((n) => randomBytes(n));
    const { error } = await client.from('student_codes').upsert(
      {
        user_id: studentId,
        code_hash: codeHash(code),
        issued_by: issuedBy,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (!error) return code;
    if (error.code !== '23505') throw new Error(`Could not issue a code: ${error.message}`);
  }
  throw new Error('Could not issue a code');
}

/** The student a typed code belongs to, or null. */
export async function findStudentByCode(input: string): Promise<string | null> {
  const code = normalizeCode(input);
  if (code.length !== CODE_LENGTH) return null;
  const { data } = await createPrivilegedClient()
    .from('student_codes')
    .select('user_id')
    .eq('code_hash', codeHash(code))
    .maybeSingle();
  return data?.user_id ?? null;
}

const scopesFor = (caller: string) => [`ip:${caller}`.slice(0, 120), 'all'];

async function attemptRows(scopes: string[]): Promise<AttemptRow[]> {
  const { data, error } = await createPrivilegedClient()
    .from('code_attempts')
    .select('scope, window_start, n')
    .in('scope', scopes);
  if (error) throw new Error(`Could not read the code throttle: ${error.message}`);
  return data.map((r) => ({ scope: r.scope, windowStart: new Date(r.window_start), n: r.n }));
}

/** Whether this caller has to wait before trying another code. */
export async function codeEntryThrottled(caller: string, now = new Date()): Promise<boolean> {
  return isThrottled(await attemptRows(scopesFor(caller)), now);
}

/**
 * Count one wrong code against the caller and against everyone. Only misses
 * count, so a class signing in from one school address is never locked out.
 * Read-then-write is not atomic: a burst of parallel guesses can be under-
 * counted by a few, which the size of the code space easily absorbs.
 */
export async function recordCodeMiss(caller: string, now = new Date()): Promise<void> {
  const scopes = scopesFor(caller);
  const rows = await attemptRows(scopes);
  const next = scopes.map((scope) =>
    afterMiss(rows.find((r) => r.scope === scope) ?? null, scope, now),
  );
  await createPrivilegedClient()
    .from('code_attempts')
    .upsert(
      next.map((r) => ({ scope: r.scope, window_start: r.windowStart.toISOString(), n: r.n })),
      { onConflict: 'scope' },
    );
}

/**
 * A one-time sign-in token for the student, exchanged at once for a normal
 * session by the caller (verifyOtp with the cookie-bound client). Nothing is
 * emailed: generateLink only creates the token.
 */
export async function signInTokenFor(userId: string): Promise<string | null> {
  const client = createPrivilegedClient();
  const { data: user } = await client.auth.admin.getUserById(userId);
  const email = user.user?.email;
  if (!email || user.user?.banned_until) return null;
  const { data, error } = await client.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) return null;
  return data.properties.hashed_token;
}
