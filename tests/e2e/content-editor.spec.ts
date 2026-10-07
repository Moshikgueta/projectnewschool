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
    await expect(page.getByLabel('Page content (YAML)')).toHaveValue('blocks: []\n');
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
    for (const path of [`/manage/content/${COURSE}`, `/manage/content/sections/${HOLA}`]) {
      expect((await page.goto(path))?.status(), `${who} ${path}`).toBe(404);
    }
    await page.context().clearCookies();
  }
});
