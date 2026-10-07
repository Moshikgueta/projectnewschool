import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { adminClient, IDS, passMfa, signIn, USERS } from './helpers';

// The office's students, packages and private lessons (staff room merge,
// stage D: the Tazman replacement). Seed (reset by global-setup):
// Daniel (A): 10-lesson package, paid, 2 used (held + late cancellation),
// 1 booked in three days. Maya (B): 5-lesson package, not paid, expires in
// 10 days, 4 used → running low.

const TZ = 'Asia/Jerusalem';
/** A moment as the office's datetime-local field takes it, in its time zone. */
function localInput(at: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

const saved = (page: Page) => page.getByRole('status').filter({ hasText: 'Saved.' });

test('the office: today, students, packages, private lessons, and a new student with a code', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, USERS.office);
  await passMfa(page, USERS.office);
  await expect(page).toHaveURL(/^[^?]*\/office$/); // not /account/mfa?next=/office
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Today');

  const followUp = page.getByRole('region', { name: 'Packages to follow up' });
  await expect(followUp.getByRole('listitem')).toHaveCount(1);
  await expect(followUp).toContainText('Maya (student B)');
  await expect(followUp).toContainText('4 used · 0 booked · 1 left');
  for (const badge of ['Running low', 'Expires soon', 'Not paid']) {
    await expect(followUp).toContainText(badge);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Students: lessons left across live packages.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Students' })
    .click();
  const table = page.getByRole('table', { name: 'Students' });
  const daniel = table.getByRole('row', { name: /Daniel \(student A\)/ });
  await expect(daniel).toContainText('050-1234567');
  await expect(daniel.getByRole('cell').last()).toHaveText('8');
  const maya = table.getByRole('row', { name: /Maya \(student B\)/ });
  await expect(maya).toContainText('Needs attention');
  await expect(maya.getByRole('cell').last()).toHaveText('1');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('searchbox', { name: 'Search by name' }).fill('maya');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(table.getByRole('row')).toHaveCount(2);

  // Daniel's page.
  await page.goto(`/office/students/${IDS.studentA}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Daniel (student A)');
  const packages = page.getByRole('region', { name: 'Packages' });
  await expect(packages).toContainText('10 lessons of 60 minutes');
  await expect(packages).toContainText('2 used · 1 booked · 8 left');
  await expect(packages).toContainText('Paid');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Cancelling the lesson in three days is in time: nothing is charged.
  const lessons = page.getByRole('region', { name: 'Private lessons' });
  await lessons.getByRole('button', { name: /^Cancel the lesson on/ }).click();
  await expect(lessons).toContainText('Cancelled in time');
  await expect(packages).toContainText('2 used · 0 booked · 8 left');

  // Teacher Y is busy at the time of Maya's last lesson: refused.
  const { data: busy } = await adminClient()
    .from('private_lessons')
    .select('starts_at')
    .eq('id', 'd1000000-0000-4000-8000-000000000007')
    .single();
  const book = page.getByRole('region', { name: 'Private lessons' });
  async function bookLesson(teacher: string, at: Date, minutes = 60) {
    await book.getByRole('combobox', { name: 'Teacher' }).selectOption({ label: teacher });
    await book.getByLabel('Date and time').fill(localInput(at));
    await book.getByLabel('Length in minutes').fill(String(minutes));
    await book.getByRole('button', { name: 'Book', exact: true }).click();
  }
  await bookLesson('Teacher Y', new Date(new Date(busy!.starts_at).getTime() + 10 * 60_000));
  await expect(book.getByRole('alert')).toContainText(
    'The teacher already has a lesson at that time.',
  );

  // A lesson in two hours, then cancelled: late, so it counts.
  await bookLesson('Teacher X', new Date(Date.now() + 2 * 3_600_000));
  await expect(saved(page)).toBeVisible();
  await expect(packages).toContainText('2 used · 1 booked · 8 left');
  await lessons
    .getByRole('button', { name: /^Cancel the lesson on/ })
    .first()
    .click();
  await expect(lessons).toContainText('Cancelled late (charged)');
  await expect(packages).toContainText('3 used · 0 booked · 7 left');

  // A new package, then paid.
  const addPkg = packages.locator('form').last();
  await addPkg.getByLabel('Number of lessons').fill('5');
  await addPkg.getByLabel('Price in ₪ (optional)').fill('900');
  await addPkg.getByRole('button', { name: 'Add package' }).click();
  await expect(packages).toContainText('5 lessons of 60 minutes');
  await packages.getByRole('button', { name: /^Mark the package from .* as paid$/ }).click();
  await expect(packages.getByRole('button', { name: /^Mark the package/ })).toHaveCount(0);

  // Contact details.
  const contact = page.getByRole('region', { name: 'Contact details' });
  await contact.getByLabel('Phone').fill('054-0000000');
  await contact.getByRole('button', { name: 'Save' }).click();
  await expect(contact.getByRole('status')).toContainText('Saved.');
  const { data: record } = await adminClient()
    .from('student_records')
    .select('phone')
    .eq('student_id', IDS.studentA)
    .single();
  expect(record!.phone).toBe('054-0000000');

  // A new student with no email, an entry code, and their first sign-in.
  await page.goto('/office/students');
  const add = page.getByRole('region', { name: 'Add a student' });
  await add.getByLabel('Full name').fill('E2E Noa');
  await add.getByLabel('Phone (optional)').fill('053-1112222');
  await add.getByRole('button', { name: 'Add student' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E Noa');
  await page
    .getByRole('region', { name: 'Entry code' })
    .getByRole('button', { name: 'New code' })
    .click();
  const code = (await page
    .getByRole('region', { name: 'Entry code' })
    .getByRole('status')
    .textContent())!.match(/[A-Z2-9]{4}-[A-Z2-9]{4}/)![0];

  await page.context().clearCookies();
  await page.goto('/login/code');
  await page.getByLabel('Your code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.getByText('E2E Noa').first()).toBeVisible();
});

test('only the office (with MFA) opens student records', async ({ page }) => {
  // Without the second step, the office is sent to set it up / verify.
  await signIn(page, USERS.office);
  await page.goto(`/office/students/${IDS.studentA}`);
  await expect(page).toHaveURL(/\/account\/mfa/);
  await page.context().clearCookies();

  for (const who of [USERS.teacherX, USERS.studentA, USERS.studentB]) {
    await signIn(page, who);
    for (const path of [`/office/students/${IDS.studentA}`, '/office/students', '/office']) {
      expect((await page.goto(path))?.status(), `${who} ${path}`).toBe(404);
    }
    await page.context().clearCookies();
  }
});

test('a teacher sees today’s private lessons, read-only', async ({ page }) => {
  const admin = adminClient();
  const start = new Date(Date.now() + 5 * 60_000);
  const { data: lesson } = await admin
    .from('private_lessons')
    .insert({
      student_id: IDS.studentA,
      teacher_id: '00000000-0000-4000-8000-0000000000b1',
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
    })
    .select('id')
    .single();
  try {
    await signIn(page, USERS.teacherX);
    const today = page.getByRole('region', { name: 'Private lessons today' });
    await expect(today).toContainText('Daniel (student A)');
    await expect(today.getByRole('button')).toHaveCount(0);
  } finally {
    await admin.from('private_lessons').delete().eq('id', lesson!.id);
  }
});
