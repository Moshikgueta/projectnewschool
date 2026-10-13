import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { adminClient, IDS, passMfa, signIn, signOut, USERS } from './helpers';

// A teacher's page for one student, and homework for selected students
// (ADR-039). The owner's rule, tested here end to end: a student never
// reaches homework, or an exercise, given only to another student, even
// with its address; a teacher sees only students of groups they teach.

const SPANISH = '30000000-0000-4000-8000-000000000001';
const CYCLE = '40000000-0000-4000-8000-000000000001'; // "Introducing yourself"
const TEACHER_X = '00000000-0000-4000-8000-0000000000b1';
const OFFICE = '00000000-0000-4000-8000-0000000000e1';
const STUDENT_C = '00000000-0000-4000-8000-0000000000a3';
const STUDENT_D = '00000000-0000-4000-8000-0000000000a4';
const TITLE = 'E2E: only for Maya';
const OPTION = `Introducing yourself · ${TITLE} (staff exercise)`;

const admin = adminClient();
let exerciseId = '';

async function cleanUp() {
  const { data } = await admin.from('activities').select('id').like('slug', 'e2e-selected-%');
  const ids = (data ?? []).map((a) => a.id);
  if (!ids.length) return;
  await admin.from('attempts').delete().in('activity_id', ids);
  // Their assignments and recipients go with them.
  await admin.from('activities').delete().in('id', ids);
}

