import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../cloudflare/api-worker/src/index.ts';

function mockDatabase({ existingApplication = false, insertCounter = { count: 0 } } = {}) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            first: async () => sql.includes('SELECT * FROM calendar_events') ? null : existingApplication ? { id: 'existing' } : null,
            run: async () => { insertCounter.count += 1; return { meta: { changes: 1 } }; },
            all: async () => ({ results: [] }),
          };
        },
      };
    },
  };
}

function applicationRequest(body, ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`) {
  return new Request('https://api.example.test/api/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({
      submissionId: crypto.randomUUID(),
      name: 'Test Player',
      contact: '@test_player',
      players: 1,
      consent: true,
      website: '',
      ...body,
    }),
  });
}

test('honeypot accepts a bot-shaped submission without touching D1', async () => {
  const response = await worker.fetch(applicationRequest({ website: 'filled' }), {
    DB: { prepare() { throw new Error('honeypot must not reach D1'); } },
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).ok, true);
});

test('stale event selections return 409', async () => {
  const response = await worker.fetch(applicationRequest({ eventId: 'stale', occurrenceDate: '2026-10-02' }), { DB: mockDatabase() });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).selectionChanged, true);
});

test('duplicate submission ids are acknowledged without a second insert', async () => {
  const counter = { count: 0 };
  const response = await worker.fetch(applicationRequest({}), { DB: mockDatabase({ existingApplication: true, insertCounter: counter }) });
  assert.equal(response.status, 200);
  assert.equal(counter.count, 0);
  assert.match((await response.json()).notice, /уже принята/i);
});

test('rate limit rejects the sixth application from one client window', async () => {
  const counter = { count: 0 };
  const env = { DB: mockDatabase({ insertCounter: counter }) };
  let lastResponse;
  for (let index = 0; index < 6; index += 1) {
    lastResponse = await worker.fetch(applicationRequest({}, '198.51.100.88'), env);
  }
  assert.equal(lastResponse.status, 429);
  assert.equal(counter.count, 5);
});

test('web application notification accepts the existing chat id secret alias', async () => {
  const originalFetch = globalThis.fetch;
  let telegramPayload;
  globalThis.fetch = async (_input, init) => {
    telegramPayload = JSON.parse(init.body);
    return Response.json({ ok: true });
  };

  try {
    const response = await worker.fetch(applicationRequest({ system: 'D&D' }), {
      DB: mockDatabase(),
      TELEGRAM_BOT_TOKEN: 'test-token',
      APPLICATION_NOTIFY_CHAT_ID: '-1001234567890',
      PUBLIC_SITE_ORIGIN: 'https://example.test',
    });

    assert.equal(response.status, 200);
    assert.equal(telegramPayload.chat_id, '-1001234567890');
    assert.match(telegramPayload.text, /Новая веб-заявка/);
    assert.match(telegramPayload.text, /https:\/\/example\.test\/master\/applications/);
    assert.equal(telegramPayload.text.includes('Test Player'), false);
    assert.equal(telegramPayload.text.includes('@test_player'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
