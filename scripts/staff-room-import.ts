// Import the staff room's D1 data into the platform (docs/STAFF-ROOM-MERGE.md).
//
//   pnpm staff-room:import <dump.sql>                    dry run: report only
//   pnpm staff-room:import <dump.sql> --apply            create what the report lists
//   pnpm staff-room:import <dump.sql> --apply --send-invites
//                                                        …and email staff a link to set a password
//
// <dump.sql> is `wrangler d1 export teacher-room --remote --output=dump.sql`.
// It is read into an in-memory SQLite database; password hashes, sessions and
// reset tokens in it are never read. Keep the dump out of Git and delete it
// after the cut-over: it holds personal data.
//
// Local database by default. Staging or production needs APP_ENV set to it
// and --confirm=<host of NEXT_PUBLIC_SUPABASE_URL>. Running it again is safe:
// what is already there is reported as unchanged, nothing is deleted.

import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isRole } from '../src/domain/auth/access';
import {
  planImport,
  type Existing,
  type ImportPlan,
  type PersonRef,
  type StaffRoomData,
} from '../src/domain/migration/staff-room';
import type { Database } from '../src/server/db.types';

type Client = SupabaseClient<Database>;

// ── reading the dump ───────────────────────────────────────────────────────

/** Statements a D1 export never contains and that could touch the disk. */
const FORBIDDEN = /(^|;)\s*(ATTACH|DETACH|VACUUM)\b/im;

export function readDump(sql: string): StaffRoomData {
  if (FORBIDDEN.test(sql))
    throw new Error('The dump contains ATTACH/DETACH/VACUUM: not a D1 export.');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(sql);
    const tables = new Set(
      (
        db.prepare(`select name from sqlite_master where type = 'table'`).all() as {
          name: string;
        }[]
      ).map((t) => t.name),
    );
    const rows = <T>(table: string, query: string): T[] =>
      tables.has(table) ? (db.prepare(query).all() as T[]) : [];
    return {
      // Deliberately not pass_hash, username, sessions or reset tokens.
      users: rows(
        'staff_users',
        `select id, email, role, name, active from staff_users order by created_at, id`,
      ),
      codes: rows(
        'student_codes',
        `select user_id as userId, code_hash as codeHash, issued_by as issuedBy, created_at as createdAt
           from student_codes order by created_at`,
      ),
      rooms: rows(
        'rooms',
        `select id, name, capacity, kit, active, sort_order as sortOrder from rooms order by sort_order, name`,
      ),
      bookings: rows(
        'room_bookings',
        `select id, room_id as roomId, title, teacher, weekday, start_min as startMin, end_min as endMin,
                note, created_by as createdBy
           from room_bookings order by weekday, start_min, id`,
      ),
    };
  } finally {
    db.close();
  }
}

// ── the platform's side ────────────────────────────────────────────────────

export type ExistingUserInfo = Map<
  string,
  { lastSignInAt: string | null; invitedAt: string | null }
>;

async function must<T>(
  label: string,
  q: PromiseLike<{ data: T; error: { message: string } | null }>,
) {
  const { data, error } = await q;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data as NonNullable<T>;
}

