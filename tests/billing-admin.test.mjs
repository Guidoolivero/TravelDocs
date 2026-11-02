import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './firebase-fixture.mjs';
const env = { BILLING_ENABLED: 'true', ARCA_ENVIRONMENT: 'test', BILLING_FIREBASE_PROJECT_ID: 'demo-billing', FIREBASE_SERVICE_ACCOUNT: '{"project_id":"demo-billing"}', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };

test('guardar ficha parcial en admin no la expone en el documento de agencia', async () => {
  const f = fixture({ env });
  const res = await f.agency('agency', { billing: { legalName: 'Agencia ficticia' } });
  assert.equal(res.statusCode, 200);
  const list = JSON.parse((await f.request('/agencies')).body);
  assert.equal(list.agencies[0].billing.legalName, 'Agencia ficticia');
  assert.equal(f.docs.get('agencies/agency').billing, undefined);
});

test('ficha omitida no cambia y ficha invalida rechaza todo el patch', async () => {
  const f = fixture({ env });
  await f.agency('agency', { billing: { legalName: 'Antes' } });
  await f.agency('agency', { name: 'Nombre nuevo' });
  assert.equal(JSON.parse((await f.request('/agencies')).body).agencies[0].billing.legalName, 'Antes');
  const res = await f.agency('agency', { name: 'No guardar', billing: { amount: -1 } });
  assert.equal(res.statusCode, 400);
  assert.equal(f.docs.get('agencies/agency').name, 'Nombre nuevo');
});

test('la ficha fiscal no se puede escribir contra produccion ni por un miembro', async () => {
  const f = fixture();
  assert.equal((await f.agency('agency', { billing: {} })).statusCode, 503);
  const g = fixture({ env });
  assert.equal((await g.agency('agency', { billing: {} }, 'user')).statusCode, 403);
  const h = fixture({ env: { ...env, FIREBASE_SERVICE_ACCOUNT: '{"project_id":"tradingdocs-mt"}' } });
  assert.equal((await h.agency('agency', { billing: {} })).statusCode, 503);
});

test('completar ficha a mitad de mes habilita el siguiente y guardar de nuevo no lo posterga', async () => {
  const f = fixture({ env });
  f.docs.get('agencies/agency').createdAt = '2026-01-01';
  f.clock.now = Date.parse('2026-11-15T15:00:00Z');
  const billing = { taxId: '20123456786', legalName: 'Prueba', address: 'Calle 1', condition: 'monotributo', currency: 'USD', amount: 10000 };
  await f.agency('agency', { billing });
  let agency = JSON.parse((await f.request('/agencies')).body).agencies.find(a => a.id === 'agency');
  assert.equal(agency.billingStatus.firstPeriod, '2026-12');
  assert.equal(agency.billingStatus.state, 'scheduled');
  f.clock.now = Date.parse('2026-12-02T15:00:00Z');
  await f.agency('agency', { billing });
  agency = JSON.parse((await f.request('/agencies')).body).agencies.find(a => a.id === 'agency');
  assert.equal(agency.billingStatus.firstPeriod, '2026-12');
  assert.equal(agency.billingStatus.state, 'ready');
});

test('reactivar a mitad de mes espera al siguiente aunque la ficha siga completa', async () => {
  const f = fixture({ env });
  f.docs.set('agencies/otra', { createdAt: '2026-01-01', status: 'suspended' });
  f.docs.set('billingProfiles/otra', { enabledOn: '2026-02-10', profile: { taxId: '20123456786', legalName: 'Prueba', address: 'Calle 1', condition: 'monotributo', currency: 'USD', amount: 10000 } });
  f.clock.now = Date.parse('2026-11-15T15:00:00Z');
  await f.agency('otra', { status: 'active' });
  const agency = JSON.parse((await f.request('/agencies')).body).agencies.find(a => a.id === 'otra');
  assert.equal(agency.billingStatus.firstPeriod, '2026-12');
  assert.equal(agency.billingStatus.state, 'scheduled');
});

test('recrear slug no hereda ficha fiscal de una agencia eliminada', async () => {
  const f = fixture({ env });
  f.docs.set('billingProfiles/nueva', { enabledOn: '2026-01-01', profile: { legalName: 'Agencia anterior' } });
  const response = await f.request('/agencies', { slug: 'nueva', name: 'Agencia nueva', plan: 'trial' }, 'POST');
  assert.equal(response.statusCode, 200);
  const agency = JSON.parse((await f.request('/agencies')).body).agencies.find(a => a.id === 'nueva');
  assert.equal(agency.billing.legalName, undefined);
});

test('reactivar una agencia incorporada no reutiliza el mes inicial y cliente no puede adelantarlo', async () => {
  const f = fixture({ env });
  f.clock.now = Date.parse('2026-11-15T15:00:00Z');
  f.docs.set('agencies/otra', { createdAt: '2026-08-01', status: 'active' });
  const profile = { taxId: '20123456786', legalName: 'Ficticia', address: 'Calle 1', condition: 'monotributo', currency: 'ARS', amount: 10000 };
  f.docs.set('billingProfiles/otra', { profile, enabledOn: '2026-11-02', initialPeriod: '2026-11', prices: [{ period: '2026-11', amount: 10000, currency: 'ARS' }] });
  const before = JSON.parse((await f.request('/agencies')).body).agencies.find(a => a.id === 'otra');
  assert.equal(before.billingStatus.state, 'ready');
  assert.equal((await f.agency('otra', { billing: { ...profile, initialPeriod: '2026-11' } })).statusCode, 400);
  await f.agency('otra', { status: 'suspended' });
  await f.agency('otra', { status: 'active' });
  const after = JSON.parse((await f.request('/agencies')).body).agencies.find(a => a.id === 'otra');
  assert.equal(after.billingStatus.firstPeriod, '2026-12');
  assert.equal(after.billingStatus.state, 'scheduled');
  assert.equal(f.docs.get('billingProfiles/otra').initialPeriod, undefined);
});
