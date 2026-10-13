import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { adminClient, IDS, passMfa, PASSWORD, signIn, signOut, USERS } from './helpers';

// Pilot release and "report a mistake" (ADR-040). Seed (reset by
// global-setup): Spanish L1 is a pilot course (group X: students A, B, D;
// teacher X); French L1 (group Y: B, C; teacher Y) is not. No reports.

const STUDENT_D = '00000000-0000-4000-8000-0000000000a4';
const MESSAGE = 'Option two could also be right.';

test.describe('pilot courses', () => {
  test.afterAll(async () => {
    // Student D's attempt at the every-type exercise, so other specs see the seed.
    const admin = adminClient();
    await admin
      .from('attempts')
      .delete()
      .eq('user_id', STUDENT_D)
      .eq('activity_id', IDS.activityAllTypes);
    await admin
      .from('learning_events')
      .delete()
      .eq('user_id', STUDENT_D)
      .eq('activity_id', IDS.activityAllTypes);
    // And D's visit to the notebook page reported on.
    await admin
      .from('section_progress')
      .delete()
      .eq('user_id', STUDENT_D)
      .eq('book_section_id', IDS.sectionHola);
    await admin
      .from('learning_events')
      .delete()
      .eq('user_id', STUDENT_D)
      .eq('section_id', IDS.sectionHola);
    await admin.from('content_reports').delete().neq('message', '');
  });

  test('a student sees the pilot badge on a pilot course only', async ({ page }) => {
    await signIn(page, USERS.studentD);
    await expect(page.getByText('Pilot', { exact: true })).toBeVisible();
    await expect(page.getByText(/This course is new\./)).toBeVisible();
    for (const path of ['/learn/notebook', '/learn/practice']) {
      await page.goto(path);
      await expect(page.getByText('Pilot', { exact: true }), path).toBeVisible();
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await signOut(page);

    // Student C studies only French L1, a regular course.
    await signIn(page, USERS.studentC);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Pilot', { exact: true })).toHaveCount(0);
  });

  test('a student reports a mistake; the manager sees and resolves it; other students cannot see it', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Student D reports a mistake in question 1 of the every-type exercise.
    await signIn(page, USERS.studentD);
    await page.goto(`/learn/activities/${IDS.activityAllTypes}`);
    await expect(page.getByText('Pilot', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('heading', { name: 'Question 1 of 6' })).toBeVisible();
    await page.getByRole('button', { name: 'Report a mistake' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report a mistake' });
    await expect(dialog).toBeVisible();
    // Nothing written: the message is required.
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByText('Write what is wrong (up to 500 characters).')).toBeVisible();
    await dialog.getByLabel('What is wrong?').fill(MESSAGE);
    await dialog.getByLabel('I think the right answer is (optional)').fill('Soy de Haifa.');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByText('Thank you! We will check it and fix it.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();

    // And a mistake on a notebook page.
    await page.goto(`/learn/notebook/${IDS.sectionHola}`);
    await page.getByRole('button', { name: 'Report a mistake' }).click();
    const pageDialog = page.getByRole('dialog', { name: 'Report a mistake' });
    await pageDialog.getByLabel('What is wrong?').fill('The culture note is about Spain only.');
    await pageDialog.getByRole('button', { name: 'Send report' }).click();
    await expect(pageDialog.getByText('Thank you! We will check it and fix it.')).toBeVisible();
    await pageDialog.getByRole('button', { name: 'Close' }).click();
    await signOut(page);

    // Stored once each, in D's own name, about the right things.
    const { data: stored } = await adminClient()
      .from('content_reports')
      .select('reporter_id, activity_id, item_id, book_section_id, suggested_answer, status')
      .order('created_at');
    expect(stored).toEqual([
      {
        reporter_id: STUDENT_D,
        activity_id: IDS.activityAllTypes,
        item_id: '80000000-0000-4000-8000-000000000061',
        book_section_id: null,
        suggested_answer: 'Soy de Haifa.',
        status: 'open',
      },
      {
        reporter_id: STUDENT_D,
        activity_id: null,
        item_id: null,
        book_section_id: IDS.sectionHola,
        suggested_answer: '',
        status: 'open',
      },
    ]);

    // Student B, a classmate, cannot read them through the API either.
    const b = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    await b.auth.signInWithPassword({ email: USERS.studentB, password: PASSWORD });
    const { data: seenByB, error } = await b.from('content_reports').select('id, message');
    expect(error).toBeNull();
    expect(seenByB).toEqual([]);
    await b.auth.signOut();
    // Nor through the app: the report pages are staff pages.
    await signIn(page, USERS.studentB);
    for (const path of ['/manage/reports', '/teach/reports']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await page.goto('/learn');
    await signOut(page);

    // Teacher Y (French only) sees no report; teacher X (Spanish) sees both.
    await signIn(page, USERS.teacherY);
    await page.goto('/teach/reports');
    await expect(page.getByText('No reports here.')).toBeVisible();
    await signOut(page);
    await signIn(page, USERS.teacherX);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Reports' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mistake reports');
    await expect(page.getByText(MESSAGE)).toBeVisible();
    await expect(page.getByText('2 reports')).toBeVisible();
    await signOut(page);

    // The manager sees both, with what the student suggested, and resolves one.
    await signIn(page, USERS.manager);
    await passMfa(page, USERS.manager);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Reports' })
      .click();
    await expect(page).toHaveURL(/\/manage\/reports/);
    const course = page.getByRole('region', { name: 'Español básico (fixture)' });
    await expect(course.getByText('2 reports')).toBeVisible();
    const card = course.getByRole('listitem').filter({ hasText: MESSAGE });
    await expect(card.getByText('Soy de Haifa.')).toBeVisible();
    await expect(
      card.getByText('Greetings: every exercise type · question 1', { exact: true }),
    ).toBeVisible();
    await expect(card.getByText(/From Lior \(student D\)/)).toBeVisible();
    await expect(card.getByRole('link', { name: 'Open in the editor' })).toHaveAttribute(
      'href',
      `/manage/content/activities/${IDS.activityAllTypes}`,
    );
    const pageCard = course.getByRole('listitem').filter({ hasText: 'Spain only' });
    await expect(pageCard.getByText('Page: ¡Hola!')).toBeVisible();
    await expect(pageCard.getByRole('link', { name: 'Open in the editor' })).toHaveAttribute(
      'href',
      `/manage/content/sections/${IDS.sectionHola}`,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await course
      .getByRole('button', { name: /^Mark the report of .* about Greetings: every exercise type/ })
      .click();
    await expect(course.getByText(MESSAGE)).toHaveCount(0);
    await expect(page.getByText('The culture note is about Spain only.')).toBeVisible();
    await page.getByRole('link', { name: 'Resolved', exact: true }).click();
    await expect(page.getByText(MESSAGE)).toBeVisible();
    await expect(page.getByText(/Resolved by Pedagogical manager/)).toBeVisible();

    const { data: resolved } = await adminClient()
      .from('content_reports')
      .select('status, resolved_by')
      .eq('item_id', '80000000-0000-4000-8000-000000000061')
      .single();
    expect(resolved).toEqual({
      status: 'resolved',
      resolved_by: '00000000-0000-4000-8000-0000000000c1',
    });
  });
});
