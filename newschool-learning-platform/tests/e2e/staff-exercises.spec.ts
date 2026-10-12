import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { adminClient, IDS, passMfa, signIn, signOut, USERS } from './helpers';

// One site, two ways in; and exercises written by teachers (ADR-038): a
// teacher writes one, publishes it and gives it to their group; a student of
// that group finds it in their homework and answers it; a student of another
// group cannot reach it, even with its address.

test('signed out, "/" offers the student and the staff sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to New School');
  const student = page.getByRole('link', { name: /^Student login/ });
  const staff = page.getByRole('link', { name: /^Staff login/ });
  await expect(student).toBeVisible();
  await expect(staff).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await student.click();
  await expect(page).toHaveURL(/\/login\/code$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in with your code');

  await page.goto('/');
  await staff.click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');

  // Students with an email have a quiet link of their own.
  await page.goto('/');
  await page.getByRole('link', { name: 'sign in here' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('a teacher writes an exercise for their group; only that group gets it', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const TITLE = 'E2E: staff check';
  let exerciseUrl = '';

  async function cleanUp() {
    const { data } = await admin.from('activities').select('id').like('slug', 'e2e-staff-check-%');
    const ids = (data ?? []).map((a) => a.id);
    if (!ids.length) return;
    // Answers first: an answered question cannot be removed (ADR-036).
    await admin.from('attempts').delete().in('activity_id', ids);
    await admin.from('activities').delete().in('id', ids);
  }
  await cleanUp();

  try {
    // ── teacher X writes, publishes and assigns ──────────────────────────
    await signIn(page, USERS.teacherX);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Exercises' })
      .click();
    await expect(page).toHaveURL(/\/teach\/exercises$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My exercises');
    // The cycle defaults to group X's active cycle.
    await expect(page.getByLabel('Course and cycle')).toHaveValue(
      '40000000-0000-4000-8000-000000000001',
    );
    await page.getByLabel('Title').fill(TITLE);
    await page.getByRole('button', { name: 'Create exercise' }).click();
    await expect(page).toHaveURL(/\/teach\/exercises\/[0-9a-f-]{36}$/);
    exerciseUrl = new URL(page.url()).pathname;
    const activityId = exerciseUrl.split('/').pop()!;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE);

    // The example question, rewritten in its form.
    await page.getByRole('button', { name: /^Question 1/ }).click();
    await page.locator('#question-1-prompt').fill('¿Cómo te llamas?');
    await page.locator('#question-1-options-0-text').fill('Me llamo Ana.');
    await page.locator('#question-1-options-1-text').fill('Tengo diez años.');
    const preview = page.getByRole('region', { name: 'Preview with answers' });
    await expect(preview.getByText('Answer: Me llamo Ana.')).toBeVisible();
    await page.getByRole('button', { name: 'Save content' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // A draft cannot be assigned yet.
    await expect(page.getByText('Publish the exercise to assign it to a group.')).toBeVisible();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published: groups it is assigned to see it now.')).toBeVisible();

    const assign = page.getByRole('region', { name: 'Groups and homework' });
    // Teacher X's groups of this course (another test may add one).
    await assign.getByLabel('Group').selectOption({ label: 'Spanish Level 1 · Tuesday (group X)' });
    await expect(assign.getByLabel('Group')).toHaveValue(IDS.groupX);
    await assign.getByRole('button', { name: 'Assign' }).click();
    await expect(assign.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect(
      assign.getByRole('button', {
        name: 'Remove the homework of Spanish Level 1 · Tuesday (group X)',
      }),
    ).toBeVisible();

    const { data: stored } = await admin
      .from('activities')
      .select('created_by, status')
      .eq('id', activityId)
      .single();
    expect(stored).toEqual({
      created_by: '00000000-0000-4000-8000-0000000000b1',
      status: 'published',
    });

    // The group page offers it too, marked as a staff exercise.
    await page.goto(`/teach/groups/${IDS.groupX}`);
    const groupHomework = page.getByRole('region', { name: 'Homework' });
    await expect(groupHomework.getByRole('link', { name: TITLE })).toBeVisible();
    await expect(
      groupHomework.getByRole('option', {
        name: `Introducing yourself · ${TITLE} (staff exercise)`,
      }),
    ).toHaveCount(1);
    await signOut(page);

    // ── student A (group X) finds it in their homework and answers it ────
    await signIn(page, USERS.studentA);
    await page.goto('/learn/practice');
    const homework = page.getByRole('region', { name: 'Homework' });
    await homework.getByRole('link', { name: new RegExp(TITLE) }).click();
    await expect(page).toHaveURL(new RegExp(`/learn/activities/${activityId}$`));
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page).toHaveURL(/\/learn\/attempts\//);
    await page.getByRole('radio', { name: 'Me llamo Ana.' }).check();
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Correct!', { exact: true })).toBeVisible();
    const { count: answers } = await admin
      .from('responses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', IDS.studentA)
      .eq('is_correct', true)
      .in(
        'item_id',
        (
          (await admin.from('activity_items').select('id').eq('activity_id', activityId)).data ?? []
        ).map((i) => i.id),
      );
    expect(answers).toBe(1);
    await signOut(page);

    // ── student C (another group) cannot reach it, even by its address ───
    await signIn(page, USERS.studentC);
    expect((await page.goto(`/learn/activities/${activityId}`))?.status()).toBe(404);
    await page.goto('/learn/practice');
    await expect(page.getByText(TITLE)).toHaveCount(0);
    await signOut(page);

    // ── and teacher Y cannot open it in their own exercise editor ────────
    await signIn(page, USERS.teacherY);
    expect((await page.goto(exerciseUrl))?.status()).toBe(404);
  } finally {
    await cleanUp();
  }
});

test('the office writes an exercise for any course and gives it to a group', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const TITLE = 'E2E: office check';
  const cleanUp = async () => {
    const { data } = await admin.from('activities').select('id').like('slug', 'e2e-office-check-%');
    const ids = (data ?? []).map((a) => a.id);
    if (!ids.length) return;
    await admin.from('attempts').delete().in('activity_id', ids);
    await admin.from('activities').delete().in('id', ids);
  };
  await cleanUp();

  try {
    await signIn(page, USERS.office);
    await passMfa(page, USERS.office);
    await page.goto('/office/exercises');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Exercises');
    await page.getByLabel('Title').fill(TITLE);
    await page
      .getByLabel('Course and cycle')
      .selectOption({ label: 'Français niveau 1 (fixture) · Introducing yourself' });
    await page.getByRole('button', { name: 'Create exercise' }).click();
    await expect(page).toHaveURL(/\/office\/exercises\/[0-9a-f-]{36}$/);
    const activityId = new URL(page.url()).pathname.split('/').pop()!;
    await page.getByRole('button', { name: 'Publish', exact: true }).click();

    // Any group of the course, including one the office does not teach.
    const assign = page.getByRole('region', { name: 'Groups and homework' });
    await assign.getByLabel('Group').selectOption({ label: 'French Level 1 · Thursday (group Y)' });
    await assign.getByRole('button', { name: 'Assign' }).click();
    await expect(assign.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    const { data: given } = await admin
      .from('assignments')
      .select('group_id, assigned_by')
      .eq('activity_id', activityId);
    expect(given).toEqual([
      { group_id: IDS.groupY, assigned_by: '00000000-0000-4000-8000-0000000000e1' },
    ]);
    await signOut(page);

    // Student C (group Y) has it as homework.
    await signIn(page, USERS.studentC);
    await page.goto('/learn/practice');
    await expect(
      page.getByRole('region', { name: 'Homework' }).getByRole('link', { name: new RegExp(TITLE) }),
    ).toBeVisible();
  } finally {
    await cleanUp();
  }
});
