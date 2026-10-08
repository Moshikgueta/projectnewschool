import { expect, test } from '@playwright/test';
import { USERS, signIn } from './helpers';

// Runs in the "mobile" project (Pixel 7 viewport, touch).
test('student flow works on a phone without horizontal scrolling', async ({ page }) => {
  await signIn(page, USERS.studentA);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Daniel');

  // Phones get the bottom tab bar, not the desktop rail.
  const bar = page.getByRole('navigation', { name: 'Main' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('link')).toHaveCount(5);
  await expect(bar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
