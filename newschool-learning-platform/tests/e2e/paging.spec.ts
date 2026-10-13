import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { commonDifficulties } from '../../src/domain/teaching/insights';
import { adminClient, IDS, passMfa, signIn, USERS } from './helpers';

// Lists that are longer than one request returns (docs/PERFORMANCE.md §8).
// The end-to-end server reads every "all pages" list in pages of 3 rows
// (FETCH_PAGE_SIZE in playwright.config.ts), so the small seed goes through
// the same paging as 1,600 bookings or 10,000 students at school scale.

const OFFICE = '00000000-0000-4000-8000-0000000000e1';
const ZOOM_ROOM = 'e0000000-0000-4000-8000-000000000003';

test('office: the students list pages and searches; the timetable shows every booking', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const { count } = await admin
    .from('user_roles')
    .select('user_id', { count: 'exact', head: true })
    .eq('role', 'student');
  const total = count!;
  expect(total).toBeGreaterThan(2);

  await signIn(page, USERS.office);
  await passMfa(page, USERS.office);

  // One student per page: the total is counted by the database.
  await page.goto('/office/students?size=1');
  const pager = page.getByRole('navigation', { name: 'Pages of the student list' }).first();
  await expect(pager).toContainText(`Showing 1–1 of ${total}`);
  await expect(pager).toContainText(`Page 1 of ${total}`);
  const table = page.getByRole('table', { name: 'Students' });
  await expect(table.getByRole('row')).toHaveCount(2);
  const first = await table.getByRole('row').nth(1).getByRole('rowheader').innerText();

  await pager.getByRole('link', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/office\/students\?size=1&page=2$/);
  await expect(pager).toContainText(`Showing 2–2 of ${total}`);
  const second = await table.getByRole('row').nth(1).getByRole('rowheader').innerText();
  expect(second).not.toBe(first);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Back and forward are plain history.
  await page.goBack();
  await expect(pager).toContainText(`Showing 1–1 of ${total}`);
  await expect(table.getByRole('row').nth(1).getByRole('rowheader')).toHaveText(first);
  await page.goForward();
  await expect(pager).toContainText(`Showing 2–2 of ${total}`);

  // Past the end: the last page.
  await page.goto('/office/students?size=1&page=9999');
  await expect(pager).toContainText(`Showing ${total}–${total} of ${total}`);
  await expect(pager.getByText('Next')).toHaveAttribute('aria-disabled', 'true');

  // Search by phone (as typed, with spaces, or as digits), by contact email, by
  // name; the page size stays. (Other tests edit these details: read them now.)
  const { data: records } = await admin
    .from('student_records')
    .select('student_id, phone, contact_email')
    .in('student_id', [IDS.studentA, IDS.studentB]);
  const record = (id: string) => records!.find((r) => r.student_id === id)!;
  const a = record(IDS.studentA);
  const b = record(IDS.studentB);
  expect(a.phone).toMatch(/^\d{3}-\d{7}$/);
  expect(b.contact_email).toContain('@');
  const search = page.getByRole('searchbox', { name: 'Search by name, phone or email' });
  for (const [q, name] of [
    [b.phone, 'Maya (student B)'],
    [b.phone.replace(/\D/g, ''), 'Maya (student B)'],
    [a.phone.replace('-', ' '), 'Daniel (student A)'],
    [b.contact_email.toUpperCase(), 'Maya (student B)'],
    ['daniel', 'Daniel (student A)'],
  ] as const) {
    await search.fill(q);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(pager).toContainText('Showing 1–1 of 1');
    await expect(table.getByRole('row').nth(1)).toContainText(name);
    await expect(page).toHaveURL(/size=1/);
  }
  await search.fill('nobody-by-this-name');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('No students found.')).toBeVisible();

  // The timetable: more bookings than one page (3 here; 1,000 in production).
  const added = Array.from({ length: 7 }, (_, i) => ({
    id: crypto.randomUUID(),
    room_id: ZOOM_ROOM,
    title: `Paging check ${i + 1}`,
    weekday: 3,
    start_min: 420 + i * 60,
    end_min: 450 + i * 60,
    note: '',
    created_by: OFFICE,
  }));
  const { error } = await admin.from('room_bookings').insert(added);
  expect(error).toBeNull();
  try {
    const { count: bookings } = await admin
      .from('room_bookings')
      .select('id', { count: 'exact', head: true });
    expect(bookings).toBeGreaterThan(9); // more than three pages of 3
    await page.goto('/office/timetable');
    const grid = page.getByRole('table', { name: 'Weekly timetable' });
    for (const b of added) await expect(grid).toContainText(b.title);
    await expect(grid).toContainText('Spanish Level 1 (group X)');
    await expect(grid).toContainText('English Foundations');
  } finally {
    await admin
      .from('room_bookings')
      .delete()
      .in(
        'id',
        added.map((b) => b.id),
      );
  }
});

