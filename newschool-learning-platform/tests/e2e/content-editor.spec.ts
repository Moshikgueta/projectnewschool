import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { adminClient, IDS, passMfa, signIn, USERS } from './helpers';

// The content editor (Phase 8, ADR-034): the pedagogical manager edits a
// published notebook page in YAML, sees problems and a preview as they type,
// saves, and students see the change. A save never overwrites a newer one.

const COURSE = '30000000-0000-4000-8000-000000000001';
const HOLA = IDS.sectionHola;

test('the manager edits a page; students see it; a stale save is refused', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const { data: original } = await admin
    .from('book_sections')
    .select('title, blocks, edited_in_app_at')
    .eq('id', HOLA)
    .single();
  const { data: originalNotes } = await admin
    .from('section_teacher_notes')
    .select('blocks')
    .eq('section_id', HOLA)
    .single();

  try {
    await signIn(page, USERS.manager);
    await passMfa(page, USERS.manager);
    await page.goto('/manage');
    await page.getByRole('link', { name: 'Español básico (fixture)' }).click();
    await expect(page).toHaveURL(`/manage/content/${COURSE}`);
    await page.getByRole('link', { name: 'Introducing yourself' }).click();
    await page.getByRole('link', { name: 'Edit ¡Hola!' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('¡Hola!');
    await expect(page.getByText('This page is published')).toBeVisible();

    await page.getByRole('button', { name: 'YAML', exact: true }).click();
    const editor = page.getByLabel('Page content (YAML)');
    const yaml = await editor.inputValue();
    expect(yaml).toMatch(/^blocks:/);

    // Problems appear as you type, with where they are; saving waits.
    await editor.fill('blocks:\n  - id: x\n    type: heading\n    level: 9\n    text: Hi\n');
    await expect(page.locator('#section-yaml-problems')).toContainText('blocks[0].level');
    await expect(page.getByRole('button', { name: 'Save content' })).toBeDisabled();

    // A new block, previewed, then saved. Markup typed into text stays text.
    // Inserted at the end of the blocks list (teacher notes follow it).
    const newBlock =
      '  - id: e2e-note\n    type: text\n    text: "Practise at home **every day**. <img src=x onerror=alert(1)>"\n';
    const added = yaml.includes('\nteacherNotes:')
      ? yaml.replace('\nteacherNotes:', `\n${newBlock}teacherNotes:`)
      : `${yaml.trimEnd()}\n${newBlock}`;
    await editor.fill(added);
    await expect(page.locator('#section-yaml-problems')).toContainText('No problems.');
    const preview = page.getByRole('region', { name: 'Preview' });
    await expect(preview.getByText('every day', { exact: true })).toBeVisible();
    await expect(preview.locator('img')).toHaveCount(0);
    await preview.getByRole('button', { name: 'Teacher view' }).click();
    await expect(preview.getByRole('button', { name: 'Teacher view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Save content' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

    // Someone else saves meanwhile: this editor's next save is refused.
    await admin.from('book_sections').update({ title: '¡Hola!' }).eq('id', HOLA);
    await editor.fill(added.replace('every day', 'every single day'));
    await page.getByRole('button', { name: 'Save content' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Someone saved this page' }),
    ).toBeVisible();
    const { data: stored } = await admin
      .from('book_sections')
      .select('blocks')
      .eq('id', HOLA)
      .single();
    expect(JSON.stringify(stored!.blocks)).toContain('every day');
    expect(JSON.stringify(stored!.blocks)).not.toContain('every single day');

    // A new draft page, which students don't see.
    await page.getByRole('link', { name: /^Back to/ }).click();
    const add = page.getByRole('region', { name: 'Add a page' });
    await add.getByLabel('Page title').fill('E2E extra page');
    await add.getByLabel('Short name').fill('e2e-extra');
    await add.getByRole('button', { name: 'Add a page' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E extra page');
    await expect(page.getByText('This page has no blocks yet.')).toBeVisible();
    const draftUrl = page.url();
    await page.context().clearCookies();

    // The student sees the saved change, and not the draft page.
    await signIn(page, USERS.studentA);
    await page.goto(`/learn/notebook/${HOLA}`);
    await expect(page.getByText('every day', { exact: true })).toBeVisible();
    const draftId = draftUrl.split('/').pop()!;
    expect((await page.goto(`/learn/notebook/${draftId}`))?.status()).toBe(404);
  } finally {
    await admin
      .from('book_sections')
      .update({
        title: original!.title,
        blocks: original!.blocks,
        edited_in_app_at: original!.edited_in_app_at,
      })
      .eq('id', HOLA);
    await admin
      .from('section_teacher_notes')
      .update({ blocks: originalNotes!.blocks })
      .eq('section_id', HOLA);
    await admin.from('book_sections').delete().like('slug', 'e2e-%');
  }
});

test('teachers and students cannot open the editor', async ({ page }) => {
  for (const who of [USERS.teacherX, USERS.studentA]) {
    await signIn(page, who);
    for (const path of [
      `/manage/content/${COURSE}`,
      `/manage/content/sections/${HOLA}`,
      `/manage/content/activities/${IDS.activityAllTypes}`,
    ]) {
      expect((await page.goto(path))?.status(), `${who} ${path}`).toBe(404);
    }
    await page.context().clearCookies();
  }
});

test('the form editor: add, fill, move and remove blocks, and anchor a teacher note', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const { data: original } = await admin
    .from('book_sections')
    .select('title, blocks, edited_in_app_at')
    .eq('id', HOLA)
    .single();
  const { data: originalNotes } = await admin
    .from('section_teacher_notes')
    .select('blocks')
    .eq('section_id', HOLA)
    .single();
  const before = (original!.blocks as unknown[]).length;

  try {
    await signIn(page, USERS.manager);
    await passMfa(page, USERS.manager);
    await page.goto(`/manage/content/sections/${HOLA}`);
    await expect(page.getByRole('button', { name: 'Form', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // A new vocabulary block: it opens, and saving waits until it is filled in.
    await page.getByLabel('Block type').selectOption({ label: 'Vocabulary' });
    await page.getByRole('button', { name: 'Add block' }).click();
    await expect(page.getByRole('button', { name: 'Save content' })).toBeDisabled();
    const block = page.locator('#vocabulary-1-form');
    await block.getByLabel('Term').fill('la casa');
    await block.getByLabel('Translation or explanation').fill('בית');
    await block.getByRole('button', { name: 'Add to Items' }).click();
    await block.getByLabel('Term').nth(1).fill('el perro');
    await block.getByLabel('Translation or explanation').nth(1).fill('כלב');
    await expect(page.locator('#section-yaml-problems')).toContainText('No problems.');
    const preview = page.getByRole('region', { name: 'Preview' });
    await expect(preview.getByText('la casa')).toBeVisible();
    await expect(preview.getByText('el perro')).toBeVisible();

    // Move it up one place, and anchor a teacher note to it.
    await page.getByRole('button', { name: `Move block ${before + 1} up` }).click();
    await page.getByRole('button', { name: 'Add a teacher note' }).click();
    const notes = page.getByRole('group', { name: 'Teacher notes' });
    await notes
      .getByLabel('Shown after')
      .last()
      .selectOption({ label: `${before}. Vocabulary · la casa` });
    await notes.getByLabel('Text').last().fill('Point at things in the room.');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // The same page in YAML, and back.
    await page.getByRole('button', { name: 'YAML', exact: true }).click();
    const yaml = await page.getByLabel('Page content (YAML)').inputValue();
    expect(yaml).toContain('type: vocabulary');
    expect(yaml).toContain('term: la casa');
    expect(yaml).toContain('anchor: vocabulary-1');
    await page.getByRole('button', { name: 'Form', exact: true }).click();

    await page.getByRole('button', { name: 'Save content' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    const { data: stored } = await admin
      .from('book_sections')
      .select('blocks')
      .eq('id', HOLA)
      .single();
    const blocks = stored!.blocks as { id: string; type: string; items?: { term: string }[] }[];
    expect(blocks).toHaveLength(before + 1);
    expect(blocks[before - 1]).toMatchObject({
      id: 'vocabulary-1',
      type: 'vocabulary',
      items: [
        { term: 'la casa', gloss: 'בית' },
        { term: 'el perro', gloss: 'כלב' },
      ],
    });
    const { data: storedNotes } = await admin
      .from('section_teacher_notes')
      .select('blocks')
      .eq('section_id', HOLA)
      .single();
    expect(storedNotes!.blocks).toContainEqual(
      expect.objectContaining({ anchor: 'vocabulary-1', text: 'Point at things in the room.' }),
    );

    // Removing the block moves its note to the top of the page.
    await page.getByRole('button', { name: `Remove block ${before}` }).click();
    await page.getByRole('button', { name: 'YAML', exact: true }).click();
    const after = await page.getByLabel('Page content (YAML)').inputValue();
    expect(after).not.toContain('id: vocabulary-1');
    expect(after).toMatch(/anchor: null\n\s+text: Point at things in the room\./);
  } finally {
    await admin
      .from('book_sections')
      .update({
        title: original!.title,
        blocks: original!.blocks,
        edited_in_app_at: original!.edited_in_app_at,
      })
      .eq('id', HOLA);
    await admin
      .from('section_teacher_notes')
      .update({ blocks: originalNotes!.blocks })
      .eq('section_id', HOLA);
  }
});

test('every block type can be added and shows its form (nothing saved)', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, USERS.manager);
  await passMfa(page, USERS.manager);
  await page.goto(`/manage/content/sections/${HOLA}`);
  const select = page.getByLabel('Block type');
  const types = await select.locator('option').allTextContents();
  expect(types).toHaveLength(18);
  for (const label of types) {
    await select.selectOption({ label });
    await page.getByRole('button', { name: 'Add block' }).click();
    const opened = page.locator('[id$="-form"]').last();
    await expect(opened, label).toBeVisible();
    await expect(opened.locator('input, textarea, select').first(), label).toBeVisible();
  }
  // Nothing written while trying them out.
  const { data } = await adminClient()
    .from('book_sections')
    .select('blocks')
    .eq('id', HOLA)
    .single();
  expect(JSON.stringify(data!.blocks)).not.toContain('"heading-1"');
});
