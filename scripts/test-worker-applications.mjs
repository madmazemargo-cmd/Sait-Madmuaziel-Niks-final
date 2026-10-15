import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../cloudflare/api-worker/src/index.ts';
import { createHash } from 'node:crypto';

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

function seriesDatabase() {
  const csrf = 'test-csrf';
  const exclusions = new Set();
  const writes = [];
  const event = { id: 'weekly', title: 'Серия', event_date: '2026-10-01', recurrence: 'weekly', recurrence_until: '2026-12-01', archived: 0, revision: 1, excluded_dates: '["2026-10-15"]' };
  const db = {
    prepare(sql) {
      const statement = {
        sql, values: [], bind(...values) { this.values = values; return this; },
        async first() {
          if (sql.includes('FROM master_sessions')) return { id: 'session', user_id: 'master', active: 1, csrf_token_hash: createHash('sha256').update(csrf).digest('hex') };
          if (sql.includes('SELECT * FROM calendar_events')) return statement.values[0] === event.id && !event.archived ? event : null;
          if (sql.includes('SELECT 1 FROM calendar_event_exclusions')) return exclusions.has(statement.values[1]) ? { found: 1 } : null;
          return null;
        },
        async all() {
          if (sql.startsWith('SELECT * FROM calendar_events')) return { results: [event] };
          if (sql.includes('FROM calendar_event_exclusions')) return { results: [...exclusions].map(occurrence_date => ({ occurrence_date })) };
          return { results: [] };
        },
        async run() {
          writes.push({ sql, values: statement.values });
          if (sql.startsWith('INSERT INTO calendar_event_exclusions')) exclusions.add(statement.values[1]);
          if (sql.startsWith('UPDATE calendar_events SET revision')) event.revision += 1;
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
  };
  return { db, event, exclusions, writes, csrf };
}

function occurrenceRequest(date, csrf = 'test-csrf', authenticated = true, eventId = 'weekly') {
  return new Request(`https://api.example.test/api/master/events/${eventId}/occurrences/${date}`, {
    method: 'DELETE', headers: { ...(authenticated ? { Cookie: 'master_session=test-session' } : {}), 'X-CSRF-Token': csrf },
  });
}

test('removing one occurrence preserves the series, other dates, and authentication', async () => {
  const fixture = seriesDatabase();
  const env = { DB: fixture.db };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await worker.fetch(occurrenceRequest('2026-10-22'), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Set-Cookie'), null);
  }
  assert.deepEqual([...fixture.exclusions], ['2026-10-22']);
  assert.equal(fixture.event.archived, 0);
  assert.equal(fixture.event.recurrence, 'weekly');
  assert.equal(fixture.event.event_date, '2026-10-01');
  assert.equal(fixture.writes.some(({ sql }) => /DELETE FROM|archived = 1|revoked_at/.test(sql)), false);
  for (const path of ['/api/calendar', '/api/master/events']) {
    const response = await worker.fetch(new Request(`https://api.example.test${path}`, { headers: { Cookie: 'master_session=test-session' } }), env);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).events[0].excludedDates, ['2026-10-15', '2026-10-22']);
  }
  const selection = await worker.fetch(new Request('https://api.example.test/api/applications?event=weekly&date=2026-10-22'), env);
  assert.equal(selection.status, 404);
  const nextSelection = await worker.fetch(new Request('https://api.example.test/api/applications?event=weekly&date=2026-10-29'), env);
  assert.equal(nextSelection.status, 200);
});

test('occurrence removal requires authentication and CSRF and rejects unrelated or invalid dates', async () => {
  const fixture = seriesDatabase();
  const env = { DB: fixture.db };
  assert.equal((await worker.fetch(occurrenceRequest('2026-10-22', fixture.csrf, false), env)).status, 401);
  assert.equal((await worker.fetch(occurrenceRequest('2026-10-22', 'wrong'), env)).status, 403);
  for (const date of ['2026-10-23', '2026-10-00', '2026-02-30', '2026-12-10', 'bad-date']) {
    assert.equal((await worker.fetch(occurrenceRequest(date), env)).status, 400, date);
  }
  assert.equal((await worker.fetch(occurrenceRequest('2026-10-22', fixture.csrf, true, 'missing'), env)).status, 404);
  fixture.event.recurrence = 'none';
  assert.equal((await worker.fetch(occurrenceRequest('2026-10-01'), env)).status, 400);
  assert.equal(fixture.writes.length, 0);
});

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
