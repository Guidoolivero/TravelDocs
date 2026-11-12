import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handler } = require('../netlify/functions/slack-orchestrator.cjs');

const SIGNING_SECRET = 'test-signing-secret';
const ROUTE_SECRET = 'test-route-secret';

function sign(body, timestamp) {
  const base = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', SIGNING_SECRET).update(base).digest('hex');
  return `v0=${hmac}`;
}

function makeEvent(payload, { extraHeaders = {}, base64 = false } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = {
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': sign(body, timestamp),
    ...extraHeaders
  };
  return {
    httpMethod: 'POST',
    headers,
    body: base64 ? Buffer.from(body).toString('base64') : body,
    isBase64Encoded: base64
  };
}

function setEnv(t) {
  const prev = { ...process.env };
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  process.env.ROUTE_AGENT_SECRET = ROUTE_SECRET;
  process.env.SITE_URL = 'https://example.test';
  t.after(() => { process.env = prev; });
}

test('message event returns 200 and dispatches to the background function', async (t) => {
  setEnv(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response('', { status: 202 });
  });
  const payload = {
    type: 'event_callback',
    event: { type: 'message', text: 'arreglá el bug', channel: 'C1', ts: '123.45' }
  };
  const res = await handler(makeEvent(payload));
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /slack-orchestrator-background$/);
  const sent = JSON.parse(calls[0].options.body);
  assert.deepEqual(sent, { channel: 'C1', thread_ts: '123.45', text: 'arreglá el bug' });
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${ROUTE_SECRET}`);
});

test('Slack retry is acked without dispatching (dedup)', async (t) => {
  setEnv(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 202 }));
  const payload = { type: 'event_callback', event: { type: 'message', text: 'hola', channel: 'C1', ts: '1.0' } };
  const res = await handler(makeEvent(payload, { extraHeaders: { 'x-slack-retry-num': '1' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('url_verification returns the challenge', async (t) => {
  setEnv(t);
  const res = await handler(makeEvent({ type: 'url_verification', challenge: 'abc123' }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { challenge: 'abc123' });
});

test('malformed signature returns 401 instead of throwing', async (t) => {
  setEnv(t);
  const body = JSON.stringify({ type: 'url_verification', challenge: 'x' });
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await handler({
    httpMethod: 'POST',
    headers: { 'x-slack-request-timestamp': ts, 'x-slack-signature': 'v0=deadbeef' },
    body
  });
  assert.equal(res.statusCode, 401);
});

test('base64-encoded body is decoded, verified and dispatched', async (t) => {
  setEnv(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response('', { status: 202 });
  });
  const payload = { type: 'event_callback', event: { type: 'message', text: 'hola', channel: 'C9', ts: '9.9' } };
  const res = await handler(makeEvent(payload, { base64: true }));
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /slack-orchestrator-background$/);
});

test('bot messages are ignored without dispatch', async (t) => {
  setEnv(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 202 }));
  const payload = { type: 'event_callback', event: { type: 'message', text: 'soy bot', bot_id: 'B1', channel: 'C1', ts: '1.0' } };
  const res = await handler(makeEvent(payload));
  assert.equal(res.statusCode, 200);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('stale timestamp is rejected', async (t) => {
  setEnv(t);
  const body = JSON.stringify({ type: 'url_verification', challenge: 'x' });
  const oldTs = Math.floor(Date.now() / 1000) - 60 * 10;
  const res = await handler({
    httpMethod: 'POST',
    headers: {
      'x-slack-request-timestamp': String(oldTs),
      'x-slack-signature': sign(body, String(oldTs))
    },
    body
  });
  assert.equal(res.statusCode, 401);
});
