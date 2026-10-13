import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { adminClient, IDS, signIn, USERS } from './helpers';

// "My lessons": a student's own attendance, packages and private lessons.
// Seed (reset by global-setup): Daniel (A) has a paid 10-lesson package,
// 2 used and 1 booked with teacher X; Maya (B) an unpaid 5-lesson package,
// 4 used, expiring in 10 days; Noam (C) has none.

/** Attendance counted like the page does (excused left out), straight from the database. */
async function expectedRate(studentId: string) {
  const { data } = await adminClient()
    .from('attendance')
    .select('status')
    .eq('student_id', studentId);
  const counted = (data ?? []).filter((r) => r.status !== 'excused');
  return {
    attended: counted.filter((r) => r.status !== 'absent').length,
    counted: counted.length,
  };
}

test.describe('my lessons', () => {
  test('a student sees their own package, lessons and attendance', async ({ page }) => {
    await signIn(page, USERS.studentA);
    await page.getByRole('link', { name: /My lessons/ }).click();
    await expect(page).toHaveURL('/learn/lessons');

    const lessons = page.getByRole('region', { name: 'Private lessons' });
    await expect(lessons).toContainText('10 lessons of 60 minutes');
    await expect(lessons).toContainText('2 used · 1 booked · 8 left');
    await expect(lessons).toContainText('Valid until');
    await expect(lessons).not.toContainText('Not paid');
    await expect(lessons.getByRole('heading', { name: 'Coming up' })).toBeVisible();
    await expect(lessons).toContainText('with Teacher X');
    await expect(lessons).toContainText('Cancelled late (charged)');
    await expect(lessons).toContainText('Held');

    const rate = await expectedRate(IDS.studentA);
    await expect(page.getByRole('region', { name: 'Class attendance' })).toContainText(
      `You came to ${rate.attended} of ${rate.counted} classes`,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test('running low and unpaid shows; another student sees only their own', async ({ page }) => {
    await signIn(page, USERS.studentB);
    await page.goto('/learn/lessons');
    const lessons = page.getByRole('region', { name: 'Private lessons' });
    await expect(lessons).toContainText('5 lessons of 45 minutes');
    await expect(lessons).toContainText('4 used · 0 booked · 1 left');
    await expect(lessons).toContainText('Not paid');
    await expect(lessons).toContainText('talk to the school office');
    await expect(lessons).not.toContainText('10 lessons');
    await page.context().clearCookies();

    await signIn(page, USERS.studentC);
    await page.goto('/learn/lessons');
    await expect(page.getByRole('region', { name: 'Private lessons' })).toContainText(
      'You have no private lessons or packages.',
    );
    await expect(page.getByRole('region', { name: 'Class attendance' })).toContainText(
      'No attendance recorded yet.',
    );
  });

  test('staff have no "my lessons" page', async ({ page }) => {
    await signIn(page, USERS.teacherX);
    expect((await page.goto('/learn/lessons'))?.status()).toBe(404);
  });
});
