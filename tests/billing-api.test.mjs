import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './firebase-fixture.mjs';

test('facturacion exige administrador de plataforma y entorno aislado', async () => {
  const f = fixture();
  assert.equal((await f.invoke('billing-api', { action: 'preview', agencyId: 'agency' }, 'user')).statusCode, 403);
  assert.equal((await f.invoke('billing-api', { action: 'preview', agencyId: 'agency' })).statusCode, 503);
});

test('PDF exige administrador y no genera documentos sin autorizacion guardada', async () => {
  const f = fixture();
  assert.equal((await f.invoke('billing-pdf', {}, 'user')).statusCode, 403);
  assert.equal((await f.invoke('billing-pdf')).statusCode, 503);
  const g = fixture({ env: { BILLING_ENABLED: 'true', ARCA_ENVIRONMENT: 'test', BILLING_FIREBASE_PROJECT_ID: 'demo-billing', FIREBASE_SERVICE_ACCOUNT: '{"project_id":"demo-billing"}', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8185' } });
  const id = 'a'.repeat(64);
  g.docs.set('billingInvoices/' + id, { status: 'draft' });
  assert.equal((await g.invoke('billing-pdf', { invoiceId: id })).statusCode, 409);
});
