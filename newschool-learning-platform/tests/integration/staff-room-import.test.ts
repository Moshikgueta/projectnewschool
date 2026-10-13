// The staff-room import (scripts/staff-room-import.ts) against the local
// database: a made-up D1 export goes in, the right accounts, roles, codes,
// rooms and bookings come out, nobody is emailed, and a second run changes
// nothing.
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planImport } from '@/domain/migration/staff-room';
import type { Database } from '@/server/db.types';
import { applyPlan, loadExisting, readDump } from '../../scripts/staff-room-import';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const DOMAIN = '@staffroom.example.com';
const ROOM = 'Staff room test room';
const TEACHER_X = '00000000-0000-4000-8000-0000000000b1';

function admin(): SupabaseClient<Database> {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error(`Not local: ${url}`);
  return createClient<Database>(url, process.env.SUPABASE_SECRET_KEY ?? '', {
    auth: { persistSession: false },
  });
}

async function cleanUp() {
  const c = admin();
  await c.from('rooms').delete().eq('name', ROOM); // bookings go with it
  const { data } = await c.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data.users.filter((u) => u.email?.endsWith(DOMAIN))) {
    await c.auth.admin.deleteUser(u.id);
  }
}

const dump = readDump(readFileSync('tests/fixtures/staff-room-export.sql', 'utf8'));

describe('importing the staff room', () => {
  beforeAll(cleanUp);
  afterAll(cleanUp);

  it('reads accounts without their password hashes', () => {
    expect(dump.users).toHaveLength(6);
    expect(Object.keys(dump.users[0]!).sort()).toEqual(['active', 'email', 'id', 'name', 'role']);
  });

  it('refuses a "dump" that would touch the disk', () => {
    expect(() => readDump(`ATTACH DATABASE '/tmp/x.db' AS x;`)).toThrow(/not a D1 export/);
  });

  it('creates accounts, roles, codes, rooms and bookings, and emails nobody', async () => {
    const c = admin();
    const { existing, info } = await loadExisting(c);
    const plan = planImport(dump, existing);
    const result = await applyPlan(c, plan, info, {
      sendInvites: false,
      siteUrl: 'http://localhost:3000',
    });
    expect(result.failed).toEqual([]);
    expect(result.done).toHaveLength(4 + 1 + 1 + 3);

    const { data } = await c.auth.admin.listUsers({ perPage: 1000 });
    const imported = data.users.filter((u) => u.email?.endsWith(DOMAIN));
    const id = (local: string) => imported.find((u) => u.email === `${local}${DOMAIN}`)!.id;
    expect(imported.map((u) => u.email).sort()).toEqual(
      ['sr.admin', 'sr.office', 'sr.student', 'sr.teacher'].map((l) => `${l}${DOMAIN}`),
    );
    expect(imported.every((u) => !u.invited_at)).toBe(true);

    const { data: roles } = await c
      .from('user_roles')
      .select('user_id, role')
      .in(
        'user_id',
        imported.map((u) => u.id),
      );
    expect(new Map(roles!.map((r) => [r.user_id, r.role]))).toEqual(
      new Map([
        [id('sr.admin'), 'admin'],
        [id('sr.office'), 'office'],
        [id('sr.student'), 'student'],
        [id('sr.teacher'), 'teacher'],
      ]),
    );
    const { data: profile } = await c
      .from('profiles')
      .select('display_name')
      .eq('id', id('sr.teacher'))
      .single();
    expect(profile!.display_name).toBe('Shira Levi');

    const { data: code } = await c
      .from('student_codes')
      .select('code_hash, issued_by, created_at')
      .eq('user_id', id('sr.student'))
      .single();
    expect(code).toEqual({
      code_hash: '5f0e1c9a2b3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccdd0',
      issued_by: id('sr.teacher'),
      created_at: '2025-09-02T00:00:00+00:00',
    });

    const { data: bookings } = await c
      .from('room_bookings')
      .select(
        'title, weekday, start_min, end_min, teacher_id, note, created_by, rooms!inner ( name )',
      )
      .eq('rooms.name', ROOM)
      .order('weekday');
    expect(bookings!.map((b) => [b.title, b.teacher_id, b.note, b.created_by])).toEqual([
      ['Hebrew for beginners', id('sr.teacher'), '', id('sr.office')],
      ['Conversation club', TEACHER_X, 'Bring snacks', id('sr.office')],
      ['Visiting lecturer', null, 'Teacher: Dr. Nobody', null],
    ]);
    // The clash with group X's lesson in Room 1 was reported, not forced in.
    const { count } = await c
      .from('room_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('title', 'Clashes with group X');
    expect(count).toBe(0);
  });

  it('a second run finds everything already there', async () => {
    const c = admin();
    const { existing, info } = await loadExisting(c);
    const plan = planImport(dump, existing);
    expect(plan.accounts.every((a) => a.action === 'present')).toBe(true);
    expect(plan.codes).toEqual([]);
    expect(plan.rooms.every((r) => r.action === 'present')).toBe(true);
    expect(plan.bookings).toEqual([]);
    expect(plan.unchanged).toEqual({ codes: 1, bookings: 3 });
    const result = await applyPlan(c, plan, info, {
      sendInvites: false,
      siteUrl: 'http://localhost:3000',
    });
    expect(result).toEqual({ done: [], failed: [] });
  });
});
