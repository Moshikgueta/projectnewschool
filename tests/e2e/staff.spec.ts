import { expect, test, type Page } from '@playwright/test';
import { IDS, USERS, signIn, totp } from './helpers';

async function enrollMfa(page: Page) {
  await expect(page).toHaveURL(/\/account\/mfa/);
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const secret = (await page.locator('code').innerText()).trim();
  await page.getByLabel('6-digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
}

test.describe('teachers', () => {
  test('teacher X sees their groups and students', async ({ page }) => {
    await signIn(page, USERS.teacherX);
    await expect(page).toHaveURL(/\/teach$/);
    await page.getByRole('link', { name: /group X/ }).click();
    await expect(page.getByRole('heading', { name: /group X/ })).toBeVisible();
    await expect(page.getByText('Daniel (student A)')).toBeVisible();
    await expect(page.getByText('Maya (student B)')).toBeVisible();
  });

  test('teacher Y cannot open group X (404, same as a missing group)', async ({ page }) => {
    await signIn(page, USERS.teacherY);
    const res = await page.goto(`/teach/groups/${IDS.groupX}`);
    expect(res?.status()).toBe(404);
    const own = await page.goto(`/teach/groups/${IDS.groupY}`);
    expect(own?.status()).toBe(200);
  });

  test('teachers cannot open admin or management areas', async ({ page }) => {
    await signIn(page, USERS.teacherX);
    for (const path of ['/admin', '/manage', '/learn']) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });
});

test.describe('MFA-protected roles', () => {
  test('a pedagogical manager must complete two-step verification first', async ({ page }) => {
    await signIn(page, USERS.manager);
    await expect(page).toHaveURL(/\/account\/mfa\?next=\/manage/);
    await enrollMfa(page);
    await expect(page).toHaveURL(/\/manage$/);
    await expect(page.getByRole('heading', { name: 'Pedagogical management' })).toBeVisible();
  });

  test('an admin verifies with MFA, invites a student, and the student accepts by email', async ({
    page,
    request,
  }) => {
    await signIn(page, USERS.admin);
    await enrollMfa(page);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: /All accounts/ })).toBeVisible();

    const email = `invited-${Date.now()}@example.com`;
    await page.getByLabel('Name').fill('Invited Student');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Role').selectOption('student');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByRole('status')).toContainText(`Invitation sent to ${email}`);
    await page.getByRole('button', { name: 'Sign out' }).click();

    // Read the invite from the local mail catcher (Mailpit).
    let link: string | undefined;
    await expect(async () => {
      const list = await (
        await request.get(`http://127.0.0.1:54324/api/v1/search?query=to:${email}`)
      ).json();
      const id = list.messages?.[0]?.ID;
      expect(id).toBeTruthy();
      const msg = await (await request.get(`http://127.0.0.1:54324/api/v1/message/${id}`)).json();
      link = /href="([^"]+auth\/confirm[^"]+)"/.exec(msg.HTML)?.[1]?.replace(/&amp;/g, '&');
      expect(link).toBeTruthy();
    }).toPass({ timeout: 15_000 });

    await page.goto(link!);
    await expect(page).toHaveURL(/\/account\/set-password/);
    // A new account starts in Hebrew, the school's default interface language.
    await page.getByLabel('סיסמה חדשה').fill('a-fresh-long-password-42');
    await page.getByLabel('הקלדת הסיסמה שוב').fill('a-fresh-long-password-42');
    await page.getByRole('button', { name: 'שמירת הסיסמה' }).click();
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('עדיין אין קורסים')).toBeVisible();
  });
});

test.describe('anonymous visitors', () => {
  test('are sent to sign in from every protected area', async ({ page }) => {
    for (const area of ['learn', 'teach', 'manage', 'admin']) {
      await page.goto(`/${area}`);
      await expect(page, area).toHaveURL(new RegExp(`/login\\?next=/${area}`));
    }
  });

  test('responses carry the security headers and a nonce-based CSP', async ({ page }) => {
    const res = await page.goto('/login');
    const headers = res!.headers();
    expect(headers['content-security-policy']).toMatch(
      /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
    );
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('pages load without CSP violations', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy/i.test(m.text()))
        violations.push(m.text());
    });
    await page.goto('/login');
    await page.getByLabel('Email').fill('x@example.com'); // hydrated and interactive
    expect(violations).toEqual([]);
  });

  test('a forged or expired email link is rejected', async ({ page }) => {
    await page.goto('/auth/confirm?token_hash=forged&type=recovery&next=/account/set-password');
    await expect(page).toHaveURL(/\/login\?error=link/);
  });

  test('the post-login redirect cannot point to another site', async ({ page }) => {
    await page.goto('/login?next=//evil.example');
    await page.getByLabel('Email').fill(USERS.studentA);
    await page.getByLabel('Password').fill('Local-dev-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/localhost:3000\/learn$/);
  });
});
