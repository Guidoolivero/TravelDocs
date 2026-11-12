import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './firebase-fixture.mjs';

const require = createRequire(import.meta.url);
const SECRET = 'route-secret';

function routeFixture(env = {}) {
  return fixture({ env: { GEMINI_API_KEY: 'test-key', ROUTE_AGENT_SECRET: SECRET, ...env } });
}

test('route-agent exige Bearer ROUTE_AGENT_SECRET y no usa login de TravelDocs', async t => {
  const previous = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    ROUTE_AGENT_SECRET: process.env.ROUTE_AGENT_SECRET,
  };
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.ROUTE_AGENT_SECRET = SECRET;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const request = t.mock.method(globalThis, 'fetch', async () => Response.json({ answers: { route: {
    type: 'choice', choice: 'claude', confidence: 0.8,
    probabilities: { claude: 0.8, cursor: 0.1, gemini: 0.05, multiple: 0.05 },
  } } }));
  const { handler } = require('../netlify/functions/route-agent.cjs');
  const message = { httpMethod: 'POST', body: JSON.stringify({ message: 'Explicar el flujo de check-in' }) };
  for (const headers of [{}, { authorization: 'Bearer otro-secreto' }, { Authorization: SECRET }]) {
    const denied = await handler({ ...message, headers });
    assert.equal(denied.statusCode, 401);
    assert.deepEqual(JSON.parse(denied.body), { error: 'Unauthorized' });
  }
  const response = await handler({ ...message, headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).route, 'claude');
  assert.equal(request.mock.callCount(), 1);
});

test('route-agent rechaza cuerpos invalidos y mensajes vacios', async t => {
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No debe consultar Gemini'); });
  const f = routeFixture();
  for (const body of [null, [], 42, 'mensaje', {}, { message: 5 }, { message: '' }, { message: '   ' }]) {
    assert.equal((await f.invoke('route-agent', body, SECRET)).statusCode, 400);
  }
  assert.equal(request.mock.callCount(), 0);
});

test('route-agent consulta Decisions REST y conserva la clasificacion', async t => {
  const request = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/decisions');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gemini-decision-1');
    assert.equal(body.input, 'Implementar el formulario');
    assert.equal(body.questions.route.type, 'choice');
    assert.deepEqual(Object.keys(body.questions.route.criteria).sort(), ['claude', 'cursor', 'gemini', 'multiple']);
    return Response.json({ answers: { route: {
      type: 'choice', choice: 'cursor', confidence: 0.9,
      probabilities: { cursor: 0.9, claude: 0.05, gemini: 0.02, multiple: 0.03 },
    } } });
  });
  const f = routeFixture();
  const response = await f.invoke('route-agent', { message: 'Implementar el formulario' }, SECRET);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    route: 'cursor', confidence: 0.9, type: 'choice',
    probabilities: { cursor: 0.9, claude: 0.05, gemini: 0.02, multiple: 0.03 },
  });
  assert.equal(request.mock.callCount(), 1);
});

test('route-agent devuelve 502 ante errores HTTP o de red sin exponer detalles', async t => {
  const request = t.mock.method(globalThis, 'fetch');
  const f = routeFixture();
  for (const status of [429, 503]) {
    request.mock.mockImplementation(async () => Response.json({ error: { message: 'provider-internal-detail' } }, { status }));
    const response = await f.invoke('route-agent', { message: 'Revisar un PR' }, SECRET);
    assert.equal(response.statusCode, 502);
    assert.deepEqual(JSON.parse(response.body), { error: 'Error al llamar a Gemini Decisions API' });
  }
  request.mock.mockImplementation(async () => { throw new Error('provider-internal-detail'); });
  const response = await f.invoke('route-agent', { message: 'Revisar un PR' }, SECRET);
  assert.equal(response.statusCode, 502);
  assert.deepEqual(JSON.parse(response.body), { error: 'Error al llamar a Gemini Decisions API' });
});

test('route-agent no inventa una ruta ante una respuesta invalida de Gemini', async t => {
  const request = t.mock.method(globalThis, 'fetch');
  const f = routeFixture();
  for (const answer of [null, { type: 'choice', choice: 'otro', confidence: 0.9 }, { type: 'choice', choice: 'cursor', confidence: 2 }]) {
    request.mock.mockImplementation(async () => Response.json({ answers: { route: answer } }));
    assert.equal((await f.invoke('route-agent', { message: 'Revisar un PR' }, SECRET)).statusCode, 502);
  }
});

test('route-agent rechaza GET y avisa si falta la API key', async t => {
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No debe consultar Gemini'); });
  const f = fixture({ env: { ROUTE_AGENT_SECRET: SECRET } });
  assert.equal((await f.invoke('route-agent', {}, SECRET, 'GET')).statusCode, 405);
  const missingKey = await f.invoke('route-agent', { message: 'Revisar un PR' }, SECRET);
  assert.equal(missingKey.statusCode, 500);
  assert.match(JSON.parse(missingKey.body).error, /GEMINI_API_KEY/);
  assert.equal(request.mock.callCount(), 0);
});
