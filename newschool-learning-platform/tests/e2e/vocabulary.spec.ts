import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { USERS, signIn } from './helpers';

test('flashcards: due words first, self-rating schedules the next review', async ({ page }) => {
  await signIn(page, USERS.studentA);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Vocabulary' })
    .click();
  await expect(page).toHaveURL(/\/learn\/vocabulary$/);
  await expect(page.getByText('2 words · 0 well known')).toBeVisible();

  // "hola" is due (seen before); "adiós" is new and comes after it.
  await expect(page.getByRole('heading', { name: 'Card 1 of 2' })).toBeVisible();
  await expect(page.getByText('hola', { exact: true })).toHaveAttribute('lang', 'es');
  await expect(page.getByText('שלום')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show the meaning' }).click();
  await expect(page.getByText('שלום')).toHaveAttribute('lang', 'he');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole('button', { name: 'I knew it' }).click();

  await expect(page.getByRole('heading', { name: 'Card 2 of 2' })).toBeVisible();
  await expect(page.getByText('adiós', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show the meaning' }).click();
  await page.getByRole('button', { name: 'Not yet' }).click();
  await expect(page.getByText('All done for now!')).toBeVisible();
  await expect(page.getByText('You knew 1 of 2.')).toBeVisible();

  // Nothing is due straight away: "adiós" comes back in 10 minutes, "hola" in days.
  await page.reload();
  await expect(page.getByText('Nothing to review right now.')).toBeVisible();
  await expect(page.getByText(/^Next review: /)).toBeVisible();

  // Reviewing counts as practice on the dashboard.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('region', { name: 'Recent activity' })).toContainText(
    'Reviewed vocabulary',
  );
});
