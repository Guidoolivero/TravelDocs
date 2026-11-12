import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './firebase-fixture.mjs';

const require = createRequire(import.meta.url);

test('route-agent clasifica sin header Authorization', async t => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  t.after(() => {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  });
  const request = t.mock.method(globalThis, 'fetch', async () => Response.json({ answers: { route: {
    type: 'choice', choice: 'claude', confidence: 0.8,
    probabilities: { claude: 0.8, cursor: 0.1, gemini: 0.05, multiple: 0.05 },
  } } }));
  const { handler } = require('../netlify/functions/route-agent.cjs');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Explicar el flujo de check-in' }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).route, 'claude');
  assert.equal(request.mock.callCount(), 1);
});

test('route-agent rechaza cuerpos invalidos y mensajes vacios', async t => {
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No debe consultar Gemini'); });
  const f = fixture({ env: { GEMINI_API_KEY: 'test-key' } });
  for (const body of [null, [], 42, 'mensaje', {}, { message: 5 }, { message: '' }, { message: '   ' }]) {
    assert.equal((await f.invoke('route-agent', body)).statusCode, 400);
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
  const f = fixture({ env: { GEMINI_API_KEY: 'test-key' } });
  const response = await f.invoke('route-agent', { message: 'Implementar el formulario' }, 'user');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    route: 'cursor', confidence: 0.9, type: 'choice',
    probabilities: { cursor: 0.9, claude: 0.05, gemini: 0.02, multiple: 0.03 },
  });
  assert.equal(request.mock.callCount(), 1);
});

test('route-agent devuelve 502 ante errores HTTP o de red sin exponer detalles', async t => {
  const request = t.mock.method(globalThis, 'fetch');
  const f = fixture({ env: { GEMINI_API_KEY: 'test-key' } });
  for (const status of [429, 503]) {
    request.mock.mockImplementation(async () => Response.json({ error: { message: 'provider-internal-detail' } }, { status }));
    const response = await f.invoke('route-agent', { message: 'Revisar un PR' });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(JSON.parse(response.body), { error: 'Error al llamar a Gemini Decisions API' });
  }
  request.mock.mockImplementation(async () => { throw new Error('provider-internal-detail'); });
  const response = await f.invoke('route-agent', { message: 'Revisar un PR' });
  assert.equal(response.statusCode, 502);
  assert.deepEqual(JSON.parse(response.body), { error: 'Error al llamar a Gemini Decisions API' });
});

test('route-agent no inventa una ruta ante una respuesta invalida de Gemini', async t => {
  const request = t.mock.method(globalThis, 'fetch');
  const f = fixture({ env: { GEMINI_API_KEY: 'test-key' } });
  for (const answer of [null, { type: 'choice', choice: 'otro', confidence: 0.9 }, { type: 'choice', choice: 'cursor', confidence: 2 }]) {
    request.mock.mockImplementation(async () => Response.json({ answers: { route: answer } }));
    assert.equal((await f.invoke('route-agent', { message: 'Revisar un PR' })).statusCode, 502);
  }
});

test('route-agent rechaza GET y avisa si falta la API key', async t => {
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No debe consultar Gemini'); });
  const f = fixture();
  assert.equal((await f.invoke('route-agent', {}, 'user', 'GET')).statusCode, 405);
  assert.equal((await f.invoke('route-agent', { message: 'Revisar un PR' }, 'user')).statusCode, 500);
  assert.equal(request.mock.callCount(), 0);
});
