import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './firebase-fixture.mjs';

test('facturacion exige administrador de plataforma y entorno aislado', async () => {
  const f = fixture();
  assert.equal((await f.invoke('billing-api', { action: 'preview', agencyId: 'agency' }, 'user')).statusCode, 403);
  assert.equal((await f.invoke('billing-api', { action: 'preview', agencyId: 'agency' })).statusCode, 503);
});

test('API utiliza ambiente habilitado tanto en SDK como en servicio', async () => {
  let sdkEnvironment, serviceEnvironment, certificate;
  const f = fixture({ env: {
    BILLING_ENABLED: 'true', ARCA_ENVIRONMENT: 'production', CONTEXT: 'production',
    BILLING_FIREBASE_PROJECT_ID: 'tradingdocs-mt', FIREBASE_SERVICE_ACCOUNT: '{"project_id":"tradingdocs-mt"}',
    ARCA_TAX_ID: '20123456786', ARCA_SALES_POINT: '2', BILLING_PRODUCTION_CONFIRMATION: '20123456786:2',
    BILLING_ISSUER_JSON: JSON.stringify({ legalName: 'Prueba', address: 'Calle 1', grossIncome: 'Exento', activitiesStartDate: '2026-01-01' }),
  }, modules: {
    facturas: { createArcaClient(options) { sdkEnvironment = options.environment; certificate = options.certificatePem; return {}; } },
    './lib/billing-service.cjs': { createBillingService(options) { serviceEnvironment = options.environment; return { preview: async () => ({ status: 'draft' }) }; } },
  } });
  f.docs.set('billingSecrets/production', { taxId: '20123456786', salesPoint: 2, certificatePem: 'ficticio', privateKeyPem: 'ficticia' });
  assert.equal((await f.invoke('billing-api', { action: 'preview', agencyId: 'agency' })).statusCode, 200);
  assert.equal(sdkEnvironment, 'production');
  assert.equal(serviceEnvironment, 'production');
  assert.equal(certificate, 'ficticio');
  f.docs.get('billingSecrets/production').salesPoint = 3;
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


test('API traduce error de autenticacion ARCA sin filtrar secretos', async () => {
  let failure = Object.assign(new Error('TOKEN=secreto'), { code: 'ARCA_AUTHENTICATION_ERROR' });
  const f = fixture({ env: {
    BILLING_ENABLED: 'true', ARCA_ENVIRONMENT: 'test', BILLING_FIREBASE_PROJECT_ID: 'demo-billing',
    FIREBASE_SERVICE_ACCOUNT: '{"project_id":"demo-billing"}', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8185',
    ARCA_TAX_ID: '20123456786', ARCA_SALES_POINT: '1', ARCA_CERTIFICATE_PEM: 'certificado ficticio', ARCA_PRIVATE_KEY_PEM: 'clave ficticia',
    BILLING_ISSUER_JSON: JSON.stringify({ legalName: 'Prueba', address: 'Calle 1', grossIncome: 'Exento', activitiesStartDate: '2026-01-01' }),
  }, modules: { facturas: { createArcaClient() { throw failure; } } } });
  const response = await f.invoke('billing-api', { action: 'preview', agencyId: 'agency' });
  assert.equal(response.statusCode, 503);
  assert.match(JSON.parse(response.body).error, /certificado/);
  assert.doesNotMatch(response.body, /TOKEN|secreto/);
  failure = null;
  const unknown = await f.invoke('billing-api', { action: 'preview', agencyId: 'agency' });
  assert.equal(unknown.statusCode, 503);
  assert.match(JSON.parse(unknown.body).error, /Consulta el estado/);
});
