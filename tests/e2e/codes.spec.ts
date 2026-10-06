import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { adminClient, IDS, signIn, signOut, USERS } from './helpers';

// Student entry codes (merged from the staff room): a teacher hands out a
// code, the student signs in with it. A code only ever opens that student's
// own account, a teacher can only issue codes for their own students, and
// wrong codes are throttled.

const STUDENT_D = '00000000-0000-4000-8000-0000000000a4';
const TEACHER_X = '00000000-0000-4000-8000-0000000000b1';
const CODE = /[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}/;

async function issueCodeFor(page: Page, name: string): Promise<string> {
  await page.goto(`/teach/groups/${IDS.groupX}`);
  await page.getByRole('button', { name: `New code for ${name}` }).click();
  const shown = page.getByRole('status').filter({ hasText: `Code for ${name}:` });
  await expect(shown).toContainText(CODE);
  return (await shown.textContent())!.match(CODE)![0];
}

async function signInWithCode(page: Page, code: string) {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Sign in with your code' }).click();
  await expect(page).toHaveURL(/\/login\/code$/);
  await page.getByLabel('Your code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The form's own message (not Next's route announcer, which is also an alert). */
const formAlert = (page: Page) => page.locator('form').getByRole('alert');

const WRONG = 'That code doesn’t work. Check it, or ask your teacher for a new one.';

test.describe('student entry codes', () => {
  test.beforeEach(async () => {
    const admin = adminClient();
    await admin.from('code_attempts').delete().neq('scope', '');
    await admin.from('student_codes').delete().neq('code_hash', '');
  });
  test.afterAll(async () => {
    const admin = adminClient();
    await admin.from('code_attempts').delete().neq('scope', '');
    await admin.from('student_codes').delete().neq('code_hash', '');
  });

  test('a teacher issues a code and the student signs in with it, typed any way', async ({
    page,
  }) => {
    await signIn(page, USERS.teacherX);
    const code = await issueCodeFor(page, 'Lior (student D)');
    // Only the hash is stored, never the code.
    const { data: rows } = await adminClient()
      .from('student_codes')
      .select('code_hash, issued_by')
      .eq('user_id', STUDENT_D);
    expect(rows).toHaveLength(1);
    expect(rows![0]!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(code.replace('-', ''));
    await signOut(page);

    // Lower case, without the dash, with spaces around it.
    await signInWithCode(page, ` ${code.replace('-', '').toLowerCase()} `);
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByText('Lior (student D)').first()).toBeVisible();
    // A normal student session: the teacher area is not there for them.
    await page.goto('/teach');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  test('a new code replaces the old one', async ({ page }) => {
    await signIn(page, USERS.teacherX);
    const first = await issueCodeFor(page, 'Lior (student D)');
    const second = await issueCodeFor(page, 'Lior (student D)');
    expect(second).not.toBe(first);
    await signOut(page);

    await signInWithCode(page, first);
    await expect(formAlert(page)).toContainText(WRONG);
    await page.getByLabel('Your code').fill(second);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/learn$/);
  });

  test('a code never opens a staff account', async ({ page }) => {
    // Plant a valid code on teacher X's account, as if they had once been a
    // student: it is refused with the same message as any wrong code.
    const pepper = process.env.STUDENT_CODE_PEPPER ?? '';
    expect(pepper.length).toBeGreaterThanOrEqual(32);
    const admin = adminClient();
    await admin.from('student_codes').upsert({
      user_id: TEACHER_X,
      code_hash: createHash('sha256').update(`${pepper}$TEACH234`).digest('hex'),
    });

    await signInWithCode(page, 'TEAC-H234');
    await expect(formAlert(page)).toContainText(WRONG);
    await expect(page).toHaveURL(/\/login\/code$/);
    await admin.from('student_codes').delete().eq('user_id', TEACHER_X);
  });

  test('a teacher cannot issue a code for a student they do not teach (forged form)', async ({
    page,
  }) => {
    // Teacher Y teaches group Y (Maya), not group X (Lior).
    await signIn(page, USERS.teacherY);
    await page.goto(`/teach/groups/${IDS.groupY}`);
    const button = page.getByRole('button', { name: 'New code for Maya (student B)' });
    const form = page.locator('form').filter({ has: button });

    // Same form, someone else's student: Lior is not in group Y.
    await form.locator('input[name="studentId"]').evaluate((el, id) => {
      (el as HTMLInputElement).value = id;
    }, STUDENT_D);
    await button.click();
    await expect(form.getByRole('alert')).toContainText('You can only change your own groups.');

    // And claiming Lior's own group, which teacher Y doesn't teach.
    await form.locator('input[name="groupId"]').evaluate((el, id) => {
      (el as HTMLInputElement).value = id;
    }, IDS.groupX);
    await button.click();
    await expect(form.getByRole('alert')).toContainText('You can only change your own groups.');

    const { count } = await adminClient()
      .from('student_codes')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', STUDENT_D);
    expect(count).toBe(0);
  });

  test('a student cannot issue codes at all', async ({ page }) => {
    await signIn(page, USERS.studentA);
    await page.goto(`/teach/groups/${IDS.groupX}`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  test('ten wrong codes in 15 minutes and even the right one has to wait', async ({ page }) => {
    await signIn(page, USERS.teacherX);
    const code = await issueCodeFor(page, 'Lior (student D)');
    await signOut(page);

    await signInWithCode(page, 'AAAA-AAAA');
    await expect(formAlert(page)).toContainText(WRONG);
    for (let i = 1; i < 10; i++) {
      await page.getByLabel('Your code').fill(`AAAA-AAA${'BCDEFGHJK'[i - 1]}`);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(formAlert(page)).toContainText(WRONG);
    }
    await page.getByLabel('Your code').fill(code);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(formAlert(page)).toContainText(
      'Too many wrong codes. Wait 15 minutes and try again.',
    );
    await expect(page).toHaveURL(/\/login\/code$/);
  });
});
