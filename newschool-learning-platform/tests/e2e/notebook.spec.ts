import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { IDS, USERS, signIn } from './helpers';

const TEACHER_NOTE = 'Start with a name circle';

async function noAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe('notebook', () => {
  test('a student reads a section, saves an answer, and it persists', async ({ page }) => {
    await signIn(page, USERS.studentA);
    await page.goto('/learn/notebook');

    const cycle = page.getByRole('region', { name: 'Introducing yourself' });
    await expect(cycle).toContainText('Active now');
    await expect(cycle.getByRole('link', { name: /¡Hola!/ })).toContainText('In progress');
    await cycle.getByRole('link', { name: /¡Hola!/ }).click();

    await expect(page).toHaveURL(`/learn/notebook/${IDS.sectionHola}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('¡Hola!');
    // Course content keeps its own language and direction inside the page.
    await expect(page.getByText('Me llamo Leo. ¡Mucho gusto!')).toBeVisible();
    await expect(page.locator('[lang="he"][dir="rtl"]').first()).toBeVisible();
    await expect(page.getByText('Only you and your teacher can see your answers.')).toBeVisible();

    // Teacher-only notes and classmates' answers are never sent to students.
    const html = await page.content();
    expect(html).not.toContain(TEACHER_NOTE);
    expect(html).not.toContain('Me llamo Bea.');

    const answer = page.getByRole('textbox', { name: /¿Cómo te llamas\?/ });
    await answer.fill('Me llamo Alma.');
    const form = page.locator('form', { has: answer });
    await form.getByRole('button', { name: 'Save answer' }).click();
    await expect(form.getByRole('status')).toHaveText('Saved');

    await page.reload();
    await expect(page.getByRole('textbox', { name: /¿Cómo te llamas\?/ })).toHaveValue(
      'Me llamo Alma.',
    );
    await noAxeViolations(page);
  });

  test('a student cannot open sections of other courses or drafts (404)', async ({ page }) => {
    await signIn(page, USERS.studentA);
    for (const id of [
      IDS.sectionBonjour,
      IDS.sectionDraft,
      '60000000-0000-4000-8000-0000000000ff',
      'nope',
    ]) {
      expect((await page.goto(`/learn/notebook/${id}`))?.status(), id).toBe(404);
    }
  });

  test('a student marks a section as finished', async ({ page }) => {
    await signIn(page, USERS.studentC);
    await page.goto(`/learn/notebook/${IDS.sectionBonjour}`);
    await page.getByRole('button', { name: 'Mark as finished' }).click();
    await expect(page.getByText('Finished', { exact: true })).toBeVisible();

    await page.goto('/learn/notebook');
    await expect(page.getByRole('link', { name: /Bonjour/ })).toContainText('Finished');
  });

  test("the group's teacher sees notes and their students' answers", async ({ page }) => {
    await signIn(page, USERS.teacherX);
    await page.goto(`/teach/groups/${IDS.groupX}`);
    await page.getByRole('link', { name: '¡Hola!' }).click();

    await expect(page).toHaveURL(`/teach/groups/${IDS.groupX}/notebook/${IDS.sectionHola}`);
    await expect(page.getByText(TEACHER_NOTE)).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);

    await page
      .getByText(/Student answers \(2\)/)
      .first()
      .click();
    await expect(page.getByText('Me llamo Bea.')).toBeVisible();
    await expect(page.getByText('Me llamo Alma.')).toBeVisible();
    await noAxeViolations(page);
  });

  test('teachers cannot open notebooks of groups or courses they do not teach (404)', async ({
    page,
  }) => {
    await signIn(page, USERS.teacherY);
    expect(
      (await page.goto(`/teach/groups/${IDS.groupX}/notebook/${IDS.sectionHola}`))?.status(),
    ).toBe(404);
    await page.context().clearCookies();

    // Teacher X teaches group X, but the French section is not in its course.
    await signIn(page, USERS.teacherX);
    expect(
      (await page.goto(`/teach/groups/${IDS.groupX}/notebook/${IDS.sectionBonjour}`))?.status(),
    ).toBe(404);
  });

  test('students cannot open the teacher view', async ({ page }) => {
    await signIn(page, USERS.studentA);
    expect(
      (await page.goto(`/teach/groups/${IDS.groupX}/notebook/${IDS.sectionHola}`))?.status(),
    ).toBe(404);
  });
});
