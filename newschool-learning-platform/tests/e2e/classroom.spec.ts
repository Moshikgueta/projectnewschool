import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { IDS, USERS, signIn } from './helpers';

// Named "classroom" so it runs before the student specs (exercises, notebook…)
// that add to student A's records in the same run: the overview below checks
// numbers worked out by hand from the seed.

const GREETINGS = '70000000-0000-4000-8000-000000000001';
const FRENCH_ACTIVITY = '70000000-0000-4000-8000-000000000003';
const isoDate = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test.describe('teacher area', () => {
  // Worked out by hand from seed.sql for group X (students A, B, D).
  test('group overview: students, homework, common difficulties, next class', async ({ page }) => {
    await signIn(page, USERS.teacherX);
    await page
      .getByRole('region', { name: 'My groups' })
      .getByRole('link', { name: /Spanish Level 1/ })
      .click();
    await expect(page).toHaveURL(`/teach/groups/${IDS.groupX}`);

    // Active cycle "Introducing yourself" has 4 activities.
    // A: Greetings practice + Numbers done → 2 of 4; first tries 1 + (0,1,0) = 2 of 4 → 50%.
    // B: nothing done; 1 first try → too few. D: Greetings practice → 1 of 4; 1 first try.
    const rows = page.getByRole('region', { name: 'Students' }).getByRole('row');
    await expect(rows).toHaveCount(4); // header + 3 students, sorted by name
    await expect(rows.nth(1)).toContainText('Daniel (student A)');
    await expect(rows.nth(1)).toContainText('2 of 4');
    await expect(rows.nth(1)).toContainText('50%');
    await expect(rows.nth(2)).toContainText('Lior (student D)');
    await expect(rows.nth(2)).toContainText('1 of 4');
    await expect(rows.nth(2)).toContainText('Too few answers');
    await expect(rows.nth(3)).toContainText('Maya (student B)');
    await expect(rows.nth(3)).toContainText('0 of 4');

    // Homework "Greetings practice": A and D submitted it for the assignment; B has not.
    const homework = page.getByRole('region', { name: 'Homework' });
    await expect(homework).toContainText('Greetings practice');
    await expect(homework).toContainText('2 of 3 done');

    // "¿Cómo te llamas?": first tries A right, B and D wrong with the same option.
    const difficulties = page.getByRole('region', { name: 'Common difficulties' });
    await expect(difficulties).toContainText('¿Cómo te llamas?');
    await expect(difficulties).toContainText('2 of 3 wrong on the first try');
    await expect(difficulties).toContainText(
      /Most common wrong answer: ⁨?Tengo diez años\.⁩? \(2 students\)/,
    );

    await expect(
      page.getByRole('region', { name: 'Next class' }).getByRole('listitem'),
    ).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Active cycle', exact: true })).toContainText(
      'Introducing yourself',
    );

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('the teacher gives homework, the student sees it, and the teacher removes it', async ({
    page,
  }) => {
    await signIn(page, USERS.teacherX);
    await page.goto(`/teach/groups/${IDS.groupX}`);
    const homework = page.getByRole('region', { name: 'Homework' });
    await homework.getByRole('combobox', { name: 'Activity' }).selectOption({
      label: 'Introducing yourself · Numbers 1–10',
    });
    await homework.getByLabel('Due date (optional)').fill(isoDate(5));
    await homework.getByLabel('Note for students (optional)').fill('Before Thursday');
    await homework.getByRole('button', { name: 'Assign' }).click();
    await expect(homework.getByText('Saved.')).toBeVisible();
    await expect(homework.getByRole('listitem')).toHaveCount(2);
    await expect(homework).toContainText('Numbers 1–10');
    await expect(homework).toContainText('Before Thursday');
    // Given now: A's earlier attempt does not count; nobody has done it yet.
    await expect(homework.getByRole('listitem').first()).toContainText('0 of 3 done');

    // A due date in the past is refused.
    await homework.getByRole('combobox', { name: 'Activity' }).selectOption({
      label: 'Introducing yourself · Numbers 1–10',
    });
    await homework.getByLabel('Due date (optional)').fill(isoDate(-3));
    await homework.getByRole('button', { name: 'Assign' }).click();
    await expect(homework.getByText('Choose a date or time in the future.')).toBeVisible();

    await page.context().clearCookies();
    await signIn(page, USERS.studentB);
    const recs = page.getByRole('region', { name: 'Recommended for you' });
    await expect(recs).toContainText('Numbers 1–10');
    await expect(recs.getByRole('listitem').filter({ hasText: 'Numbers 1–10' })).toContainText(
      'Assigned by your teacher',
    );

    await page.context().clearCookies();
    await signIn(page, USERS.teacherX);
    await page.goto(`/teach/groups/${IDS.groupX}`);
    await page.getByRole('button', { name: 'Remove homework: Numbers 1–10' }).click();
    await expect(page.getByRole('region', { name: 'Homework' }).getByRole('listitem')).toHaveCount(
      1,
    );
  });

  test('the teacher schedules and cancels a class, and sets the active cycle', async ({ page }) => {
    await signIn(page, USERS.teacherX);
    await page.goto(`/teach/groups/${IDS.groupX}`);
    const classes = page.getByRole('region', { name: 'Next class' });
    await classes.getByLabel('Date and time').fill(`${isoDate(6)}T18:00`);
    await classes.getByRole('button', { name: 'Add class' }).click();
    await expect(classes.getByRole('listitem')).toHaveCount(2);
    await classes
      .getByRole('button', { name: /^Cancel the class on/ })
      .last()
      .click();
    await expect(classes.getByRole('listitem')).toHaveCount(1);

    const cycle = page.getByRole('region', { name: 'Active cycle', exact: true });
    await cycle.getByRole('button', { name: 'Make active' }).click();
    await expect(cycle.getByText('Saved.')).toBeVisible();
  });

  test('teacher view of an activity: answers, feedback and how the group did', async ({ page }) => {
    await signIn(page, USERS.teacherX);
    await page.goto(`/teach/groups/${IDS.groupX}`);
    await page
      .getByRole('region', { name: 'Activities of the active cycle' })
      .getByRole('link', { name: 'Greetings practice' })
      .click();
    await expect(page).toHaveURL(`/teach/groups/${IDS.groupX}/activities/${GREETINGS}`);
    await expect(
      page.getByText('Answers and feedback are visible only to teachers.'),
    ).toBeVisible();
    await expect(page.getByText('Me llamo Ana.').last()).toBeVisible();
    await expect(page.getByText('That answers how old you are.')).toBeVisible();
    // First tries: A right, B and D wrong.
    await expect(page.getByText('1 of 3 right on the first try')).toBeVisible();
  });

  test('teachers cannot open other groups or other courses; students cannot open the teacher view', async ({
    page,
  }) => {
    await signIn(page, USERS.teacherY);
    for (const path of [
      `/teach/groups/${IDS.groupX}`,
      `/teach/groups/${IDS.groupX}/activities/${GREETINGS}`,
    ]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
    await page.context().clearCookies();

    await signIn(page, USERS.teacherX);
    // An activity of the French course, through a group of the Spanish course.
    expect(
      (await page.goto(`/teach/groups/${IDS.groupX}/activities/${FRENCH_ACTIVITY}`))?.status(),
    ).toBe(404);
    await page.context().clearCookies();

    await signIn(page, USERS.studentA);
    expect((await page.goto(`/teach/groups/${IDS.groupX}/activities/${GREETINGS}`))?.status()).toBe(
      404,
    );
  });
});
