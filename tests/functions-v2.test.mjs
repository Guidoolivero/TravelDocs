import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dir = new URL('../netlify/functions/', import.meta.url);

// Netlify toma la funcion como v2 si la entrada tiene default y ningun handler. Su parser solo
// reconoce el default si es una llamada a un identificador: `v2(...)` si, `require(...)(...)` no.
test('cada entrada de netlify/functions exporta default y no handler (API v2)', () => {
  const entries = readdirSync(dir).filter(name => name.endsWith('.cjs') && !name.startsWith('_'));
  assert.equal(entries.length, 13);
  for (const name of entries) {
    const src = readFileSync(new URL(name, dir), 'utf8');
    assert.match(src, /^exports\.default = v2\(/m, name);
    assert.doesNotMatch(src, /exports\.handler|module\.exports\s*=/, name);
  }
});

test('v2 pasa el Request al handler como evento y devuelve un Response', async () => {
  const v2 = require('../netlify/functions/_v2.cjs');
  let event;
  const fn = v2(async e => { event = e; return { statusCode: 201, headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' }; });
  const res = await fn(new Request('https://x.test/.netlify/functions/admin-api/users/u1?range=daily', {
    method: 'PATCH', headers: { Authorization: 'Bearer t' }, body: '{"a":1}',
  }));
  assert.equal(event.httpMethod, 'PATCH');
  assert.equal(event.path, '/.netlify/functions/admin-api/users/u1');
  assert.equal(event.rawUrl, 'https://x.test/.netlify/functions/admin-api/users/u1?range=daily');
  assert.deepEqual(event.queryStringParameters, { range: 'daily' });
  assert.equal(event.headers.authorization, 'Bearer t');
  assert.equal(event.body, '{"a":1}');
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.deepEqual(await res.json(), { ok: true });

  const get = await v2(async e => { event = e; })(new Request('https://x.test/f'));
  assert.equal(event.body, null);
  assert.equal(get.status, 204);
  assert.equal(await get.text(), '');

  // reply(204, {}) arma body '{}': un Response 204 con body tira TypeError.
  const options = await v2(async () => ({ statusCode: 204, body: '{}' }))(new Request('https://x.test/f', { method: 'OPTIONS' }));
  assert.equal(options.status, 204);
});
