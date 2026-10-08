import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { adminClient, passMfa, signIn, USERS } from './helpers';

// The exercise editor (Phase 8, ADR-036): the pedagogical manager edits an
// exercise's questions in YAML with a preview of the answers. Questions that
// students have answered keep their options and answers: the editor refuses
// such a change and nothing is written; their wording can still change.

const CYCLE = '40000000-0000-4000-8000-000000000001';
const NUMBERS = '70000000-0000-4000-8000-000000000007';
const DOS_MAS_TRES = '80000000-0000-4000-8000-000000000071';

test('answered questions keep their answers; their wording can change', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const { data: before } = await admin
    .from('activity_items')
    .select('id, prompt, data, points, position')
    .eq('activity_id', NUMBERS)
    .order('position');
  const { data: keysBefore } = await admin
    .from('activity_item_keys')
    .select('item_id, answer, feedback')
    .in(
      'item_id',
      before!.map((i) => i.id),
    )
    .order('item_id');

  try {
    await signIn(page, USERS.manager);
    await passMfa(page, USERS.manager);
    await page.goto(`/manage/content/cycles/${CYCLE}`);
    await page.getByRole('link', { name: 'Edit Numbers 1–10' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Numbers 1–10');
    await expect(page.getByText('This exercise is published')).toBeVisible();
    await expect(page.getByText('3 questions have answers from students')).toBeVisible();

    const preview = page.getByRole('region', { name: 'Preview with answers' });
    await expect(preview.getByText('answered', { exact: false })).toHaveCount(3);
    await expect(preview.getByText('Answer: cinco')).toBeVisible();

    // In the form, an answered question says it is locked and cannot be removed.
    await expect(page.getByRole('button', { name: 'Remove question 1' })).toBeDisabled();
    await page.getByRole('button', { name: /^Question 1/ }).click();
    await expect(page.getByText('its options and answers can’t change')).toBeVisible();

    await page.getByRole('button', { name: 'YAML', exact: true }).click();
    const editor = page.getByLabel('Questions (YAML)');
    const yaml = await editor.inputValue();
    expect(yaml).toContain('dos-mas-tres');

    // Changing an answered question's options is refused, and nothing is written.
    await editor.fill(yaml.replace('text: seis', 'text: ocho'));
    await expect(page.locator('#activity-yaml-problems')).toContainText('No problems.');
    await page.getByRole('button', { name: 'Save content' }).click();
    await expect(page.locator('#activity-yaml-problems')).toContainText(
      'options and answers can’t change',
    );
    await expect(page.locator('#activity-yaml-problems')).toContainText('dos-mas-tres');
    const { data: untouched } = await admin
      .from('activity_items')
      .select('id, prompt, data, points, position')
      .eq('activity_id', NUMBERS)
      .order('position');
    expect(untouched).toEqual(before);
    const { count: sources } = await admin
      .from('activity_sources')
      .select('activity_id', { count: 'exact', head: true })
      .eq('activity_id', NUMBERS);
    expect(sources).toBe(0);

    // Rewording the same question, with the options in another order, is saved;
    // its options, their ids and the key stay as they were.
    await editor.fill(yaml.replace('Dos más tres son…', '¿Cuánto es dos más tres?'));
    await page.getByRole('button', { name: 'Save content' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    const { data: after } = await admin
      .from('activity_items')
      .select('id, prompt, data, points, position')
      .eq('activity_id', NUMBERS)
      .order('position');
    expect(JSON.stringify(after![0]!.prompt)).toContain('¿Cuánto es dos más tres?');
    expect(after!.map((i) => i.data)).toEqual(before!.map((i) => i.data));
    const { data: keysAfter } = await admin
      .from('activity_item_keys')
      .select('item_id, answer, feedback')
      .in(
        'item_id',
        before!.map((i) => i.id),
      )
      .order('item_id');
    expect(keysAfter!.map((k) => k.answer)).toEqual(keysBefore!.map((k) => k.answer));

    // Student A's past answers still count: their attempt is unchanged.
    const { count: responses } = await admin
      .from('responses')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', DOS_MAS_TRES);
    expect(responses).toBeGreaterThan(0);
  } finally {
    for (const item of before!) {
      await admin.from('activity_items').update({ prompt: item.prompt }).eq('id', item.id);
    }
    for (const key of keysBefore!) {
      await admin
        .from('activity_item_keys')
        .update({ feedback: key.feedback })
        .eq('item_id', key.item_id);
    }
    await admin.from('activity_sources').delete().eq('activity_id', NUMBERS);
  }
});

test('the manager adds an exercise, writes questions and sees their answers', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  try {
    await signIn(page, USERS.manager);
    await passMfa(page, USERS.manager);
    await page.goto(`/manage/content/cycles/${CYCLE}`);
    await page.locator('#activity-new-title').fill('E2E: greetings check');
    await page.locator('#activity-new-slug').fill('e2e-greetings-check');
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await expect(page).toHaveURL(/\/manage\/content\/activities\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E: greetings check');

    await page.getByRole('button', { name: 'YAML', exact: true }).click();
    const editor = page.getByLabel('Questions (YAML)');
    const yaml = await editor.inputValue();
    expect(yaml).toContain('question-1');

    // A mistake is shown where it is; saving waits.
    await editor.fill(
      `${yaml.trimEnd()}\n  - id: question-2\n    type: trueFalse\n    prompt: x\n`,
    );
    await expect(page.locator('#activity-yaml-problems')).toContainText('items[1]');
    await expect(page.getByRole('button', { name: 'Save content' })).toBeDisabled();

    await editor.fill(
      `${yaml.trimEnd()}\n  - id: question-2\n    type: trueFalse\n    prompt: "«Buenas noches» se dice por la mañana."\n    answer: false\n`,
    );
    const preview = page.getByRole('region', { name: 'Preview with answers' });
    await expect(preview.getByText('Answer: False')).toBeVisible();
    await expect(preview.getByText('Answer: The right answer')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Save content' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

    const { data: activity } = await admin
      .from('activities')
      .select('id, status, items:activity_items ( slug, type, keys:activity_item_keys ( answer ) )')
      .eq('slug', 'e2e-greetings-check')
      .single();
    expect(activity!.status).toBe('draft');
    const items = [...activity!.items].sort((a, b) => a.slug.localeCompare(b.slug));
    expect(items.map((i) => [i.slug, i.type])).toEqual([
      ['question-1', 'multipleChoice'],
      ['question-2', 'trueFalse'],
    ]);
    expect(JSON.stringify(items[1]!.keys)).toContain('false');

    // Removing a question no one has answered removes it.
    await page.reload();
    await page.getByRole('button', { name: 'YAML', exact: true }).click();
    await editor.fill(yaml);
    await page.getByRole('button', { name: 'Save content' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    const { count } = await admin
      .from('activity_items')
      .select('id', { count: 'exact', head: true })
      .eq('activity_id', activity!.id);
    expect(count).toBe(1);
  } finally {
    await admin.from('activities').delete().like('slug', 'e2e-%');
  }
});

test('the manager writes questions with the form, and switches to YAML', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  try {
    await signIn(page, USERS.manager);
    await passMfa(page, USERS.manager);
    await page.goto(`/manage/content/cycles/${CYCLE}`);
    await page.locator('#activity-new-title').fill('E2E: form check');
    await page.locator('#activity-new-slug').fill('e2e-form-check');
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E: form check');

    // The example question, rewritten in its form.
    await page.getByRole('button', { name: /^Question 1/ }).click();
    await page.locator('#question-1-prompt').fill('¿Cómo te llamas?');
    await page.locator('#question-1-options-0-text').fill('Me llamo Ana.');
    await page.locator('#question-1-options-1-text').fill('Tengo diez años.');

    // A true-or-false question added from the list of types.
    await page.getByLabel('Question type').selectOption({ label: 'True or false' });
    await page.getByRole('button', { name: 'Add question' }).click();
    await page.locator('#question-2-prompt').fill('«Buenas noches» se dice por la mañana.');
    await expect(page.locator('#activity-yaml-problems')).toContainText('No problems.');
    await page.locator('#question-2-form').getByLabel('The statement is true').uncheck();

    const preview = page.getByRole('region', { name: 'Preview with answers' });
    await expect(preview.getByText('Answer: Me llamo Ana.')).toBeVisible();
    await expect(preview.getByText('Answer: False')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // A question left without a prompt is pointed out on its card; saving waits.
    await page.getByRole('button', { name: 'Add question' }).click();
    await expect(page.getByRole('button', { name: /^Question 3.*1 problem/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save content' })).toBeDisabled();
    await page.getByRole('button', { name: 'Remove question 3' }).click();

    await page.getByRole('button', { name: 'Save content' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    const { data: activity } = await admin
      .from('activities')
      .select('id, items:activity_items ( slug, type )')
      .eq('slug', 'e2e-form-check')
      .single();
    expect(
      [...activity!.items].sort((a, b) => a.slug.localeCompare(b.slug)).map((i) => i.type),
    ).toEqual(['multipleChoice', 'trueFalse']);

    // The YAML view shows the same document.
    await page.getByRole('button', { name: 'YAML', exact: true }).click();
    const yaml = await page.getByLabel('Questions (YAML)').inputValue();
    expect(yaml).toContain('Me llamo Ana.');
    expect(yaml).toContain('answer: false');
  } finally {
    await admin.from('activities').delete().like('slug', 'e2e-%');
  }
});
