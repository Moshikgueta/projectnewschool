import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { adminClient, IDS, signIn, USERS } from './helpers';

// Attendance per class and the teacher's day (staff room merge, stage C).
// Seed (reset by global-setup): group X (A, B, D) has a class in two days,
// one two days ago (A present, B late, D absent) and one nine days ago with
// no attendance. Homework "Greetings practice" is due in three days; A and D
// have done it.

const NEXT = 'f0000000-0000-4000-8000-000000000001';
const PAST = 'f0000000-0000-4000-8000-000000000002';
const OLD = 'f0000000-0000-4000-8000-000000000003';
const ZOOM_ROOM = 'e0000000-0000-4000-8000-000000000003';
const classUrl = (groupId: string, sessionId: string) =>
  `/teach/groups/${groupId}/classes/${sessionId}`;

/** Change a hidden field before submitting: what a forged request would do. */
async function forge(page: Page, name: string, value: string) {
  await page
    .locator(`input[type="hidden"][name="${name}"]`)
    .first()
    .evaluate((el, v) => {
      (el as HTMLInputElement).value = v;
    }, value);
}

test.describe('attendance', () => {
  test('the teacher’s day: today’s class with its room, attendance to take, homework due', async ({
    page,
  }) => {
    // A class for group X in five minutes, in the Zoom room on today's
    // timetable (both removed by global-setup on the next run).
    const admin = adminClient();
    const startsAt = new Date(Date.now() + 5 * 60_000);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(startsAt);
    const part = (t: string) => parts.find((p) => p.type === t)!.value;
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
    const minute = Number(part('hour')) * 60 + Number(part('minute'));
    const { data: today } = await admin
      .from('group_sessions')
      .insert({ group_id: IDS.groupX, starts_at: startsAt.toISOString() })
      .select('id')
      .single();
    await admin.from('room_bookings').insert({
      room_id: ZOOM_ROOM,
      title: 'E2E today',
      group_id: IDS.groupX,
      weekday,
      start_min: Math.min(minute, 1438),
      end_min: Math.min(minute + 60, 1439),
    });

    try {
      await signIn(page, USERS.teacherX);
      await expect(page).toHaveURL('/teach');
      await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();

      const todays = page.getByRole('region', { name: 'Today’s classes' });
      await expect(todays.getByRole('listitem')).toHaveCount(1);
      await expect(todays).toContainText('Spanish Level 1 · Tuesday (group X)');
      await expect(todays).toContainText('Room: Zoom room · Attendance: 0 of 3');

      // The class nine days ago; the one two days ago is complete.
      const toTake = page.getByRole('region', { name: 'Attendance to take' });
      await expect(toTake.getByRole('listitem')).toHaveCount(1);
      await expect(toTake).toContainText('Attendance: 0 of 3');

      const homework = page.getByRole('region', { name: 'Homework due this week' });
      await expect(homework).toContainText('Greetings practice');
      await expect(homework).toContainText('2 of 3 done');

      const axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations).toEqual([]);

      // Today's class opens for attendance (it starts within 30 minutes).
      await todays.getByRole('link', { name: /^Take attendance/ }).click();
      await expect(page).toHaveURL(classUrl(IDS.groupX, today!.id));
      await expect(page.getByRole('group', { name: 'Daniel (student A)' })).toBeVisible();
    } finally {
      await admin.from('room_bookings').delete().eq('title', 'E2E today');
      await admin.from('group_sessions').delete().eq('id', today!.id);
    }
  });

  test('a teacher takes attendance and the group page counts it', async ({ page }) => {
    await signIn(page, USERS.teacherX);
    await page
      .getByRole('region', { name: 'Attendance to take' })
      .getByRole('link', { name: /^Take attendance/ })
      .click();
    await expect(page).toHaveURL(classUrl(IDS.groupX, OLD));
    await expect(page.getByRole('heading', { level: 1, name: 'Attendance' })).toBeVisible();

    await page
      .getByRole('group', { name: 'Daniel (student A)' })
      .getByRole('radio', { name: 'Present' })
      .check();
    await page
      .getByRole('group', { name: 'Maya (student B)' })
      .getByRole('radio', { name: 'Absent' })
      .check();
    await page.getByRole('textbox', { name: 'Note for Maya (student B)' }).fill('Sick');
    await page
      .getByRole('group', { name: 'Lior (student D)' })
      .getByRole('radio', { name: 'Excused' })
      .check();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
    await page.getByRole('button', { name: 'Save attendance' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

    // Saved as marked, in the teacher's name.
    const { data: rows } = await adminClient()
      .from('attendance')
      .select('student_id, status, note, marked_by')
      .eq('session_id', OLD)
      .order('student_id');
    expect(rows).toEqual([
      {
        student_id: IDS.studentA,
        status: 'present',
        note: '',
        marked_by: '00000000-0000-4000-8000-0000000000b1',
      },
      {
        student_id: IDS.studentB,
        status: 'absent',
        note: 'Sick',
        marked_by: '00000000-0000-4000-8000-0000000000b1',
      },
      {
        student_id: '00000000-0000-4000-8000-0000000000a4',
        status: 'excused',
        note: '',
        marked_by: '00000000-0000-4000-8000-0000000000b1',
      },
    ]);

    // Reloaded, the form shows what was saved.
    await page.reload();
    await expect(
      page.getByRole('group', { name: 'Maya (student B)' }).getByRole('radio', { name: 'Absent' }),
    ).toBeChecked();

    // Group page. A: present twice → 2 of 2. B: late, absent → 1 of 2.
    // D: absent, excused (left out) → 0 of 1.
    await page.getByRole('link', { name: 'Back to the group' }).click();
    const rowsOnPage = page.getByRole('region', { name: 'Students' }).getByRole('row');
    await expect(rowsOnPage.nth(1)).toContainText('Daniel (student A)');
    await expect(rowsOnPage.nth(1).getByRole('cell').nth(3)).toHaveText('2 of 2');
    await expect(rowsOnPage.nth(2).getByRole('cell').nth(3)).toHaveText('0 of 1');
    await expect(rowsOnPage.nth(3).getByRole('cell').nth(3)).toHaveText('1 of 2');
    const past = page.getByRole('region', { name: 'Past classes' });
    await expect(past.getByRole('listitem')).toHaveCount(2);
    await expect(past.getByRole('listitem').nth(0)).toContainText('3 of 3 marked');
    await expect(past.getByRole('listitem').nth(1)).toContainText('3 of 3 marked');

    await page.goto('/teach');
    await expect(page.getByRole('region', { name: 'Attendance to take' })).toContainText(
      'All caught up.',
    );
  });

  test('not before the class, and a started class cannot be cancelled', async ({ page }) => {
    await signIn(page, USERS.teacherX);
    await page.goto(classUrl(IDS.groupX, NEXT));
    await expect(
      page.getByText('Attendance opens 30 minutes before the class starts.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save attendance' })).toHaveCount(0);

    // Forged: the form of a past class, pointed at the class in two days.
    await page.goto(classUrl(IDS.groupX, PAST));
    await forge(page, 'sessionId', NEXT);
    await page.getByRole('button', { name: 'Save attendance' }).click();
    await expect(page.locator('form').getByRole('alert')).toContainText(
      'Attendance opens 30 minutes before the class starts.',
    );

    // Forged: the "cancel" form of the class in two days, pointed at the
    // class two days ago (which has attendance).
    await page.goto(`/teach/groups/${IDS.groupX}`);
    const next = page.getByRole('region', { name: 'Next class' });
    await next.locator('input[name="sessionId"]').evaluate((el, id) => {
      (el as HTMLInputElement).value = id;
    }, PAST);
    await next.getByRole('button', { name: /^Cancel the class on/ }).click();
    await page.waitForLoadState('networkidle');
    const { count } = await adminClient()
      .from('group_sessions')
      .select('id', { count: 'exact', head: true })
      .in('id', [PAST, NEXT]);
    expect(count).toBe(2);
  });

  test('another teacher cannot see or mark group X’s attendance, even with a forged form', async ({
    page,
  }) => {
    // A class of teacher Y's own group, so they have a real form to tamper with.
    const admin = adminClient();
    const { data: own } = await admin
      .from('group_sessions')
      .insert({ group_id: IDS.groupY, starts_at: new Date(Date.now() - 86_400_000).toISOString() })
      .select('id')
      .single();
    try {
      await signIn(page, USERS.teacherY);
      expect((await page.goto(classUrl(IDS.groupX, PAST)))?.status()).toBe(404);
      expect((await page.goto(classUrl(IDS.groupY, PAST)))?.status()).toBe(404);

      await page.goto(classUrl(IDS.groupY, own!.id));
      await expect(page.getByRole('group', { name: 'Maya (student B)' })).toBeVisible();
      await page.getByRole('radio', { name: 'Present' }).first().check();
      await forge(page, 'groupId', IDS.groupX);
      await forge(page, 'sessionId', PAST);
      await page.getByRole('button', { name: 'Save attendance' }).click();
      await expect(page.locator('form').getByRole('alert')).toContainText(
        'You can only change your own groups.',
      );
      const { data } = await admin.from('attendance').select('status').eq('session_id', PAST);
      expect(data?.map((r) => r.status).sort()).toEqual(['absent', 'late', 'present']);
    } finally {
      await admin.from('attendance').delete().eq('session_id', own!.id);
      await admin.from('group_sessions').delete().eq('id', own!.id);
    }
  });

  test('students have no attendance pages', async ({ page }) => {
    await signIn(page, USERS.studentA);
    expect((await page.goto(classUrl(IDS.groupX, PAST)))?.status()).toBe(404);
  });
});
