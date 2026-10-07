import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { adminClient, passMfa, signIn, USERS } from './helpers';

// Staff tools (staff room merge, stage E). Seed (reset by global-setup):
// feedback from teacher X about Lior (needs attention) and from teacher Y
// (missing listening material, French, level 1); one task from teacher X to
// the manager; three training links.

const TEACHER_X = '00000000-0000-4000-8000-0000000000b1';

/**
 * A student teacher X teaches in no group right now. Worked out at run time:
 * other specs enrol students in groups teacher X teaches (manage.spec puts
 * student C in one).
 */
async function studentNotTaughtByX(): Promise<string> {
  const admin = adminClient();
  const { data: taught } = await admin
    .from('group_teachers')
    .select('group_id')
    .eq('teacher_id', TEACHER_X);
  const { data: enrolled } = await admin
    .from('enrollments')
    .select('student_id')
    .in(
      'group_id',
      (taught ?? []).map((g) => g.group_id),
    );
  const mine = new Set((enrolled ?? []).map((e) => e.student_id));
  const { data: students } = await admin.from('user_roles').select('user_id').eq('role', 'student');
  const other = (students ?? []).map((s) => s.user_id).find((id) => !mine.has(id));
  if (!other)
    throw new Error('Every student is taught by teacher X: no one to forge feedback about');
  return other;
}