test.beforeAll(async () => {
  await cleanUp();
  // A published exercise teacher X wrote, given to nobody yet: students
  // reach it only through homework (ADR-038).
  const { data, error } = await admin
    .from('activities')
    .insert({
      course_id: SPANISH,
      cycle_id: CYCLE,
      slug: 'e2e-selected-only-maya',
      title: TITLE,
      created_by: TEACHER_X,
      status: 'published',
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  exerciseId = data.id;
  const item = await admin
    .from('activity_items')
    .insert({
      activity_id: exerciseId,
      course_id: SPANISH,
      position: 1,
      slug: 'q1',
      type: 'trueFalse',
      prompt: [{ id: 'prompt', type: 'text', text: '«Hola» es un saludo.' }],
      data: {},
    })
    .select('id')
    .single();
  if (item.error) throw new Error(item.error.message);
  await admin
    .from('activity_item_keys')
    .insert({ item_id: item.data.id, course_id: SPANISH, answer: { value: true } });
});

test.afterAll(cleanUp);

test('a teacher gives an exercise to one student from their page; only that student gets it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, USERS.teacherX);
  await page.goto(`/teach/groups/${IDS.groupX}`);
  await page
    .getByRole('region', { name: 'Students' })
    .getByRole('link', { name: 'Maya (student B)' })
    .click();
  await expect(page).toHaveURL(`/teach/groups/${IDS.groupX}/students/${IDS.studentB}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Maya (student B)');
  await expect(page.getByText(/^Español básico \(fixture\) · In the group since/)).toBeVisible();
  for (const name of ['Homework', 'Recent attempts', 'Progress', 'Attendance', 'Notebook']) {
    await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const homework = page.getByRole('region', { name: 'Homework', exact: true });
  await expect(
    homework.getByRole('heading', { name: /^Give an activity to .?Maya \(student B\).? only$/ }),
  ).toBeVisible();
  await homework.getByLabel('Activity').selectOption({ label: OPTION });
  await homework.getByRole('button', { name: 'Assign' }).click();
  await expect(homework.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  const row = homework.getByRole('listitem').filter({ hasText: TITLE });
  await expect(row).toContainText('By name');
  await expect(row).toContainText('Open');

  const { data: given } = await admin
    .from('assignments')
    .select('audience, assigned_by, assignment_recipients ( student_id )')
    .eq('activity_id', exerciseId);
  expect(given).toEqual([
    {
      audience: 'selected',
      assigned_by: TEACHER_X,
      assignment_recipients: [{ student_id: IDS.studentB }],
    },
  ]);

  // The group page names who it is for.
  await page.goto(`/teach/groups/${IDS.groupX}`);
  await expect(
    page
      .getByRole('region', { name: 'Homework', exact: true })
      .getByRole('listitem')
      .filter({ hasText: TITLE }),
  ).toContainText('For Maya (student B)');
  await signOut(page);

  // Student B has it as homework and can open it.
  await signIn(page, USERS.studentB);
  await page.goto('/learn/practice');
  await page
    .getByRole('region', { name: 'Homework' })
    .getByRole('link', { name: new RegExp(TITLE) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/learn/activities/${exerciseId}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE);
  await signOut(page);

  // Student A, in the same group, does not — not even with its address.
  await signIn(page, USERS.studentA);
  await page.goto('/learn/practice');
  await expect(page.getByText(TITLE)).toHaveCount(0);
  expect((await page.goto(`/learn/activities/${exerciseId}`))?.status()).toBe(404);
  // Nor B's page in the teacher area.
  expect((await page.goto(`/teach/groups/${IDS.groupX}/students/${IDS.studentB}`))?.status()).toBe(
    404,
  );
  expect((await page.goto(`/teach/groups/${IDS.groupX}/students/${IDS.studentA}`))?.status()).toBe(
    404,
  );
});

test('from the group page: homework for selected students, chosen from the group', async ({
  page,
}) => {
  await signIn(page, USERS.teacherX);
  await page.goto(`/teach/groups/${IDS.groupX}`);
  const homework = page.getByRole('region', { name: 'Homework', exact: true });
  await homework.getByLabel('Activity').selectOption({ label: OPTION });

  // The whole group is the default; the list of students opens on request.
  await expect(homework.getByRole('radio', { name: 'All students' })).toBeChecked();
  await expect(homework.getByRole('checkbox', { name: 'Daniel (student A)' })).toBeHidden();
  await homework.getByRole('radio', { name: 'Selected students' }).check();
  await homework.getByRole('button', { name: 'Assign' }).click();
  await expect(homework.getByText('Choose at least one student.')).toBeVisible();
  // The form starts again after an answer: back to all students.
  await expect(homework.getByRole('radio', { name: 'All students' })).toBeChecked();
  await page.reload();
  await homework.getByLabel('Activity').selectOption({ label: OPTION });
  await homework.getByRole('radio', { name: 'Selected students' }).check();

  // Only the group's own students are offered (C is in group Y).
  const boxes = homework.getByRole('checkbox');
  await expect(boxes).toHaveCount(3);
  await expect(homework.getByRole('checkbox', { name: 'Noam (student C)' })).toHaveCount(0);
  await homework.getByRole('checkbox', { name: 'Daniel (student A)' }).check();
  await homework.getByRole('checkbox', { name: 'Lior (student D)' }).check();
  await homework.getByRole('button', { name: 'Assign' }).click();
  await expect(homework.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(
    homework.getByText('For Daniel (student A), Lior (student D)', { exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const { data: given } = await admin
    .from('assignments')
    .select('id, assignment_recipients ( student_id )')
    .eq('activity_id', exerciseId)
    .eq('audience', 'selected');
  const chosen = (given ?? [])
    .map((a) => a.assignment_recipients.map((r) => r.student_id).sort())
    .sort();
  expect(chosen).toContainEqual([IDS.studentA, STUDENT_D].sort());
});

test('a forged request cannot give homework to a student outside the group', async ({ page }) => {
  // The database refuses it whatever the app sends (trigger, ADR-039); the
  // app refuses first with a clear message.
  await signIn(page, USERS.teacherX);
  await page.goto(`/teach/groups/${IDS.groupX}/students/${IDS.studentB}`);
  const homework = page.getByRole('region', { name: 'Homework', exact: true });
  await homework.getByLabel('Activity').selectOption({ label: OPTION });
  // Swap the student in the hidden field for student C (group Y).
  await homework
    .locator('input[type="hidden"][name="studentId"]')
    .evaluate((el, id) => ((el as HTMLInputElement).value = id), STUDENT_C);
  await homework.getByRole('button', { name: 'Assign' }).click();
  await expect(homework.getByText('Choose students of this group.')).toBeVisible();
  const { data } = await admin
    .from('assignment_recipients')
    .select('assignment_id')
    .eq('student_id', STUDENT_C);
  const { data: ours } = await admin.from('assignments').select('id').eq('activity_id', exerciseId);
  const ourIds = new Set((ours ?? []).map((a) => a.id));
  expect((data ?? []).filter((r) => ourIds.has(r.assignment_id))).toEqual([]);
});

test('teachers see only students of groups they teach: everything else is 404', async ({
  page,
}) => {
  await signIn(page, USERS.teacherY);
  for (const path of [
    // Teacher X's group, and its student.
    `/teach/groups/${IDS.groupX}/students/${IDS.studentB}`,
    `/teach/groups/${IDS.groupX}/students/${IDS.studentA}`,
    // Teacher Y's own group, but a student who is not in it.
    `/teach/groups/${IDS.groupY}/students/${IDS.studentA}`,
    `/teach/groups/${IDS.groupY}/students/not-a-uuid`,
  ]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
  // Their own student is fine.
  expect((await page.goto(`/teach/groups/${IDS.groupY}/students/${STUDENT_C}`))?.status()).toBe(
    200,
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Noam (student C)');
  await signOut(page);

  await signIn(page, USERS.teacherX);
  for (const path of [
    `/teach/groups/${IDS.groupX}/students/${STUDENT_C}`,
    `/teach/groups/${IDS.groupY}/students/${IDS.studentB}`,
  ]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
  await page.goto('/teach');
  await signOut(page);

  // A student gets 404 for teacher pages, their own included.
  await signIn(page, USERS.studentB);
  for (const path of [
    `/teach/groups/${IDS.groupX}`,
    `/teach/groups/${IDS.groupX}/students/${IDS.studentB}`,
    `/teach/groups/${IDS.groupX}/students/${IDS.studentA}`,
  ]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
});

test('the office gives an exercise to selected students of any group', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, USERS.office);
  await passMfa(page, USERS.office);
  // Teacher X's exercise: the office edits only office exercises, so its
  // page is not found there; the office assigns from its own exercise.
  expect((await page.goto(`/office/exercises/${exerciseId}`))?.status()).toBe(404);

  await page.goto('/office/exercises');
  await page.getByLabel('Title').fill('E2E: selected office');
  await page
    .getByLabel('Course and cycle')
    .selectOption({ label: 'Español básico (fixture) · Introducing yourself' });
  await page.getByRole('button', { name: 'Create exercise' }).click();
  await expect(page).toHaveURL(/\/office\/exercises\/[0-9a-f-]{36}$/);
  const officeExercise = new URL(page.url()).pathname.split('/').pop()!;
  try {
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const assign = page.getByRole('region', { name: 'Groups and homework' });
    await assign.getByLabel('Group').selectOption({ label: 'Spanish Level 1 · Tuesday (group X)' });
    await assign.getByRole('radio', { name: 'Selected students' }).check();
    await assign.getByRole('checkbox', { name: 'Lior (student D)' }).check();
    await assign.getByRole('button', { name: 'Assign' }).click();
    await expect(assign.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect(assign.getByText('For Lior (student D)')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    const { data: given } = await admin
      .from('assignments')
      .select('audience, assigned_by, assignment_recipients ( student_id )')
      .eq('activity_id', officeExercise);
    expect(given).toEqual([
      {
        audience: 'selected',
        assigned_by: OFFICE,
        assignment_recipients: [{ student_id: STUDENT_D }],
      },
    ]);
    await signOut(page);

    // Student A (group X, not chosen) gets nothing; D has it.
    await signIn(page, USERS.studentA);
    expect((await page.goto(`/learn/activities/${officeExercise}`))?.status()).toBe(404);
    await page.goto('/learn');
    await signOut(page);
    await signIn(page, USERS.studentD);
    await page.goto('/learn/practice');
    await expect(
      page
        .getByRole('region', { name: 'Homework' })
        .getByRole('link', { name: /E2E: selected office/ }),
    ).toBeVisible();
  } finally {
    await admin.from('activities').delete().eq('id', officeExercise);
  }
});
