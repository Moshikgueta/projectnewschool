import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { IDS, USERS, adminClient, signIn, signOut } from './helpers';

// Strings that exist only in answer keys of the fixture activity. If any of
// them appears in a page, a key has leaked to the browser.
const KEY_ONLY = ['Chao', 'That says where you are from', '"accept"', '"optionIds":["o1"]'];

async function expectNoKeys(page: Page) {
  const html = await page.content();
  for (const s of KEY_ONLY) expect(html, s).not.toContain(s);
}

const status = (page: Page) => page.getByRole('status').filter({ hasNotText: /^$/ }).last();

test.describe('exercises', () => {
  test('a student completes every exercise type; results survive signing out and in', async ({
    page,
  }) => {
    await signIn(page, USERS.studentA);

    // Reached from the workbook, where the exercise is embedded.
    await page.goto(`/learn/workbook/${IDS.sectionPractica}`);
    await page.getByRole('link', { name: 'Open the exercise' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Greetings: every exercise type',
    );
    await expect(page.getByText('6 questions')).toBeVisible();
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page).toHaveURL(/\/learn\/attempts\//);
    await expectNoKeys(page);

    // 1. Multiple choice: a wrong answer gets the option's feedback, then the right one.
    await expect(page.getByRole('heading', { name: 'Question 1 of 6' })).toBeVisible();
    await page.getByRole('radio', { name: 'Tengo diez años.' }).check();
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Not quite. Try again.')).toBeVisible();
    await expect(page.getByText('That says how old you are.')).toBeVisible();
    await page.getByRole('radio', { name: 'Me llamo Ana.' }).check();
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Correct!', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Me llamo Ana.' })).toBeDisabled();
    await page.getByRole('button', { name: 'Next' }).click();

    // 2. True / false.
    await page.getByRole('radio', { name: 'True' }).check();
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Correct!', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // 3. Fill in the blanks: an incomplete answer is not sent; a missing accent is accepted with a reminder.
    await page.getByRole('textbox', { name: 'Blank 1' }).fill('llamo');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Answer every part first.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Blank 2' }).fill('adios');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Correct! Check the accent.')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // 4. Matching.
    await page.getByRole('combobox', { name: 'Match for “hola”' }).selectOption({ label: 'hello' });
    await page
      .getByRole('combobox', { name: 'Match for “adiós”' })
      .selectOption({ label: 'goodbye' });
    await page
      .getByRole('combobox', { name: 'Match for “gracias”' })
      .selectOption({ label: 'thank you' });
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Correct!', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // 5. Reorder the sentence by tapping the words.
    for (const word of ['Me', 'llamo', 'Ana.']) {
      await page.getByRole('button', { name: `Add “${word}”` }).click();
    }
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Correct!', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // 6. Short answer: saved for the teacher, not graded.
    await page.getByRole('textbox', { name: 'Your answer' }).fill('¡Buenos días, profe!');
    await page.getByRole('button', { name: 'Save answer' }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await expect(page.getByText('6 of 6 answered.').first()).toBeVisible();
    await expectNoKeys(page);
    await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
      .then((r) => expect(r.violations).toEqual([]));

    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByRole('heading', { name: 'Well done, you finished!' })).toBeVisible();
    // The first try counts: question 1 was wrong first.
    await expect(page.getByText('4 of 5 right on the first try.')).toBeVisible();
    await expectNoKeys(page);

    await signOut(page);
    await signIn(page, USERS.studentA);
    await page.goto('/learn/practice');
    await expect(page.getByRole('link', { name: /Greetings: every exercise type/ })).toContainText(
      'Done',
    );
    await page.getByRole('link', { name: /Greetings: every exercise type/ }).click();
    await expect(page.getByRole('heading', { name: 'Your earlier tries' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Practise again' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your earlier tries' })).toContainText(
      'finished',
    );
  });

  test('practice mode shows the answer after two wrong tries', async ({ page }) => {
    await signIn(page, USERS.studentB);
    await page.goto(`/learn/activities/${IDS.activityAllTypes}`);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('radio', { name: 'False' }).check();
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Not quite. Try again.')).toBeVisible();
    await expect(page.getByText('The answer:')).toHaveCount(0);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('The answer:')).toBeVisible();
    await expect(status(page)).toContainText('True');
  });

  test('progress is kept: leaving and signing in again resumes the same attempt', async ({
    page,
  }) => {
    await signIn(page, USERS.studentB);
    await page.goto(`/learn/activities/${IDS.activityAllTypes}`);
    // Student B started in the previous test: the same attempt continues.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/learn\/attempts\//);
    const url = page.url();
    await expect(page.getByRole('heading', { name: 'Question 1 of 6' })).toBeVisible();
    await page.getByRole('radio', { name: 'Me llamo Ana.' }).check();
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Correct!', { exact: true })).toBeVisible();

    await signOut(page);
    await signIn(page, USERS.studentB);
    const cont = page.getByRole('region', { name: 'Continue where you left off' });
    await expect(cont).toContainText('Greetings: every exercise type');
    await page.getByRole('link', { name: 'Continue learning' }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('progressbar', { name: 'Activity progress' })).toHaveAttribute(
      'aria-valuetext',
      '2 of 6 answered.',
    );
    // It opens at the first question that still needs a right answer: question 2,
    // answered wrongly in the previous test.
    await expect(page.getByRole('heading', { name: 'Question 2 of 6' })).toBeVisible();
  });

  test("a student cannot answer in another student's attempt, even by rewriting the request", async ({
    page,
  }) => {
    const admin = adminClient();
    // Student A has an open attempt on the activity.
    await admin
      .from('attempts')
      .delete()
      .eq('user_id', IDS.studentA)
      .eq('activity_id', IDS.activityAllTypes)
      .eq('status', 'in_progress');
    const { data: victim, error } = await admin
      .from('attempts')
      .insert({
        user_id: IDS.studentA,
        activity_id: IDS.activityAllTypes,
        course_id: '30000000-0000-4000-8000-000000000001',
        attempt_no: 99,
      })
      .select('id')
      .single();
    expect(error).toBeNull();

    // Student B opens their own attempt, then the request is rewritten in
    // flight to carry student A's attempt id instead.
    await signIn(page, USERS.studentB);
    await page.goto(`/learn/activities/${IDS.activityAllTypes}`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/learn\/attempts\//);
    const own = page.url().split('/').pop()!;
    let rewritten = false;
    await page.route(/\/learn\/attempts\//, async (route) => {
      const request = route.request();
      const body = request.postData();
      if (request.method() === 'POST' && body?.includes(own)) {
        rewritten = true;
        await route.continue({ postData: body.replaceAll(own, victim!.id) });
      } else {
        await route.continue();
      }
    });
    // Student B resumes at question 2 (true/false), still open from earlier tests.
    await expect(page.getByRole('heading', { name: 'Question 2 of 6' })).toBeVisible();
    await page.getByRole('radio', { name: 'True' }).check();
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Answer every part first.')).toBeVisible();
    expect(rewritten).toBe(true);

    // Nothing was written to student A's attempt.
    const { count } = await admin
      .from('responses')
      .select('id', { count: 'exact', head: true })
      .eq('attempt_id', victim!.id);
    expect(count).toBe(0);
    const { data: after } = await admin
      .from('attempts')
      .select('state')
      .eq('id', victim!.id)
      .single();
    expect(after?.state).toEqual({});

    // And the attempt page itself is a 404 for student B.
    await page.unroute(/\/learn\/attempts\//);
    expect((await page.goto(`/learn/attempts/${victim!.id}`))?.status()).toBe(404);
  });

  test('drafts and other courses are not reachable (404)', async ({ page }) => {
    await signIn(page, USERS.studentA);
    for (const id of [
      '70000000-0000-4000-8000-000000000002', // draft
      '70000000-0000-4000-8000-000000000003', // French course
      'not-a-uuid',
    ]) {
      expect((await page.goto(`/learn/activities/${id}`))?.status(), id).toBe(404);
    }
  });
});
