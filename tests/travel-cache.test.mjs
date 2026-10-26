import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './firebase-fixture.mjs';

const stop = { pais: 'Pais ficticio', pais_codigo: 'ZZZ', aeropuerto_iata: 'ZZZ', tipo: 'destino', requisitos: [] };
function travelFixture() {
  let searches = 0;
  class GoogleGenAI {
    models = { generateContent: async () => {
      searches++;
      return { text: JSON.stringify([{ pais: 'ZZZ', nombre: 'Requisito oficial ficticio', categoria: 'otro', obligatorio: false }]) };
    } };
  }
  const f = fixture({ env: { GEMINI_API_KEY: 'dummy' }, modules: { '@google/genai': { GoogleGenAI, HarmCategory: {}, HarmBlockThreshold: {} } } });
  f.docs.set('users/user', { agencyId: 'other', role: 'agent', active: true });
  f.docs.set('agencies/other', { status: 'active' });
  f.tokens.get('user').agencyId = 'other';
  return { ...f, searches: () => searches, verify: (ruta, actor = 'admin', segmentos = []) =>
    f.invoke('gemini-travel', { fase: 'verificacion', nacionalidad: 'ARG', ruta, segmentos }, actor) };
}

test('la verificacion de otra agencia no recibe requisitos aportados por el primer cliente', async () => {
  const f = travelFixture();
  const poisoned = [{ ...stop, requisitos: [{ categoria: 'otro', nombre: 'MARCADOR_DE_PRUEBA', descripcion: 'dato del cliente A' }] }];
  assert.equal((await f.verify(poisoned)).statusCode, 200);
  const response = await f.verify([stop], 'user');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes('MARCADOR_DE_PRUEBA'), false);
  assert.equal(f.searches(), 2);
  const repeated = await f.verify([stop], 'user');
  assert.equal(JSON.parse(repeated.body).data._meta.deCache, true);
  assert.equal(f.searches(), 2);
});

test('consultas identicas de dos agencias usan caches separados y cada una reutiliza el suyo', async () => {
  const f = travelFixture();
  await f.verify([stop]);
  await f.verify([stop], 'user');
  assert.equal(f.searches(), 2);
  const response = await f.verify([stop], 'user');
  assert.equal(JSON.parse(response.body).data._meta.deCache, true);
  assert.equal(f.searches(), 2);
});

test('dos contenidos distintos de la misma ruta no comparten verificacion dentro de una agencia', async () => {
  const f = travelFixture();
  await f.verify([{ ...stop, requisitos: [{ categoria: 'otro', nombre: 'MARCADOR_DE_PRUEBA' }] }]);
  const response = await f.verify([stop]);
  assert.equal(response.body.includes('MARCADOR_DE_PRUEBA'), false);
  assert.equal(f.searches(), 2);
});

test('la verificacion distingue el contexto de los segmentos anteriores', async () => {
  const f = travelFixture();
  await f.verify([stop], 'admin', [{ origen: 'GRU', destino: 'ZZZ' }]);
  await f.verify([stop], 'admin', [{ origen: 'MIA', destino: 'ZZZ' }]);
  assert.equal(f.searches(), 2);
});

test('las entradas viejas de verificacion compartidas no se reutilizan', async () => {
  const f = travelFixture();
  f.docs.set('travelCache/v1ver_ZZZ-destino_ARG', {
    data: { ruta: [{ ...stop, requisitos: [{ nombre: 'MARCADOR_DE_PRUEBA' }] }] },
    expiresAt: new Date(Date.now() + 86400000),
  });
  const response = await f.verify([stop], 'user');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes('MARCADOR_DE_PRUEBA'), false);
  assert.equal(f.searches(), 1);
});
