import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './firebase-fixture.mjs';

test('GET /agencies incluye createdAt en fecha Argentina', async () => {
  const f = fixture();
  f.docs.set('agencies/agency', {
    name: 'Agencia', slug: 'agency', plan: 'pro', status: 'active',
    createdAt: Date.UTC(2026, 9, 26, 18, 0, 0)
  });
  const res = await f.request('/agencies', undefined, 'GET');
  assert.equal(res.statusCode, 200);
  const row = JSON.parse(res.body).agencies.find(a => a.id === 'agency');
  assert.equal(row.createdAt, '2026-10-26');
});

test('GET /agencies sin createdAt devuelve string vacio', async () => {
  const f = fixture();
  const res = await f.request('/agencies', undefined, 'GET');
  assert.equal(res.statusCode, 200);
  const row = JSON.parse(res.body).agencies.find(a => a.id === 'agency');
  assert.equal(row.createdAt, '');
});

test('GET /agencies/:id/members incluye createdAt del invitedAt', async () => {
  const f = fixture();
  f.docs.set('agencies/agency/members/user', {
    email: 'user@test.com', displayName: 'Ana', role: 'agent', active: true,
    invitedAt: Date.UTC(2026, 8, 1, 15, 0, 0)
  });
  const res = await f.request('/agencies/agency/members', undefined, 'GET');
  assert.equal(res.statusCode, 200);
  const ana = JSON.parse(res.body).members.find(m => m.uid === 'user');
  assert.equal(ana.createdAt, '2026-09-01');
  assert.equal(ana.agencyId, 'agency');
});

test('GET /users lista miembros de todas las agencias con fecha y nombre', async () => {
  const f = fixture();
  f.docs.set('agencies/otra', { name: 'Otra', status: 'active' });
  f.docs.set('agencies/otra/members/pepe', {
    email: 'pepe@otra.com', displayName: 'Pepe', role: 'owner', active: true,
    invitedAt: Date.UTC(2026, 9, 10, 15, 0, 0)
  });
  f.docs.set('agencies/agency/members/user', {
    email: 'user@test.com', role: 'agent', active: true,
    invitedAt: Date.UTC(2026, 9, 2, 15, 0, 0)
  });
  const res = await f.request('/users', undefined, 'GET');
  assert.equal(res.statusCode, 200);
  const members = JSON.parse(res.body).members;
  assert.deepEqual(members.map(m => m.email).sort(), ['pepe@otra.com', 'user@test.com']);
  const pepe = members.find(m => m.uid === 'pepe');
  assert.equal(pepe.agencyId, 'otra');
  assert.equal(pepe.agencyName, 'Otra');
  assert.equal(pepe.createdAt, '2026-10-10');
});
