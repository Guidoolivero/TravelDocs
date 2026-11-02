const admin = require('firebase-admin');
const { requirePlatformAdmin, initAdmin } = require('./_platform-admin.cjs');
const { assertBillingEnvironment } = require('./lib/billing-config.cjs');
const { createBillingStore } = require('./lib/billing-store.cjs');
const { createBillingService } = require('./lib/billing-service.cjs');
const { createArcaClient } = require('facturas');
const { billingErrorText } = require('../../public/js/billing-feedback.mjs');

const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
exports.handler = async event => {
  const auth = await requirePlatformAdmin(event);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  try {
    const environment = assertBillingEnvironment();
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
      return reply(200, { environment, invoices: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(invoice => (invoice.environment || 'test') === environment) });
    }
    const salesPoint = Number(process.env.ARCA_SALES_POINT);
    let issuer;
    try { issuer = JSON.parse(process.env.BILLING_ISSUER_JSON || '{}'); } catch {}
    if (!issuer || !['legalName', 'address', 'grossIncome', 'activitiesStartDate'].every(key => typeof issuer[key] === 'string' && issuer[key].trim()) || !/^\d{11}$/.test(process.env.ARCA_TAX_ID || '') || !Number.isInteger(salesPoint) || salesPoint < 1 || salesPoint > 99998) {
      return reply(503, { error: 'Falta configurar el emisor y las credenciales de ARCA.' });
    }
    issuer = { legalName: issuer.legalName, address: issuer.address, grossIncome: issuer.grossIncome, activitiesStartDate: issuer.activitiesStartDate, taxId: process.env.ARCA_TAX_ID, condition: 'monotributo' };
    // La clave y certificado exceden junto al service account el limite de env de Lambda.
    const credentials = environment === 'production' ? (await db.collection('billingSecrets').doc('production').get()).data()
      : { certificatePem: process.env.ARCA_CERTIFICATE_PEM, privateKeyPem: process.env.ARCA_PRIVATE_KEY_PEM };
    if (!credentials?.certificatePem || !credentials.privateKeyPem ||
        (environment === 'production' && (credentials.taxId !== issuer.taxId || credentials.salesPoint !== salesPoint))) {
      return reply(503, { error: 'Falta configurar las credenciales de ARCA para el emisor y punto de venta.' });
    }
    const controller = new AbortController();
    const abortSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]);
    const store = createBillingStore(db, { onLockLost: err => controller.abort(err) });
    const client = createArcaClient({ taxId: issuer.taxId, certificatePem: credentials.certificatePem, privateKeyPem: credentials.privateKeyPem, environment, store, timeout: 15000, retries: 0, logger: { disabled: true } });
    const service = createBillingService({ db, client, store, issuer, salesPoint, abortSignal, environment,
      today: () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()) });
    const result = body.action === 'preview' ? await service.preview(body.agencyId, { saleCondition: body.saleCondition })
      : body.action === 'get' ? await service.get(body.invoiceId)
      : await service.issue(body.invoiceId, body.digest, { retry: body.action === 'retry', recoverOnly: body.action === 'recover' });
    return reply(200, result);
  } catch (err) {
    if (!err?.status) console.error('billing-api', { code: err?.code || 'BILLING_ERROR', name: err?.name });
    const status = [400, 404, 409, 503].includes(err?.status) ? err.status : 503;
    return reply(status, { error: billingErrorText(err) });
  }
};
