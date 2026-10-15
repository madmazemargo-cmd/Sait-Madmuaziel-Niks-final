import { test, expect } from '@playwright/test';

test('deleting a dated meeting preserves the series and persists after reloading', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  const event = {
    id: 'daily-series', title: 'Повторяющаяся игра', event_date: '2020-01-01', start_time: '19:00',
    game_type: 'campaign', status: 'available', seats: 4, archived: false, revision: 1,
    recurrence: 'daily', recurrence_until: null, excludedDates: [] as string[],
    tags: [], miniCapacity: null, catalog_item_id: null,
  };
  const removed: string[] = [];
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'master', login: 'Test', role: 'master' }, csrfToken: 'test-csrf' } }));
  await page.route('**/api/master/events', route => route.fulfill({ json: { events: [event] } }));
  await page.route('**/api/master/events/daily-series/occurrences/*', route => {
    expect(route.request().method()).toBe('DELETE');
    expect(route.request().headers()['x-csrf-token']).toBe('test-csrf');
    const date = new URL(route.request().url()).pathname.split('/').pop()!;
    removed.push(date); event.excludedDates.push(date);
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/master/calendar');
  await expect(page.getByRole('button', { name: `Удалить встречу ${today}`, exact: true })).toBeVisible();
  const before = await page.locator('.master-calendar-event').count();
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('Серия и остальные даты сохранятся');
    await dialog.accept();
  });
  await page.getByRole('button', { name: `Удалить встречу ${today}`, exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Серия и остальные даты сохранены');
  await expect(page.getByRole('button', { name: `Удалить встречу ${today}`, exact: true })).toHaveCount(0);
  await expect(page.locator('.master-calendar-event')).toHaveCount(before - 1);
  await expect(page.locator('.master-event-card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Удалить всю серию Повторяющаяся игра' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Удалить встречу ${today}`, exact: true })).toHaveCount(0);
  // The separate series action must explicitly confirm its wider scope.
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('всю серию');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Удалить всю серию Повторяющаяся игра' }).click();
  await expect(page.locator('.master-event-card')).toHaveCount(1);
  expect(removed).toEqual([today]);
});

test('a failed cancellation keeps the meeting visible and shows an error', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'master', login: 'Test', role: 'master' }, csrfToken: 'test-csrf' } }));
  await page.route('**/api/master/events', route => route.fulfill({ json: { events: [{
    id: 'series', title: 'Серия', event_date: today, recurrence: 'daily', archived: false, tags: [],
  }] } }));
  await page.route('**/api/master/events/series/occurrences/*', route => route.fulfill({ status: 500, json: { error: 'Не удалось отменить встречу' } }));
  await page.goto('/master/calendar');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: `Удалить встречу ${today}`, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось отменить встречу');
  await expect(page.getByRole('button', { name: `Удалить встречу ${today}`, exact: true })).toBeEnabled();
});
