const admin = require('firebase-admin');
const { requirePlatformAdmin, initAdmin } = require('./_platform-admin.cjs');
const { assertBillingSandbox } = require('./lib/billing-config.cjs');
const { createBillingStore } = require('./lib/billing-store.cjs');
const { createBillingService } = require('./lib/billing-service.cjs');
const { createArcaClient } = require('facturas');

const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
exports.handler = async event => {
  const auth = await requirePlatformAdmin(event);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  try {
    assertBillingSandbox();
    if (event.httpMethod !== 'POST') return reply(405, { error: 'Usar POST.' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'JSON invalido.' }); }
    if (!body || !['preview', 'issue', 'recover', 'retry', 'get', 'list'].includes(body.action)) return reply(400, { error: 'Accion invalida.' });
    if (body.action === 'preview' && !/^[a-z0-9-]{3,40}$/.test(body.agencyId || '')) return reply(400, { error: 'Agencia invalida.' });
    if (['issue', 'recover', 'retry', 'get'].includes(body.action) && !/^[a-f0-9]{64}$/.test(body.invoiceId || '')) return reply(400, { error: 'Factura invalida.' });
    initAdmin();
    const db = admin.firestore();
    if (body.action === 'list') {
      const snap = await db.collection('billingInvoices').orderBy('period', 'desc').limit(100).get();
      return reply(200, { invoices: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    }
    const salesPoint = Number(process.env.ARCA_SALES_POINT);
    let issuer;
    try { issuer = JSON.parse(process.env.BILLING_ISSUER_JSON || '{}'); } catch {}
    if (!issuer || !['legalName', 'address', 'grossIncome', 'activitiesStartDate'].every(key => typeof issuer[key] === 'string' && issuer[key].trim()) || !/^\d{11}$/.test(process.env.ARCA_TAX_ID || '') || !Number.isInteger(salesPoint) || salesPoint < 1 || salesPoint > 99998 || !process.env.ARCA_CERTIFICATE_PEM || !process.env.ARCA_PRIVATE_KEY_PEM) {
      return reply(503, { error: 'Falta configurar el emisor y las credenciales de homologacion.' });
    }
    issuer = { legalName: issuer.legalName, address: issuer.address, grossIncome: issuer.grossIncome, activitiesStartDate: issuer.activitiesStartDate, taxId: process.env.ARCA_TAX_ID, condition: 'monotributo' };
    const controller = new AbortController();
    const abortSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]);
    const store = createBillingStore(db, { onLockLost: err => controller.abort(err) });
    const client = createArcaClient({ taxId: issuer.taxId, certificatePem: process.env.ARCA_CERTIFICATE_PEM, privateKeyPem: process.env.ARCA_PRIVATE_KEY_PEM, environment: 'test', store, timeout: 15000, retries: 0, logger: { disabled: true } });
    const service = createBillingService({ db, client, store, issuer, salesPoint, abortSignal,
      today: () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()) });
    const result = body.action === 'preview' ? await service.preview(body.agencyId)
      : body.action === 'get' ? await service.get(body.invoiceId)
      : await service.issue(body.invoiceId, body.digest, { retry: body.action === 'retry', recoverOnly: body.action === 'recover' });
    return reply(200, result);
  } catch (err) {
    if (!err.status) console.error('billing-api', { code: err.code || 'BILLING_ERROR', name: err.name });
    const status = [400, 404, 409, 503].includes(err.status) ? err.status : 503;
    return reply(status, { error: err.status ? err.message : 'No se pudo completar la operacion. Consultar el estado antes de reintentar.' });
  }
};
