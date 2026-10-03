import { expect, test } from '@playwright/test';
import { USERS, signIn } from './helpers';

// Runs in the "mobile" project (Pixel 7 viewport, touch).
test('student flow works on a phone without horizontal scrolling', async ({ page }) => {
  await signIn(page, USERS.studentA);
  await expect(page.getByRole('heading', { name: 'My courses' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
