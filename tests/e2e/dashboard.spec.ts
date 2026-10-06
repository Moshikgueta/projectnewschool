import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { USERS, signIn } from './helpers';

test.describe('student dashboard', () => {
  test('shows where to continue, the course, progress and recent activity from real data', async ({
    page,
  }) => {
    await signIn(page, USERS.studentA);

    const cont = page.getByRole('region', { name: 'Continue where you left off' });
    await expect(cont).toContainText('Notebook');
    await expect(cont).toContainText('¡Hola!');
    await expect(page.getByRole('link', { name: 'Continue learning' })).toBeVisible();

    const course = page.getByRole('region', { name: 'My course' });
    await expect(course.getByRole('link')).toHaveCount(6);
    await expect(course.getByRole('link', { name: /Class notebook/ })).toContainText('1 section');
    await expect(course.getByRole('link', { name: /Vocabulary/ })).toContainText('2 words');

    // Student A finished the assigned activity: nothing open.
    await expect(page.getByRole('region', { name: 'Recommended for you' })).toContainText(
      'You are all caught up',
    );

    const progress = page.getByRole('region', { name: 'Progress' });
    // Greetings practice (today) and Numbers 1–10 (two days ago).
    await expect(progress).toContainText('Activities completed2');
    // Cycle 1: 2 of 4 activities done, 0 of 2 sections finished → 2 / 6 = 33%.
    await expect(progress.getByRole('progressbar', { name: /Current cycle/ })).toHaveAttribute(
      'aria-valuenow',
      '33',
    );

    await expect(page.getByRole('region', { name: 'Recent activity' })).toContainText(
      /Completed: \u2068?Greetings practice/,
    );
  });

  // Phase 5 exit criterion: the progress page shows the numbers worked out by
  // hand from supabase/seed.sql for student A.
  test('the progress page matches the hand-computed fixture', async ({ page }) => {
    await signIn(page, USERS.studentA);
    await page.getByRole('link', { name: 'See my progress' }).click();
    await expect(page).toHaveURL(/\/learn\/progress\?course=30000000-0000-4000-8000-000000000001$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My progress');

    // Learning events today and two days ago → 2 of the 3-day weekly goal.
    const week = page.getByRole('region', { name: 'This week' });
    await expect(week).toContainText('2 of 3 days');
    await expect(week.getByText(/: practised$/)).toHaveCount(2);
    await expect(week.getByText(/: no practice$/)).toHaveCount(5);

    // Introducing yourself: activities 2 of 4 (Greetings practice, Numbers 1–10),
    // sections 0 of 2 (¡Hola! is in progress, the workbook section untouched) → 33%.
    const cycles = page.getByRole('region', { name: 'Cycles' });
    await expect(cycles.getByRole('listitem')).toHaveCount(1);
    await expect(cycles).toContainText('Active now');
    await expect(cycles).toContainText('33% · 2 of 4 activities · 0 of 2 sections');
    await expect(
      cycles.getByRole('progressbar', { name: 'Progress in Introducing yourself' }),
    ).toHaveAttribute('aria-valuenow', '33');

    // Numbers 1–10: first tries wrong, right, wrong → 1 of 3 = 33% < 60% → revisit.
    const revisit = page.getByRole('region', { name: 'Topics to revisit' });
    await expect(revisit).toContainText('Numbers');
    await expect(revisit).toContainText('1 of 3 right on the first try');
    await expect(revisit.getByRole('link', { name: 'Practise: Numbers 1–10' })).toHaveAttribute(
      'href',
      '/learn/activities/70000000-0000-4000-8000-000000000007',
    );

    // Greetings: a single first-try answer is too few to judge.
    const skills = page.getByRole('region', { name: 'Skills' });
    await expect(skills).toContainText('Greetings vocabulary');
    await expect(skills).toContainText('Too early to tell: 1 answer so far');
    await expect(skills.getByRole('progressbar', { name: 'Numbers' })).toHaveAttribute(
      'aria-valuenow',
      '33',
    );

    // Vocabulary: "hola" in box 2, "adiós" never reviewed → none well known yet.
    await expect(page.getByRole('region', { name: 'Vocabulary' })).toContainText(
      '0 of 2 words well known',
    );

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('recommends the open assignment and switches between courses', async ({ page }) => {
    await signIn(page, USERS.studentB);

    const recs = page.getByRole('region', { name: 'Recommended for you' });
    await expect(recs).toContainText('Assigned by your teacher');
    await expect(recs).toContainText('Greetings practice');
    await expect(page.getByRole('region', { name: 'Continue where you left off' })).toContainText(
      'Greetings practice',
    );

    const switcher = page.getByRole('combobox', { name: 'Course' });
    await expect(switcher.getByRole('option')).toHaveCount(2);
    await switcher.selectOption({ label: 'Français niveau 1 (fixture)' });
    await expect(page).toHaveURL(/\?course=30000000-0000-4000-8000-000000000002/);
    await expect(page.getByText('French Level 1 · Thursday (group Y)')).toBeVisible();
  });

  test('switches the interface to Hebrew (right-to-left) and back', async ({ page }) => {
    // Its own account, so a failure here cannot leave other tests in Hebrew.
    await signIn(page, USERS.studentC);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await page.getByRole('button', { name: 'Interface language: עברית' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Noam');
    await expect(page.getByRole('heading', { name: 'הקורס שלי' })).toBeVisible();
    // Course content keeps its own language inside the Hebrew page.
    // The course language's name is shown in Hebrew, tagged with its own language.
    await expect(page.getByText('צרפתית', { exact: true })).toHaveAttribute('lang', 'fr');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);

    // The choice is saved on the profile, so it survives signing in again.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await page.getByRole('button', { name: 'שפת הממשק: English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
});

test('the design-system reference page renders and is accessible (local build)', async ({
  page,
}) => {
  await page.goto('/design-system');
  await expect(page.getByRole('heading', { name: 'New School design system' })).toBeVisible();
  await expect(page.getByText('--color-brand-primary', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Leave this activity?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
