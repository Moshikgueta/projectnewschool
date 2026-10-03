import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { IDS, PASSWORD, USERS, signIn, signOut } from './helpers';

test.describe('student journey', () => {
  test('logs in, sees only their published course, logs out, returns, and the session rules hold', async ({
    page,
  }) => {
    await signIn(page, USERS.studentA);
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByRole('heading', { name: 'My courses' })).toBeVisible();

    const courses = page.getByRole('list', { name: 'Courses' });
    await expect(courses.getByRole('heading', { name: 'Español básico (fixture)' })).toBeVisible();
    // Enrolled in a draft course and not enrolled in French: neither appears.
    await expect(courses.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByText('Español nivel 2')).toHaveCount(0);
    await expect(page.getByText('Français')).toHaveCount(0);

    // Session survives a reload ("student returns").
    await page.reload();
    await expect(page.getByRole('heading', { name: 'My courses' })).toBeVisible();

    await signOut(page);
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/login\?next=\/learn/);

    // Signing in again works and lands in the same place.
    await signIn(page, USERS.studentA);
    await expect(page).toHaveURL(/\/learn$/);
  });

  test('wrong password gets the same message as an unknown account', async ({ page }) => {
    for (const [email, password] of [
      [USERS.studentA, 'not-the-password'],
      ['nobody@example.com', PASSWORD],
    ]) {
      await page.goto('/login');
      await page.getByLabel('Email').fill(email!);
      await page.getByLabel('Password').fill(password!);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'The email or password is incorrect.' }),
      ).toBeVisible();
    }
  });

  test('can open their own attempt, but another student’s attempt is a 404', async ({ page }) => {
    await signIn(page, USERS.studentA);

    const own = await page.goto(`/learn/attempts/${IDS.attemptOfA}`);
    expect(own?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Greetings practice' })).toBeVisible();
    // The answer key and its feedback never reach the browser.
    expect(await page.content()).not.toContain('That answers how old you are');

    const others = await page.goto(`/learn/attempts/${IDS.attemptOfB}`);
    expect(others?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  test('cannot open teacher, manager or admin areas', async ({ page }) => {
    await signIn(page, USERS.studentA);
    for (const path of ['/teach', `/teach/groups/${IDS.groupX}`, '/manage', '/admin']) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });

  test('student pages pass automated accessibility checks', async ({ page }) => {
    await signIn(page, USERS.studentA);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
