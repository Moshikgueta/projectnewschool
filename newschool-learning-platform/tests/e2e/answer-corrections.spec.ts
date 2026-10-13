import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { adminClient, IDS, passMfa, signIn, signOut, USERS } from './helpers';

// Correcting the answer of an answered question (ADR-041, owner decision
// 2026-10-13): a student answers a question whose key is wrong and reports
// it; the pedagogical manager opens the report, corrects the answer with a
// reason after seeing the effect; the student's past answer is re-checked and
// their score goes up. The teacher who wrote the exercise sees no such action.

const COURSE = '30000000-0000-4000-8000-000000000001';
const CYCLE = '40000000-0000-4000-8000-000000000001';
const TEACHER_X = '00000000-0000-4000-8000-0000000000b1';
const SLUG = 'e2e-correction-check';
const TITLE = 'E2E: correction check';

test('the manager corrects a wrong answer key; past answers are re-checked', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  async function cleanUp() {
    const { data } = await admin.from('activities').select('id').eq('slug', SLUG);
    const ids = (data ?? []).map((a) => a.id);
    if (!ids.length) return;
    // Answers first: an answered question cannot be removed (ADR-036).
    await admin.from('attempts').delete().in('activity_id', ids);
    await admin.from('activities').delete().in('id', ids);
  }
  await cleanUp();

  // A published exercise teacher X wrote and gave to group X, whose key is
  // wrong: it says "Tengo diez años." answers "¿Cómo te llamas?".
  const { data: activity } = await admin
    .from('activities')
    .insert({
      course_id: COURSE,
      cycle_id: CYCLE,
      slug: SLUG,
      title: TITLE,
      scoring_mode: 'scored',
      status: 'published',
      created_by: TEACHER_X,
    })
    .select('id')
    .single();
  const activityId = activity!.id;
  const { data: item } = await admin
    .from('activity_items')
    .insert({
      activity_id: activityId,
      course_id: COURSE,
      slug: 'nombre',
      position: 1,
      type: 'multipleChoice',
      prompt: [{ id: 'prompt', type: 'text', text: '¿Cómo te llamas?', lang: 'es' }],
      data: {
        options: [
          { id: 'o1', text: 'Me llamo Ana.' },
          { id: 'o2', text: 'Tengo diez años.' },
        ],
        multiple: false,
      },
    })
    .select('id')
    .single();
  const itemId = item!.id;
  await admin
    .from('activity_item_keys')
    .insert({ item_id: itemId, course_id: COURSE, answer: { optionIds: ['o2'] }, feedback: {} });
  await admin.from('activity_sources').insert({
    activity_id: activityId,
    course_id: COURSE,
    source: {
      instructions: [],
      items: [
        {
          id: 'nombre',
          type: 'multipleChoice',
          prompt: '¿Cómo te llamas?',
          lang: 'es',
          points: 1,
          feedback: {},
          options: [
            { text: 'Me llamo Ana.', correct: false },
            { text: 'Tengo diez años.', correct: true },
          ],
        },
      ],
    },
  });
  await admin.from('assignments').insert({
    group_id: IDS.groupX,
    course_id: COURSE,
    activity_id: activityId,
    audience: 'group',
    phase: 'after_class',
    assigned_by: TEACHER_X,
  });

  try {
    // ── student A answers what is really right, and gets 0 ────────────────
    await signIn(page, USERS.studentA);
    await page.goto(`/learn/activities/${activityId}`);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page).toHaveURL(/\/learn\/attempts\//);
    const attemptUrl = new URL(page.url()).pathname;
    const attemptId = attemptUrl.split('/').pop()!;
    await page.getByRole('radio', { name: 'Me llamo Ana.' }).check();
    await page.getByRole('button', { name: 'Save answer' }).click();
    await expect(page.getByText('Saved. You will see your results at the end.')).toBeVisible();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByText('Your score: 0 of 1')).toBeVisible();
    await signOut(page);

    // …and reports it (written as the student would, in their name).
    const { data: report } = await admin
      .from('content_reports')
      .insert({
        reporter_id: IDS.studentA,
        course_id: COURSE,
        activity_id: activityId,
        item_id: itemId,
        message: 'E2E: "Me llamo Ana." is the right answer.',
      })
      .select('id')
      .single();

    // ── teacher X, who wrote it, sees the lock but no correction ──────────
    await signIn(page, USERS.teacherX);
    await page.goto(`/teach/exercises/${activityId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE);
    await page.getByRole('button', { name: /^Question 1/ }).click();
    await expect(page.getByText('its options and answers can’t change')).toBeVisible();
    await expect(page.getByRole('button', { name: /Correct the answer/ })).toHaveCount(0);
    // The manager's editor (where the correction lives) is not theirs: 404.
    expect(
      (await page.goto(`/manage/content/activities/${activityId}?correct=${itemId}`))?.status(),
    ).toBe(404);
    await page.goto('/teach');
    await signOut(page);

    // ── the manager goes from the report to the correction ───────────────
    await signIn(page, USERS.manager);
    await passMfa(page, USERS.manager);
    await page.goto('/manage/reports');
    await page.getByRole('link', { name: `Correct the answer of ${TITLE} · question 1` }).click();
    await expect(page).toHaveURL(new RegExp(`/manage/content/activities/${activityId}\\?`));
    const panel = page.getByRole('region', { name: 'Correct the answer' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('the report will be marked resolved')).toBeVisible();

    // The confirmation waits for the effect to be checked and a reason.
    const confirm = panel.getByRole('button', { name: 'Confirm the correction' });
    await expect(confirm).toBeDisabled();
    await panel.getByRole('checkbox', { name: 'Me llamo Ana.' }).check();
    await panel.getByRole('checkbox', { name: 'Tengo diez años.' }).uncheck();
    await panel.getByRole('button', { name: 'Check the effect' }).click();
    await expect(panel.getByText('One answer changes from wrong to right.')).toBeVisible();
    await expect(panel.getByText('0 answers change from right to wrong.')).toBeVisible();
    await expect(panel.getByText('Results change for one student (one attempt).')).toBeVisible();
    await expect(confirm).toBeDisabled();
    await panel.getByLabel('Why is the answer corrected?').fill('The key marked the wrong option.');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await confirm.click();
    await expect(
      panel.getByText('Corrected. One past answer re-checked: 1 now right, 0 now wrong.'),
    ).toBeVisible();

    // Stored: the key, the student's answer, their score, the record, the report.
    const { data: key } = await admin
      .from('activity_item_keys')
      .select('answer')
      .eq('item_id', itemId)
      .single();
    expect(key!.answer).toEqual({ optionIds: ['o1'] });
    const { data: responses } = await admin
      .from('responses')
      .select('is_correct, score')
      .eq('item_id', itemId);
    expect(responses).toEqual([{ is_correct: true, score: 1 }]);
    const { data: attempt } = await admin
      .from('attempts')
      .select('score, max_score')
      .eq('id', attemptId)
      .single();
    expect(attempt).toEqual({ score: 1, max_score: 1 });
    const { data: records } = await admin
      .from('item_corrections')
      .select('reason, report_id, became_correct, became_incorrect, regraded_at')
      .eq('item_id', itemId);
    expect(records).toHaveLength(1);
    expect(records![0]).toMatchObject({
      reason: 'The key marked the wrong option.',
      report_id: report!.id,
      became_correct: 1,
      became_incorrect: 0,
    });
    expect(records![0]!.regraded_at).not.toBeNull();
    const { data: resolved } = await admin
      .from('content_reports')
      .select('status')
      .eq('id', report!.id)
      .single();
    expect(resolved!.status).toBe('resolved');

    // The editor and the report say it was corrected.
    await expect(
      page.getByText(/Answer corrected on .*: The key marked the wrong option\./),
    ).toBeVisible();
    await page.goto('/manage/reports?status=resolved');
    await expect(
      page.getByText(/Answer corrected .*: The key marked the wrong option\./),
    ).toBeVisible();
    await signOut(page);

    // ── the student's result follows the corrected answer ────────────────
    await signIn(page, USERS.studentA);
    await page.goto(attemptUrl);
    await expect(page.getByText('Your score: 1 of 1')).toBeVisible();
    await expect(page.getByText('Right', { exact: true })).toBeVisible();
    await expect(page.getByText(/This question’s answer was corrected on/)).toBeVisible();
  } finally {
    await cleanUp();
  }
});
