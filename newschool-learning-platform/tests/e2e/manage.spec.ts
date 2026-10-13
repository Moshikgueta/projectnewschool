import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { USERS, passMfa, signIn, signOut } from './helpers';

// Pilot operations without a developer: a pedagogical manager creates a group,
// assigns a teacher, enrolls a student and activates a cycle — and the student
// then sees the course. Groups named "E2E …" are removed by global setup.
test('a manager sets up a group and the enrolled student sees the course', async ({ page }) => {
  await signIn(page, USERS.manager);
  await passMfa(page, USERS.manager);
  await expect(page).toHaveURL(/\/manage$/);

  // Overview lists every course, drafts included.
  const courses = page.getByRole('region', { name: 'Courses' });
  // (Imported content, e.g. in CI, may add more courses than the fixtures.)
  for (const title of [
    'Español básico (fixture)',
    'Français niveau 1 (fixture)',
    'Español nivel 2 (draft fixture)',
  ]) {
    await expect(
      courses.getByRole('row', { name: new RegExp(title.replace(/[()]/g, '\\$&')) }),
    ).toHaveCount(1);
  }
  await expect(courses).toContainText('Draft');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Groups' })
    .click();
  await expect(page).toHaveURL(/\/manage\/groups$/);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);

  const name = `E2E group ${Date.now()}`;
  await page
    .getByLabel('Course', { exact: true })
    .selectOption({ label: 'Español básico (fixture)' });
  await page.getByLabel('Group name').fill(name);
  await page.getByLabel('Schedule note').fill('Wednesdays 19:00');
  await page.getByRole('button', { name: 'Create group' }).click();

  await expect(page).toHaveURL(/\/manage\/groups\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  await page.getByLabel('Teacher', { exact: true }).selectOption({ label: 'Teacher X' });
  await page.getByRole('button', { name: 'Assign teacher' }).click();
  await expect(page.getByRole('list', { name: 'Teachers' })).toContainText('Teacher X');

  await page.getByLabel('Student', { exact: true }).selectOption({ label: 'Noam (student C)' });
  await page.getByRole('button', { name: 'Enroll' }).click();
  const students = page.getByRole('region', { name: 'Students' });
  await expect(students.getByText('Noam (student C)', { exact: true })).toBeVisible();

  await page.getByLabel('State of Introducing yourself').selectOption('active');
  await page
    .getByRole('region', { name: 'Cycles' })
    .getByRole('listitem')
    .filter({ hasText: 'Introducing yourself' })
    .getByRole('button', { name: 'Update' })
    .click();
  await expect(page.getByRole('region', { name: 'Cycles' }).getByText('Saved.')).toBeVisible();

  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);

  await signOut(page);

  // The student now has the Spanish course next to their French one.
  await signIn(page, USERS.studentC);
  const switcher = page.getByRole('combobox', { name: 'Course' });
  await expect(switcher.getByRole('option', { name: 'Español básico (fixture)' })).toHaveCount(1);
  await switcher.selectOption({ label: 'Español básico (fixture)' });
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Progress' })).toContainText(
    'Introducing yourself',
  );
});

test('teachers cannot reach the management screens', async ({ page }) => {
  await signIn(page, USERS.teacherX);
  for (const path of ['/manage/groups', '/manage/groups/a0000000-0000-4000-8000-000000000001']) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
});
