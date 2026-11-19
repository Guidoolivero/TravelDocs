import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../firebase-fixture.mjs';

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
    './lib/facturacion/billing-service.cjs': { createBillingService(options) { serviceEnvironment = options.environment; return { preview: async () => ({ status: 'draft' }) }; } },
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

test('emision, recuperacion y reintento registran actor y resultado sin datos fiscales ni secretos', async () => {
  const id = 'a'.repeat(64);
  const invoice = { id, agencyId: 'agency', period: '2026-11', environment: 'test', status: 'draft', receiver: { legalName: 'PRIVADO' } };
  let sends = 0;
  const f = fixture({ env: {
    BILLING_ENABLED: 'true', ARCA_ENVIRONMENT: 'test', BILLING_FIREBASE_PROJECT_ID: 'demo-billing',
    FIREBASE_SERVICE_ACCOUNT: '{"project_id":"demo-billing"}', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8185',
    ARCA_TAX_ID: '20123456786', ARCA_SALES_POINT: '1', ARCA_CERTIFICATE_PEM: 'certificado ficticio', ARCA_PRIVATE_KEY_PEM: 'clave ficticia',
    BILLING_ISSUER_JSON: JSON.stringify({ legalName: 'Prueba', address: 'Calle 1', grossIncome: 'Exento', activitiesStartDate: '2026-01-01' }),
  }, modules: {
    facturas: { createArcaClient: () => ({}) },
    './lib/facturacion/billing-service.cjs': { createBillingService: () => ({ get: async () => invoice, issue: async () => { sends++; return { ...invoice, status: 'authorized' }; } }) },
  } });
  for (const action of ['issue', 'recover', 'retry']) {
    const response = await f.invoke('billing-api', { action, invoiceId: id, digest: 'PRIVADO' });
    assert.equal(response.statusCode, 200);
    const entries = f.added.filter(([collection, data]) => collection === 'auditLogs' && data.action === `billing-${action}`).map(([, data]) => data);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].performedBy, 'admin');
    assert.equal(entries[0].details.stage, 'requested');
    assert.equal(entries[1].details.stage, 'result');
    assert.equal(entries[1].details.status, 'authorized');
    assert.doesNotMatch(JSON.stringify(entries), /PRIVADO|ficticia/);
  }
  f.added.push = () => { throw new Error('auditoria no disponible'); };
  assert.equal((await f.invoke('billing-api', { action: 'issue', invoiceId: id })).statusCode, 200);
  assert.equal(sends, 4, 'El fallo de auditoria no interrumpe ni repite la operacion fiscal');
});

test('errores inesperados de facturacion llegan a Sentry; los esperados no', async () => {
  const reportados = [];
  const env = { BILLING_ENABLED: 'true', ARCA_ENVIRONMENT: 'test', BILLING_FIREBASE_PROJECT_ID: 'demo-billing', FIREBASE_SERVICE_ACCOUNT: '{"project_id":"demo-billing"}', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8185',
    ARCA_TAX_ID: '20123456786', ARCA_SALES_POINT: '1', ARCA_CERTIFICATE_PEM: 'ficticio', ARCA_PRIVATE_KEY_PEM: 'ficticia', BILLING_ISSUER_JSON: JSON.stringify({ legalName: 'Prueba', address: 'Calle 1', grossIncome: 'Exento', activitiesStartDate: '2026-01-01' }) };
  const conError = err => fixture({ env, modules: {
    _sentry: { wrapHandler: fn => fn, reportError: async e => { reportados.push(e); } },
    facturas: { createArcaClient: () => ({}) },
    './lib/facturacion/billing-service.cjs': { createBillingService: () => ({ preview: async () => { throw err; } }) },
  } });
  for (const f of [conError(new Error('Firestore caido')), conError(Object.assign(new Error('Vista previa vieja'), { status: 409 }))]) {
    await f.invoke('billing-api', { action: 'preview', agencyId: 'agency' });
  }
  assert.deepEqual(reportados.map(e => e.message), ['Firestore caido']);
});

// La ficha fiscal de una agencia se completa con la constancia de inscripcion (Padron A5).
test('padron trae razon social, domicilio y condicion IVA desde ARCA por CUIT', async () => {
  const consultas = [];
  let respuesta = {
    taxId: '27337174766', name: 'AVALOS CARLA ANABELA', condition: 'monotributo', taxes: [], activities: [], errors: [], raw: {},
    address: { street: 'SAN MARTIN 123 Piso:2 Dpto:A', city: 'PUERTO MADRYN', postalCode: '9120', province: 'CHUBUT' },
  };
  const f = fixture({ env: {
    BILLING_ENABLED: 'true', ARCA_ENVIRONMENT: 'test', BILLING_FIREBASE_PROJECT_ID: 'demo-billing',
    FIREBASE_SERVICE_ACCOUNT: '{"project_id":"demo-billing"}', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8185',
    ARCA_TAX_ID: '20123456786', ARCA_SALES_POINT: '1', ARCA_CERTIFICATE_PEM: 'ficticio', ARCA_PRIVATE_KEY_PEM: 'ficticia',
    BILLING_ISSUER_JSON: JSON.stringify({ legalName: 'Prueba', address: 'Calle 1', grossIncome: 'Exento', activitiesStartDate: '2026-01-01' }),
  }, modules: { facturas: { createArcaClient: () => ({ padron: { getTaxpayerDetails: async cuit => { consultas.push(cuit); return respuesta; } } }) } } });
  assert.equal((await f.invoke('billing-api', { action: 'padron', taxId: '27337174766' }, 'user')).statusCode, 403);
  assert.equal((await f.invoke('billing-api', { action: 'padron', taxId: '27337174767' })).statusCode, 400);
  const ok = await f.invoke('billing-api', { action: 'padron', taxId: '27-33717476-6' });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(JSON.parse(ok.body), {
    taxId: '27337174766', legalName: 'AVALOS CARLA ANABELA',
    address: 'SAN MARTIN 123 Piso:2 Dpto:A, PUERTO MADRYN, 9120 CHUBUT', condition: 'monotributo', errors: [],
  });
  assert.deepEqual(consultas, ['27337174766']);
  // Sin condicion clara (o no alcanzado, que el formulario no tiene) no se sugiere ninguna.
  respuesta = { ...respuesta, condition: 'no_alcanzado', errors: ['Domicilio no resuelto'] };
  const sinCondicion = JSON.parse((await f.invoke('billing-api', { action: 'padron', taxId: '27337174766' })).body);
  assert.equal(sinCondicion.condition, '');
  assert.deepEqual(sinCondicion.errors, ['Domicilio no resuelto']);
  respuesta = null;
  assert.equal((await f.invoke('billing-api', { action: 'padron', taxId: '27337174766' })).statusCode, 404);
});