test.describe('staff tools', () => {
  test('the lesson-plan builder builds the staff room’s prompt from a group, and copies it', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page, USERS.teacherX);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Staff tools' })
      .click();
    await page.getByRole('link', { name: /Lesson-plan builder/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lesson-plan builder');

    // Group X: Spanish, level 1 (A1), three active students.
    await page.getByRole('button', { name: 'Spanish Level 1 · Tuesday (group X)' }).click();
    await page.getByLabel('Lesson topic').fill('Los números');
    const prompt = page.getByRole('textbox', { name: 'Prompt' });
    await expect(prompt).toHaveValue(/^אני מורה לספרדית בבית ספר לשפות בישראל\./);
    const text = await prompt.inputValue();
    expect(text).toContain('· רמת הסייקל בבית הספר: רמה 1 (מקביל ל-A1 ב-CEFR)');
    expect(text).toContain('· מסגרת: קבוצה של 3 תלמידים');
    expect(text).toContain('· נושא השיעור: Los números');
    expect(text).toContain(
      '· חומרים שיש לי ביד: המחברת הדיגיטלית של Spanish Level 1 · Tuesday (group X)',
    );

    await page.getByRole('checkbox', { name: 'Homework' }).uncheck();
    await expect(prompt).not.toHaveValue(/הצעה לשיעורי בית/);

    await page.getByRole('button', { name: 'Copy prompt' }).click();
    await expect(page.getByText('Copied. Paste it into your AI assistant.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      await prompt.inputValue(),
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test('a teacher sends feedback and tasks; the manager handles them', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, USERS.teacherX);
    await page.goto('/teach/tools/feedback');
    const mine = page.getByRole('region', { name: 'What I sent' });
    await expect(mine.getByRole('listitem')).toHaveCount(1); // the seed's, about Lior

    // The kind picker sits next to the form, not in it.
    const form = page.getByRole('main');
    await form.getByLabel('Student', { exact: true }).selectOption({ label: 'Maya (student B)' });
    await form.getByLabel('How is it going?').selectOption({ label: 'Needs attention' });
    await form.getByLabel('Details').fill('Struggles with the past tense.');
    await form.getByRole('button', { name: 'Send feedback' }).click();
    await expect(form.getByRole('status').filter({ hasText: 'Sent.' })).toBeVisible();
    await expect(mine.getByRole('listitem')).toHaveCount(2);

    await form.getByRole('radio', { name: 'Missing material' }).check();
    await form.getByLabel('What is missing').selectOption({ label: 'Listening material' });
    await form.getByLabel('Language (optional)').selectOption({ label: 'Spanish' });
    await form.getByLabel('Level (optional)').selectOption({ label: 'Level 1' });
    await form.getByLabel('Details').fill('Short dialogues for numbers.');
    await form.getByRole('button', { name: 'Send feedback' }).click();
    await expect(mine.getByRole('listitem')).toHaveCount(3);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // Forged: feedback about a student teacher X does not teach.
    const stranger = await studentNotTaughtByX();
    await form.getByRole('radio', { name: 'A student' }).check();
    await form.getByLabel('Student', { exact: true }).evaluate((el, id) => {
      const select = el as HTMLSelectElement;
      select.add(new Option('Someone else', id));
      select.value = id;
    }, stranger);
    await form.getByLabel('Details').fill('Not my student.');
    await form.getByRole('button', { name: 'Send feedback' }).click();
    await expect(form.locator('form').getByRole('alert')).toContainText('You can’t do this.');
    const { count } = await adminClient()
      .from('staff_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', stranger);
    expect(count).toBe(0);

    // Training links: https only, open in a new tab without access to this page.
    await page.goto('/teach/tools/resources');
    const link = page.getByRole('link', { name: /Open הערכת רמה לפי CEFR/ });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('href', /^https:\/\//);

    // A task for the manager.
    await page.goto('/teach/tools/tasks');
    const newTask = page.getByRole('region', { name: 'New task' });
    await newTask.getByLabel('Task').fill('Order whiteboard markers');
    await newTask.getByRole('checkbox', { name: 'Urgent' }).check();
    await newTask.getByRole('button', { name: 'Send task' }).click();
    const open = page.getByRole('region', { name: /^Open/ });
    await expect(open.getByRole('listitem')).toHaveCount(2);
    await expect(open).toContainText('Teacher X → Pedagogical manager');
    // Only the manager marks it done.
    await expect(open.getByRole('button', { name: /^Mark done/ })).toHaveCount(0);
    await page.context().clearCookies();

    // The manager.
    await signIn(page, USERS.manager);
    await passMfa(page, USERS.manager);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto('/manage/feedback');
    const missing = page.getByRole('region', { name: 'Missing material in group classes' });
    await expect(missing.getByRole('listitem')).toHaveCount(2); // French L1 (Y), Spanish L1 (X)
    await expect(missing).toContainText('Listening material');
    const all = page.getByRole('region', { name: 'All feedback' });
    await expect(all.getByRole('listitem')).toHaveCount(4);
    await expect(all).toContainText('Struggles with the past tense.');
    await all
      .getByRole('button', { name: /^Mark feedback from Teacher X/ })
      .first()
      .click();
    await expect(all.getByText('Handled by the manager')).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.goto('/manage/tasks');
    const managerOpen = page.getByRole('region', { name: /^Open/ });
    await managerOpen.getByRole('button', { name: 'Mark done: Order whiteboard markers' }).click();
    await expect(page.getByRole('region', { name: /^Done/ })).toContainText(
      'Order whiteboard markers',
    );

    // Training links: a new one, a refused one, then removed.
    await page.goto('/manage/resources');
    const add = page.getByRole('region', { name: 'Add a link' });
    await add.getByLabel('Title').fill('Bad link');
    await add.getByLabel('Link (https://…)').fill('javascript:alert(1)');
    await add.getByRole('button', { name: 'Add link' }).click();
    await expect(add.getByRole('alert')).toContainText('Check the form and try again.');
    await add.getByLabel('Title').fill('Classroom routines');
    await add.getByLabel('Link (https://…)').fill('https://example.com/routines');
    await add.getByRole('button', { name: 'Add link' }).click();
    await expect(page.getByRole('heading', { name: 'Classroom routines' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove Classroom routines' }).click();
    await expect(page.getByRole('heading', { name: 'Classroom routines' })).toHaveCount(0);
  });

  test('other teachers and students see none of it', async ({ page }) => {
    await signIn(page, USERS.teacherY);
    await page.goto('/teach/tools/feedback');
    await expect(page.getByText('Missed two classes')).toHaveCount(0);
    await page.goto('/teach/tools/tasks');
    await expect(page.getByText('Approve the new Russian level notebook')).toHaveCount(0);
    expect((await page.goto('/manage/feedback'))?.status()).toBe(404);
    await page.context().clearCookies();

    await signIn(page, USERS.studentA);
    for (const path of [
      '/teach/tools',
      '/teach/tools/feedback',
      '/teach/tools/resources',
      '/office/tasks',
    ]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });
});
