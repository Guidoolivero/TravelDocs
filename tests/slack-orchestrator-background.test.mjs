import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handler } = require('../netlify/functions/slack-orchestrator-background.cjs');

const ROUTE_SECRET = 'test-route-secret';

function setEnv(t) {
  const prev = { ...process.env };
  process.env.ROUTE_AGENT_SECRET = ROUTE_SECRET;
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SITE_URL = 'https://example.test';
  t.after(() => { process.env = prev; });
}

function makeEvent(body) {
  return {
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ROUTE_SECRET}` },
    body: JSON.stringify(body)
  };
}

test('rejects unauthorized calls', async (t) => {
  setEnv(t);
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}' });
  assert.equal(res.statusCode, 401);
});

test('routes and posts the primary agent to the Slack thread', async (t) => {
  setEnv(t);
  let slackText = '';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('route-agent')) return Response.json({ route: 'cursor', confidence: 0.9 });
    slackText = JSON.parse(options.body).text;
    return Response.json({ ok: true });
  });
  const res = await handler(makeEvent({ channel: 'C1', thread_ts: '1.0', text: 'implementá X' }));
  assert.equal(res.statusCode, 200);
  assert.match(slackText, /Cursor/);
});

test('multiple route is not collapsed to Claude', async (t) => {
  setEnv(t);
  let slackText = '';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('route-agent')) return Response.json({ route: 'multiple', confidence: 0.7 });
    slackText = JSON.parse(options.body).text;
    return Response.json({ ok: true });
  });
  const res = await handler(makeEvent({ channel: 'C1', thread_ts: '1.0', text: 'escaneá y arreglá' }));
  assert.equal(res.statusCode, 200);
  assert.match(slackText, /varios agentes/);
});

test('route-agent failure posts an error to the thread', async (t) => {
  setEnv(t);
  let slackText = '';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('route-agent')) return new Response('nope', { status: 500 });
    slackText = JSON.parse(options.body).text;
    return Response.json({ ok: true });
  });
  const res = await handler(makeEvent({ channel: 'C1', thread_ts: '1.0', text: 'hola' }));
  assert.equal(res.statusCode, 200);
  assert.match(slackText, /Error al hacer routing/);
});
