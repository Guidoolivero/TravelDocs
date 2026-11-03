const admin = require('firebase-admin');
const { requirePlatformAdmin, initAdmin } = require('./_platform-admin.cjs');
const { assertBillingEnvironment } = require('./lib/billing-config.cjs');
const { buildVoucherDocument } = require('facturas');
const { auditBilling } = require('./lib/billing-audit.cjs');
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
exports.handler = async event => {
  const auth = await requirePlatformAdmin(event);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  try {
    const environment = assertBillingEnvironment();
    if (event.httpMethod !== 'POST') return reply(405, { error: 'Usar POST.' });
    let input;
    try { input = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'JSON invalido.' }); }
    if (!/^[a-f0-9]{64}$/.test(input?.invoiceId || '')) return reply(400, { error: 'Factura invalida.' });
    initAdmin();
    const snap = await admin.firestore().collection('billingInvoices').doc(input.invoiceId).get();
    if (!snap.exists) return reply(404, { error: 'Factura no encontrada.' });
    const invoice = snap.data();
    if ((invoice.environment || 'test') !== environment) return reply(409, { error: 'La factura pertenece a otro ambiente.' });
    const preview = input.preview === true;
    if (preview ? invoice.status !== 'draft' || !/^[a-f0-9]{64}$/.test(input.digest || '') || input.digest !== invoice.digest : invoice.status !== 'authorized') {
      return reply(409, { error: preview ? 'La vista previa cambio. Volve a abrirla antes de emitir.' : 'La factura todavia no esta autorizada.' });
    }
    const { renderTravelDocsPdf, buildDraftDocument } = require('./lib/invoice-pdf.cjs');
    const doc = preview ? buildDraftDocument(invoice) : buildVoucherDocument({ voucher: invoice.outcome.voucher, items: invoice.input.items,
      issuer: { ...invoice.issuer, tradeName: 'TravelDocs' }, receiver: { name: invoice.receiver.legalName, address: invoice.receiver.address },
      observations: invoice.outcome.authorization?.observations || [], saleConditions: invoice.receiver.saleCondition || 'Transferencia bancaria' });
    const pdf = await renderTravelDocsPdf(doc, { period: invoice.period, draft: preview, notice: preview ? 'BORRADOR - SIN VALOR FISCAL' : environment === 'test' ? 'HOMOLOGACION - SIN VALOR FISCAL' : '' });
    await auditBilling(admin.firestore(), auth, 'billing-pdf', { ...invoice, id: snap.id });
    return reply(200, { pdf: Buffer.from(pdf).toString('base64'), preview, filename: preview ? `borrador-factura-C-${invoice.period}.pdf` : `${environment === 'test' ? 'prueba-' : ''}factura-C-${doc.number}.pdf` });
  } catch (err) {
    return reply(err.status === 503 ? 503 : 500, { error: err.status === 503 ? err.message : 'No se pudo generar el PDF. La factura guardada se conserva; no volver a emitir.' });
  }
};
exports.handler = require('./_sentry.cjs').wrapHandler(exports.handler);