test('teacher: common difficulties and per-question results count every first answer', async ({
  page,
}) => {
  const admin = adminClient();
  const COURSE = '30000000-0000-4000-8000-000000000001';
  const NUMBERS = '70000000-0000-4000-8000-000000000007';
  const items = ['71', '72', '73'].map((n) => `80000000-0000-4000-8000-0000000000${n}`);
  const keys = ['o2', 'o1', 'o3']; // seed.sql: the right option of each question
  const students = [IDS.studentA, IDS.studentB, '00000000-0000-4000-8000-0000000000a4'];

  // B and D try "Numbers" twice: wrong on the first encounter of question 2,
  // right when they practise again later (which must not hide the first).
  const day = 86_400_000;
  const attempts = students.slice(1).flatMap((user, s) =>
    [0, 1].map((k) => ({
      id: crypto.randomUUID(),
      user_id: user,
      activity_id: NUMBERS,
      course_id: COURSE,
      attempt_no: 60 + k,
      status: 'submitted' as const,
      started_at: new Date(Date.now() - (3 - k) * day + s * 1000).toISOString(),
    })),
  );
  const { error } = await admin.from('attempts').insert(attempts);
  expect(error).toBeNull();
  try {
    const responses = attempts.flatMap((a) => {
      const firstTime = a.attempt_no === 60;
      return items.map((item, i) => ({
        attempt_id: a.id,
        user_id: a.user_id,
        course_id: COURSE,
        item_id: item,
        answer: { optionIds: [firstTime && i === 1 ? 'o3' : keys[i]!] },
        is_correct: !(firstTime && i === 1),
        score: firstTime && i === 1 ? 0 : 1,
        try_no: 1,
        created_at: new Date(Date.parse(a.started_at) + i * 1000).toISOString(),
      }));
    });
    expect((await admin.from('responses').insert(responses)).error).toBeNull();

    // The expected summary, from every first answer of the group's students.
    const { data: all } = await admin
      .from('responses')
      .select('user_id, item_id, is_correct, answer, created_at')
      .eq('course_id', COURSE)
      .eq('try_no', 1)
      .not('is_correct', 'is', null)
      .in('user_id', students);
    const expected = commonDifficulties(
      (all ?? []).map((r) => ({
        userId: r.user_id,
        itemId: r.item_id,
        correct: !!r.is_correct,
        answer: r.answer,
        at: r.created_at,
      })),
    );
    expect(expected.some((d) => d.itemId === items[1])).toBe(true);

    await signIn(page, USERS.teacherX);
    await page.goto(`/teach/groups/${IDS.groupX}`);
    const region = page.getByRole('region', { name: 'Common difficulties' });
    const lines = region.getByRole('listitem');
    await expect(lines).toHaveCount(expected.length);
    for (const [i, d] of expected.entries()) {
      await expect(lines.nth(i)).toContainText(
        `${d.wrong} of ${d.students} wrong on the first try`,
      );
    }

    // The exercise page: first encounters per question, right or wrong.
    await page.goto(`/teach/groups/${IDS.groupX}/activities/${NUMBERS}`);
    for (const item of items) {
      const firsts = new Map<string, { correct: boolean; at: string }>();
      for (const r of (all ?? []).filter((x) => x.item_id === item)) {
        const seen = firsts.get(r.user_id);
        if (!seen || r.created_at < seen.at) {
          firsts.set(r.user_id, { correct: !!r.is_correct, at: r.created_at });
        }
      }
      const right = [...firsts.values()].filter((f) => f.correct).length;
      await expect(page.getByRole('main')).toContainText(
        `${right} of ${firsts.size} right on the first try`,
      );
    }
  } finally {
    await admin
      .from('attempts')
      .delete()
      .in(
        'id',
        attempts.map((a) => a.id),
      );
  }
});

test('admin: the account list pages and searches', async ({ page }) => {
  const admin = adminClient();
  const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true });
  await signIn(page, USERS.admin);
  await passMfa(page, USERS.admin);
  await page.goto('/admin?size=2');
  const pager = page.getByRole('navigation', { name: 'Pages of the account list' }).first();
  await expect(pager).toContainText(`Showing 1–2 of ${count}`);
  await pager.getByRole('link', { name: 'Next' }).click();
  await expect(pager).toContainText(`Showing 3–4 of ${count}`);
  await page.getByRole('searchbox', { name: 'Search accounts' }).fill('teacher');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(pager).toContainText('of 2');
  await expect(page.getByRole('table')).toContainText('Teacher X');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
