import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { USERS, passMfa, signIn } from './helpers';

// The school office, merged from the staff room: rooms and the weekly
// timetable. One test for the office, so two-step sign-in happens once.
test('the office runs rooms and the weekly timetable; the database refuses double bookings', async ({
  page,
}) => {
  await signIn(page, USERS.office);
  await passMfa(page, USERS.office);
  await expect(page).toHaveURL(/\/office$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Weekly timetable');

  // Seed: Room 1 on Tuesday 18:00–19:30 (group X), Room 2 on Thursday, Room 1 on Sunday.
  const grid = page.getByRole('table', { name: 'Weekly timetable' });
  const room1 = grid.getByRole('row', { name: /Room 1/ });
  await expect(room1).toContainText('Spanish Level 1 (group X)');
  await expect(room1).toContainText('18:00–19:30');
  await expect(room1).toContainText('English Foundations');
  await expect(grid.getByRole('row', { name: /Room 2/ })).toContainText('French Level 1 (group Y)');

  const form = page.getByRole('region', { name: 'Book a room' });
  async function book(room: string, title: string, day: string, from: string, to: string) {
    await form.getByRole('combobox', { name: 'Room' }).selectOption({ label: room });
    await form.getByLabel('Lesson').fill(title);
    await form.getByRole('combobox', { name: 'Day' }).selectOption({ label: day });
    await form.getByLabel('From').fill(from);
    await form.getByLabel('To').fill(to);
    await form.getByRole('button', { name: 'Book' }).click();
  }

  // Overlapping Room 1 on Tuesday: refused, and the message says what is in the way.
  await book('Room 1', 'Overlap', 'Tuesday', '18:30', '19:00');
  await expect(form.getByRole('alert')).toContainText(
    'Room 1 is taken on Tuesday, 18:00–19:30: Spanish Level 1 (group X).',
  );
  // Out of school hours: refused before reaching the database.
  await book('Room 1', 'Too early', 'Monday', '06:00', '07:00');
  await expect(form.getByRole('alert')).toContainText('Lessons are between 07:00 and 23:00.');

  // A free slot, with a teacher.
  await form
    .getByRole('combobox', { name: 'Teacher (optional)' })
    .selectOption({ label: 'Teacher X' });
  await book('Room 2', 'Conversation club', 'Monday', '10:00', '11:00');
  await expect(form.getByText('Saved.')).toBeVisible();
  const room2 = grid.getByRole('row', { name: /Room 2/ });
  await expect(room2).toContainText('Conversation club');
  await expect(room2).toContainText('Teacher X');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole('button', { name: /^Remove Conversation club, Monday 10:00$/ }).click();
  await expect(room2).not.toContainText('Conversation club');

  // Rooms: add one, refuse to remove a room that still has lessons, remove the new one.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Rooms' }).click();
  const add = page.getByRole('region', { name: 'Add a room' });
  await add.getByLabel('Name').fill('Room 5');
  await add.getByLabel('Capacity (0 = not stated)').fill('6');
  await add.getByRole('button', { name: 'Add a room' }).click();
  await expect(page.getByRole('heading', { name: 'Room 5' })).toBeVisible();

  const room1Card = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Room 1' }) });
  await room1Card.getByText('Edit').click();
  await room1Card.getByRole('button', { name: 'Remove room Room 1' }).click();
  await expect(room1Card.getByRole('alert')).toContainText('This room still has lessons.');

  const room5Card = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Room 5' }) });
  await room5Card.getByText('Edit').click();
  await room5Card.getByRole('button', { name: 'Remove room Room 5' }).click();
  await expect(page.getByRole('heading', { name: 'Room 5' })).toHaveCount(0);
});

test('teachers see the timetable read-only; students and teachers cannot open the office', async ({
  page,
}) => {
  await signIn(page, USERS.teacherX);
  expect((await page.goto('/office'))?.status()).toBe(404);
  await page.goto('/teach');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Timetable' })
    .click();
  await expect(page).toHaveURL('/teach/timetable');
  const grid = page.getByRole('table', { name: 'Weekly timetable' });
  await expect(grid).toContainText('Spanish Level 1 (group X)');
  await expect(grid).toContainText('French Level 1 (group Y)');
  await expect(grid.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Book a room' })).toHaveCount(0);
  await page.context().clearCookies();

  await signIn(page, USERS.studentA);
  for (const path of ['/office', '/office/rooms', '/teach/timetable']) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
});