export async function loadExisting(
  client: Client,
): Promise<{ existing: Existing; info: ExistingUserInfo }> {
  const authUsers: { id: string; email?: string; last_sign_in_at?: string; invited_at?: string }[] =
    [];
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listing users: ${error.message}`);
    authUsers.push(...data.users);
    if (data.users.length < 1000) break;
  }
  const [roles, profiles, rooms, bookings, codes] = await Promise.all([
    must('roles', client.from('user_roles').select('user_id, role')),
    must('profiles', client.from('profiles').select('id, display_name')),
    must('rooms', client.from('rooms').select('id, name')),
    must(
      'bookings',
      client.from('room_bookings').select('id, room_id, weekday, start_min, end_min, title'),
    ),
    must('codes', client.from('student_codes').select('user_id, code_hash')),
  ]);
  const nameOf = new Map(profiles.map((p) => [p.id, p.display_name]));
  return {
    existing: {
      users: authUsers
        .filter((u) => u.email)
        .map((u) => ({
          id: u.id,
          email: u.email!.toLowerCase(),
          displayName: nameOf.get(u.id) ?? '',
          roles: roles
            .filter((r) => r.user_id === u.id)
            .map((r) => r.role)
            .filter(isRole),
        })),
      rooms,
      bookings: bookings.map((b) => ({
        id: b.id,
        roomId: b.room_id,
        weekday: b.weekday,
        start: b.start_min,
        end: b.end_min,
        title: b.title,
      })),
      codes: codes.map((c) => ({ userId: c.user_id, codeHash: c.code_hash })),
    },
    info: new Map(
      authUsers.map((u) => [
        u.id,
        { lastSignInAt: u.last_sign_in_at ?? null, invitedAt: u.invited_at ?? null },
      ]),
    ),
  };
}

// ── carrying the plan out ──────────────────────────────────────────────────

export type ApplyOptions = {
  /** Email staff a link to set their password (new accounts: an invitation). */
  sendInvites: boolean;
  siteUrl: string;
  /** Needed only with sendInvites, for password-reset emails to earlier imports. */
  publicClient?: Client;
  log?: (line: string) => void;
};

export type ApplyResult = { done: string[]; failed: string[] };

export async function applyPlan(
  client: Client,
  plan: ImportPlan,
  info: ExistingUserInfo,
  options: ApplyOptions,
): Promise<ApplyResult> {
  const log = options.log ?? (() => {});
  const done: string[] = [];
  const failed: string[] = [];
  const ok = (line: string) => {
    done.push(line);
    log(`  ✓ ${line}`);
  };
  const fail = (line: string) => {
    failed.push(line);
    log(`  ✗ ${line}`);
  };
  const redirectTo = `${options.siteUrl}/auth/confirm?next=/account/set-password`;

  // Accounts first: codes and bookings refer to them.
  const userId = new Map<string, string>();
  for (const a of plan.accounts) {
    if (a.existingId) userId.set(a.d1Id, a.existingId);
    const staff = a.role !== 'student';
    if (a.action === 'create') {
      // Students sign in with their code and are never emailed. Staff get an
      // invitation only when asked, so a trial run sends nothing.
      const { data, error } =
        staff && options.sendInvites
          ? await client.auth.admin.inviteUserByEmail(a.email, {
              data: { display_name: a.name },
              redirectTo,
            })
          : await client.auth.admin.createUser({
              email: a.email,
              email_confirm: true,
              user_metadata: { display_name: a.name },
            });
      if (error || !data.user) {
        fail(`account ${a.email}: ${error?.message ?? 'not created'}`);
        continue;
      }
      const role = await client.from('user_roles').insert({ user_id: data.user.id, role: a.role });
      if (role.error) {
        await client.auth.admin.deleteUser(data.user.id); // no account without a role
        fail(`account ${a.email}: role ${a.role} not granted (${role.error.message})`);
        continue;
      }
      userId.set(a.d1Id, data.user.id);
      ok(
        `account ${a.email} (${a.role})${staff && options.sendInvites ? ', invitation sent' : ''}`,
      );
    } else if (a.action === 'addRole') {
      const role = await client.from('user_roles').insert({ user_id: a.existingId!, role: a.role });
      if (role.error) fail(`role ${a.role} for ${a.email}: ${role.error.message}`);
      else ok(`role ${a.role} added to ${a.email}`);
    }
    // Staff imported by an earlier run without invitations, who have never
    // signed in: send the set-password email now.
    if (a.existingId && staff && options.sendInvites) {
      const seen = info.get(a.existingId);
      if (seen && !seen.lastSignInAt && !seen.invitedAt && options.publicClient) {
        const { error } = await options.publicClient.auth.resetPasswordForEmail(a.email, {
          redirectTo,
        });
        if (error) fail(`set-password email to ${a.email}: ${error.message}`);
        else ok(`set-password email sent to ${a.email}`);
      }
    }
  }
  const resolve = (ref: PersonRef | null) =>
    !ref ? null : 'existingId' in ref ? ref.existingId : (userId.get(ref.d1Id) ?? null);

  for (const c of plan.codes) {
    const student = resolve(c.student);
    if (!student) {
      fail(`entry code of ${c.email}: the account was not created`);
      continue;
    }
    const { error } = await client.from('student_codes').insert({
      user_id: student,
      code_hash: c.codeHash,
      issued_by: resolve(c.issuedBy),
      created_at: c.createdAt,
    });
    if (error) fail(`entry code of ${c.email}: ${error.message}`);
    else ok(`entry code of ${c.email}`);
  }

  const roomId = new Map<string, string>();
  for (const r of plan.rooms) {
    if (r.existingId) {
      roomId.set(r.d1Id, r.existingId);
      continue;
    }
    const { data, error } = await client
      .from('rooms')
      .insert({
        name: r.name,
        capacity: r.capacity,
        kit: r.kit,
        active: r.active,
        sort_order: r.sortOrder,
      })
      .select('id')
      .single();
    if (error) fail(`room ${r.name}: ${error.message}`);
    else {
      roomId.set(r.d1Id, data.id);
      ok(`room ${r.name}`);
    }
  }

  for (const b of plan.bookings) {
    const room = 'existingId' in b.room ? b.room.existingId : roomId.get(b.room.d1Id);
    const label = `booking "${b.title}" in ${b.roomName}, day ${b.weekday}`;
    if (!room) {
      fail(`${label}: the room was not created`);
      continue;
    }
    const { error } = await client.from('room_bookings').insert({
      room_id: room,
      title: b.title,
      weekday: b.weekday,
      start_min: b.start,
      end_min: b.end,
      note: b.note,
      teacher_id: resolve(b.teacher),
      created_by: resolve(b.createdBy),
    });
    if (error?.code === '23P01') fail(`${label}: clashes with a booking made meanwhile`);
    else if (error) fail(`${label}: ${error.message}`);
    else ok(label);
  }
  return { done, failed };
}

// ── report ─────────────────────────────────────────────────────────────────

export function describePlan(plan: ImportPlan): string[] {
  const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
  const lines = [
    `Accounts: ${count(plan.accounts, (a) => a.action === 'create')} to create, ` +
      `${count(plan.accounts, (a) => a.action === 'addRole')} gain a role, ` +
      `${count(plan.accounts, (a) => a.action === 'present')} already there`,
    ...plan.accounts
      .filter((a) => a.action !== 'present')
      .map(
        (a) =>
          `  + ${a.email}  ${a.role}${a.action === 'addRole' ? ' (added to the existing account)' : ''}`,
      ),
    `Entry codes: ${plan.codes.length} to copy, ${plan.unchanged.codes} already there`,
    `Rooms: ${count(plan.rooms, (r) => r.action === 'create')} to create, ${count(plan.rooms, (r) => r.action === 'present')} already there`,
    ...plan.rooms.filter((r) => r.action === 'create').map((r) => `  + ${r.name}`),
    `Bookings: ${plan.bookings.length} to create, ${plan.unchanged.bookings} already there`,
  ];
  if (plan.notices.length) {
    lines.push(`For a person to review (${plan.notices.length}):`);
    lines.push(...plan.notices.map((n) => `  ! ${n.what}: ${n.reason}`));
  }
  return lines;
}

// ── command line ───────────────────────────────────────────────────────────

function target(): { url: string; secret: string; publishable: string; siteUrl: string } {
  if (existsSync('.env.local') && (process.env.APP_ENV ?? 'local') === 'local')
    process.loadEnvFile('.env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const secret = process.env.SUPABASE_SECRET_KEY ?? '';
  if (!url || !secret)
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
  const appEnv = process.env.APP_ENV ?? 'local';
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);
  if (!local) {
    const confirm = process.argv
      .find((a) => a.startsWith('--confirm='))
      ?.slice('--confirm='.length);
    if (!['staging', 'production'].includes(appEnv) || confirm !== new URL(url).host) {
      throw new Error(
        `Refusing to import into ${url}. Set APP_ENV=staging or production and pass --confirm=${new URL(url).host}.`,
      );
    }
  }
  return {
    url,
    secret,
    publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  };
}

async function main() {
  const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const apply = process.argv.includes('--apply');
  const sendInvites = process.argv.includes('--send-invites');
  if (!file || !existsSync(file)) {
    console.error(
      'Usage: pnpm staff-room:import <dump.sql> [--apply] [--send-invites] [--confirm=<host>]',
    );
    process.exit(2);
  }
  if (sendInvites && !apply) throw new Error('--send-invites only makes sense with --apply.');

  const env = target();
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const client = createClient<Database>(env.url, env.secret, opts);
  const data = readDump(readFileSync(file, 'utf8'));
  const { existing, info } = await loadExisting(client);
  const plan = planImport(data, existing);

  console.log(`Staff room → ${env.url}${apply ? '' : '  (dry run: nothing is written)'}`);
  console.log(
    `Read: ${data.users.length} accounts, ${data.codes.length} codes, ${data.rooms.length} rooms, ${data.bookings.length} bookings`,
  );
  for (const line of describePlan(plan)) console.log(line);
  if (plan.codes.length) {
    console.log(
      'Codes keep working only if STUDENT_CODE_PEPPER on the platform is the staff room Worker’s value.',
    );
  }
  if (!apply) {
    console.log('Dry run. Run again with --apply to import.');
    return;
  }

  console.log('Importing…');
  const result = await applyPlan(client, plan, info, {
    sendInvites,
    siteUrl: env.siteUrl,
    ...(env.publishable
      ? { publicClient: createClient<Database>(env.url, env.publishable, opts) }
      : {}),
    log: (line) => console.log(line),
  });
  console.log(`Done: ${result.done.length} written, ${result.failed.length} failed.`);
  if (!sendInvites && plan.accounts.some((a) => a.action === 'create' && a.role !== 'student')) {
    console.log('No emails were sent. At the cut-over, run again with --apply --send-invites.');
  }
  if (result.failed.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
