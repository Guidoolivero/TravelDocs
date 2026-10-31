const admin = require('firebase-admin');
const { requirePlatformAdmin, initAdmin } = require('./_platform-admin.cjs');
const { assertBillingSandbox } = require('./lib/billing-config.cjs');
const { buildVoucherDocument } = require('facturas');
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
exports.handler = async event => {
  const auth = await requirePlatformAdmin(event);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  try {
    assertBillingSandbox();
    if (event.httpMethod !== 'POST') return reply(405, { error: 'Usar POST.' });
    let input;
    try { input = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'JSON invalido.' }); }
    if (!/^[a-f0-9]{64}$/.test(input?.invoiceId || '')) return reply(400, { error: 'Factura invalida.' });
    initAdmin();
    const snap = await admin.firestore().collection('billingInvoices').doc(input.invoiceId).get();
    if (!snap.exists) return reply(404, { error: 'Factura no encontrada.' });
    const invoice = snap.data();
    if (invoice.status !== 'authorized') return reply(409, { error: 'La factura todavia no esta autorizada.' });
    const doc = buildVoucherDocument({ voucher: invoice.outcome.voucher, items: invoice.input.items,
      issuer: invoice.issuer, receiver: { name: invoice.receiver.legalName, address: invoice.receiver.address },
      observations: invoice.outcome.authorization?.observations || [], saleConditions: 'Transferencia bancaria' });
    const { renderVoucherPdf } = require('@facturas/pdf');
    const pdf = await renderVoucherPdf(doc, { notes: 'HOMOLOGACION - SIN VALOR FISCAL' });
    return reply(200, { pdf: Buffer.from(pdf).toString('base64'), filename: `prueba-factura-C-${doc.number}.pdf` });
  } catch (err) {
    return reply(err.status === 503 ? 503 : 500, { error: err.status === 503 ? err.message : 'No se pudo generar el PDF. La factura guardada se conserva; no volver a emitir.' });
  }
};
