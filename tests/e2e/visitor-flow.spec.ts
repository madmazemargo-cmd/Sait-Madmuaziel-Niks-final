import { test, expect } from '@playwright/test';

const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const event = {
  id: 'visitor-offline', title: 'Тестовая встреча в Москве', eventDate: date, startTime: '19:00',
  gameType: 'oneshot', status: 'available', seats: 2, description: 'Расследуйте исчезновение каравана.',
  system: 'D&D 5e', format: 'offline', location: 'Антикафе', duration: '4 часа', price: '1700 ₽',
  experience: 'Подходит новичкам', age: '16+', playerPrep: '', archived: false, applicationUrl: '',
  recurrence: 'none', recurrenceUntil: null, excludedDates: [], catalogItemId: 'catalog-test',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/calendar', route => route.fulfill({ json: { events: [event,
    { ...event, id: 'visitor-online', title: 'Тестовая онлайн-игра', format: 'online', location: 'Foundry VTT' },
    { ...event, id: 'closed', title: 'Закрытая встреча', status: 'closed', seats: 0 },
    { ...event, id: 'waiting', title: 'Ожидание', status: 'waiting' },
    { ...event, id: 'day-off', title: 'Служебный выходной', status: 'day_off' },
  ] } }));
  await page.route('**/api/catalog', route => route.fulfill({ json: { items: [{
    id: 'catalog-test', title: event.title, systemKey: 'dnd', price: '9999 ₽', age: '18+',
    format: 'online', gameType: 'oneshot', status: 'Подходит новичкам', description: 'История из каталога',
  }] } }));
  await page.route('**/api/reviews', route => route.fulfill({ json: { reviews: [] } }));
});

test('hero filters games and a selected meeting submits its date without asking again', async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/applications*', route => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { game: {
      id: event.id, title: event.title, date, dateLabel: date, time: event.startTime,
      status: 'available', price: event.price, place: event.location, location: event.location,
      preparation: '', revision: '1',
    } } });
  });
  await page.goto('/');
  await page.getByTestId('button-hero-calendar').click();
  await expect(page.getByRole('tab', { name: 'Игры со свободными местами' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(`open-game-${event.id}:${date}`)).toBeVisible();
  await expect(page.getByText('Тестовая онлайн-игра', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Подробнее', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('1700 ₽ / человек / встреча');
  await expect(dialog).not.toContainText('9999');
  await expect(dialog).toContainText('Очно в Москве');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Записаться', exact: true }).last().click();
  await expect(page.getByTestId('selected-game')).toContainText(event.title);
  await expect(page.getByLabel('Формат участия')).toHaveValue('Очно в Москве');
  await expect(page.getByLabel(/Когда удобно играть/)).toHaveCount(0);
  await page.getByTestId('input-name').fill('Игрок');
  await page.getByTestId('input-telegram').fill('@player');
  await page.getByTestId('button-next-step').click();
  await page.getByLabel(/Даю согласие на обработку/).check();
  await page.getByTestId('button-submit-application').click();
  await expect(page.getByTestId('application-success')).toContainText('Telegram');
  expect(submitted).toMatchObject({ eventId: event.id, occurrenceDate: date });
  expect(submitted?.schedule).toContain(date);
});

test('list excludes service days and closed games; month remains available', async ({ page }) => {
  await page.goto('/calendar?format=online');
  await expect(page.getByRole('heading', { name: 'Тестовая онлайн-игра' })).toBeVisible();
  await expect(page.getByText(event.title, { exact: true })).toHaveCount(0);
  await expect(page.getByText('Закрытая встреча', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Добавить игру' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Месяц', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByText('Служебный выходной', { exact: true })).toHaveCount(0);
});

test('recurring games have one signup card per series, while month retains every meeting', async ({ page }) => {
  const shiftedDate = (days: number) => {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  const nextDate = shiftedDate(7);
  await page.route('**/api/calendar', route => route.fulfill({ json: { events: [
    { ...event, recurrence: 'weekly', eventDate: shiftedDate(-28), excludedDates: [date] },
    // Separate tables with the same title must not be merged into one series.
    { ...event, id: 'independent-table' },
    { ...event, id: 'another-game', title: 'Другая история' },
  ] } }));
  for (const path of ['/', '/calendar']) {
    await page.goto(path);
    const series = page.locator('[data-testid^="open-game-visitor-offline:"]');
    await expect(series).toHaveCount(1);
    await expect(series.getByRole('link', { name: 'Записаться', exact: true }))
      .toHaveAttribute('href', `/anketa?event=${event.id}&date=${nextDate}`);
    await expect(page.locator('.open-game-card')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: event.title, exact: true })).toHaveCount(2);
  }
  await page.getByRole('tab', { name: 'Месяц', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  expect(await page.locator('.calendar-month-event').filter({ hasText: event.title }).count()).toBeGreaterThan(2);
});

test('desktop grid aligns prices; mobile stays within viewport', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: event.title })).toBeVisible();
    const systems = await page.locator('.catalog-kinds').boundingBox();
    const prices = await page.locator('.pricing-panel').boundingBox();
    expect(systems).not.toBeNull(); expect(prices).not.toBeNull();
    if (width > 900) {
      expect(Math.abs(systems!.y - prices!.y)).toBeLessThan(2);
      expect(Math.abs(systems!.y + systems!.height - prices!.y - prices!.height)).toBeLessThan(2);
    } else {
      expect(prices!.y).toBeGreaterThan(systems!.y + systems!.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/visitor-home-${width}.png`, fullPage: true });
  }
  const footer = page.getByTestId('site-footer');
  await expect(footer.getByRole('link')).toHaveText(['Telegram', 'Discord', 'Оферта', 'Политика конфиденциальности']);
});
