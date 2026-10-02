import { expect, test } from '@playwright/test';

function todayInMoscow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

test('production page and APIs are healthy and security headers are present', async ({ request }) => {
  const page = await request.get('/');
  expect(page.status()).toBe(200);
  expect(await page.text()).toContain('id="root"');

  const headers = page.headers();
  expect(headers['strict-transport-security']).toContain('max-age=31536000');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("connect-src 'self'");

  const health = await request.get('/api/healthz');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });

  const calendar = await request.get('/api/calendar');
  expect(calendar.status()).toBe(200);
  expect(Array.isArray((await calendar.json()).events)).toBe(true);

  const catalog = await request.get('/api/catalog');
  expect(catalog.status()).toBe(200);
  expect(Array.isArray((await catalog.json()).items)).toBe(true);
});

test('calendar details trap keyboard focus and return it to the opener', async ({ page }) => {
  await page.route('**/api/calendar', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      events: [{
        id: 'e2e-keyboard-event',
        title: 'Keyboard Test',
        eventDate: todayInMoscow(),
        startTime: '19:00',
        gameType: 'oneshot',
        status: 'available',
        seats: 3,
        description: 'Проверка клавиатурного управления.',
        system: 'D&D 5e',
        format: 'online',
        location: 'Онлайн',
        duration: '3 часа',
        price: '1500 ₽',
        experience: 'Подходит новичкам',
        age: '18+',
        playerPrep: '',
        archived: false,
        applicationUrl: '',
        recurrence: 'none',
        recurrenceUntil: null,
        excludedDates: [],
      }],
    }),
  }));
  await page.route('**/api/catalog', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));

  await page.goto('/calendar/week');
  const opener = page.getByRole('button', { name: 'Keyboard Test, 19:00, подробности' });
  await expect(opener).toBeVisible();
  await opener.focus();
  await opener.click();

  const dialog = page.getByRole('dialog', { name: 'Keyboard Test' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('application form carries first-touch UTM values through submission', async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/calendar', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"events":[]}' }));
  await page.route('**/api/catalog', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/applications*', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Not found"}' });
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.goto('/anketa?utm_source=telegram&utm_medium=community&utm_campaign=autumn');
  await page.getByTestId('button-next-step').click();
  await expect(page.getByRole('alert')).toContainText('Укажите имя или ник');
  await page.getByTestId('input-name').fill('Test Player');
  await page.getByTestId('input-telegram').fill('@test_player');
  await page.getByLabel(/Когда удобно играть/).fill('Вечера по будням');
  await page.getByTestId('button-next-step').click();
  await page.getByLabel('Я согласна на обработку ответов и контакта для обсуждения игры.').check();
  await page.getByTestId('button-submit-application').click();

  await expect(page.getByTestId('application-success')).toBeVisible();
  expect(submitted).toMatchObject({ utmSource: 'telegram', utmMedium: 'community', utmCampaign: 'autumn' });
});

test('stale game selections cannot be submitted', async ({ page }) => {
  await page.route('**/api/calendar', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"events":[]}' }));
  await page.route('**/api/catalog', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/applications?*', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Selected game is no longer available."}' }));

  await page.goto(`/anketa?event=stale-event&date=${todayInMoscow()}`);
  await expect(page.getByRole('alert')).toContainText('актуальную дату');
  await page.getByTestId('button-next-step').click();
  await expect(page.getByTestId('form-step-1')).toBeVisible();
  await expect(page.getByTestId('form-step-2')).toHaveCount(0);
});
