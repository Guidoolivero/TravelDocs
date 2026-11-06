const { createHash } = require('node:crypto');
const { billingErrorText } = require('../../../../public/js/facturacion/billing-feedback.mjs');
const { billingInvoice, billingProfileForPeriod, validateBillingProfile } = require('./billing.cjs');

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean = value => JSON.parse(JSON.stringify(value));
const version = snap => snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
function createBillingService({ db, client, store, issuer, salesPoint, today, abortSignal, environment = 'test' }) {
  if (!['test', 'production'].includes(environment)) throw Object.assign(new Error('Ambiente de facturacion invalido.'), { status: 503 });
  const invoices = db.collection('billingInvoices');
  async function get(id) {
    const doc = await invoices.doc(id).get();
    if (!doc.exists) throw Object.assign(new Error('Factura no encontrada.'), { status: 404 });
    if ((doc.data().environment || 'test') !== environment) throw Object.assign(new Error('La factura pertenece a otro ambiente.'), { status: 409 });
    return { id: doc.id, ...doc.data() };
  }
  async function arcaOperation(id, operation) {
    try { return await operation(); } catch (err) {
      // El aviso es auxiliar: no debe ocultar el error ni cambiar el intento fiscal.
      await invoices.doc(id).update({ lastError: billingErrorText(err) }).catch(() => {});
      throw err;
    }
  }
  async function quotationBefore(date) {
    const day = new Date(`${date}T00:00:00Z`);
    // ARCA indica dias sin cotizacion con 602; el limite evita consultas indefinidas.
    for (let count = 0; count < 10; count++) {
      abortSignal?.throwIfAborted();
      day.setUTCDate(day.getUTCDate() - 1);
      try {
        return await client.wsfe.getQuotation({ currencyId: 'DOL', date: day.toISOString().slice(0, 10) });
      } catch (err) {
        if (!err.issues?.length || !err.issues.every(issue => String(issue.code) === '602')) throw err;
      }
    }
    throw Object.assign(new Error('ARCA no informo una cotizacion de USD para los dias previos. No se emitio la factura; volve a intentar mas tarde.'), { status: 503 });
  }
  async function prepare(agencyId, saleCondition, date = today()) {
    const agencySnap = await db.collection('agencies').doc(agencyId).get();
    const recordSnap = await db.collection('billingProfiles').doc(agencyId).get();
    const agency = agencySnap.data();
    const record = recordSnap.data() || {};
    const period = date.slice(0, 7);
    const createdAt = agency?.createdAt?.toDate?.() ?? agency?.createdAt;
    const createdOn = createdAt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(createdAt)) : '';
    const receiver = billingProfileForPeriod(record, period);
    if (saleCondition !== undefined) receiver.saleCondition = validateBillingProfile({ saleCondition }).saleCondition;
    const quotation = receiver.currency === 'USD' ? await quotationBefore(date) : null;
    const input = billingInvoice({ agency: agency ? { ...agency, createdOn } : null, record, period, today: date, salesPoint, quotation });
    const snapshot = { agencyId, period, input, issuer, receiver, quotation, sourceVersions: [version(agencySnap), version(recordSnap)] };
    return { ...snapshot, digest: digest(snapshot), preview: client.preview(input) };
  }
  return {
    get,
    async preview(agencyId, { saleCondition } = {}) {
      if (saleCondition !== undefined) validateBillingProfile({ saleCondition });
      const date = today();
      const obligation = [issuer.taxId, salesPoint, agencyId, date.slice(0, 7)];
      const id = digest(environment === 'test' ? obligation : [environment, ...obligation]);
      return store.withLock(`monthly:${id}`, async () => {
        const existing = (await invoices.doc(id).get()).data();
        if (existing && !['draft', 'rejected'].includes(existing.status)) return { id, ...existing };
        const data = await prepare(agencyId, saleCondition, date);
        const attempt = (existing?.attempt || 1) + (existing?.status === 'rejected' ? 1 : 0);
        const saved = clean({ ...data, environment, sourceDigest: data.digest, digest: digest([data.digest, attempt]), attempt, status: 'draft', idempotencyKey: `traveldocs:${environment}:${id}:${attempt}` });
        const batch = db.batch();
        if (existing?.status === 'rejected') batch.set(db.collection('billingAttempts').doc(`${id}-${existing.attempt}`), { ...existing, invoiceId: id });
        batch.set(invoices.doc(id), saved);
        await batch.commit();
        return { id, ...saved };
      });
    },
    async issue(id, approvedDigest, { retry = false, recoverOnly = false } = {}) {
      return store.withLock(`monthly:${id}`, async () => {
        const invoice = await get(id);
        if (invoice.issuer.taxId !== issuer.taxId || invoice.input.salesPoint !== salesPoint) throw Object.assign(new Error('Cambio el emisor o punto de venta; revisar configuracion.'), { status: 409 });
        if (['authorized', 'rejected', 'conflict'].includes(invoice.status)) return invoice;
        if (invoice.status !== 'draft') {
          const outcome = await arcaOperation(id, () => client.recover(invoice.idempotencyKey, { abortSignal }));
          await invoices.doc(id).update(clean({ status: outcome.kind, outcome, lastError: null }));
          if (!retry || outcome.kind !== 'indeterminate' || outcome.lookup.kind !== 'not_found') return get(id);
        }
        // shortcut: un intento incierto de otro dia requiere revision manual, no se cambia su solicitud fiscal.
        if (recoverOnly) return get(id);
        const fresh = await prepare(invoice.agencyId, invoice.receiver.saleCondition);
        if (approvedDigest !== invoice.digest || fresh.digest !== invoice.sourceDigest) throw Object.assign(new Error('La vista previa cambio; revisar nuevamente.'), { status: 409 });
        abortSignal?.throwIfAborted();
        await db.runTransaction(async tx => {
          const agency = await tx.get(db.collection('agencies').doc(invoice.agencyId));
          const fiscal = await tx.get(db.collection('billingProfiles').doc(invoice.agencyId));
          if (JSON.stringify([version(agency), version(fiscal)]) !== JSON.stringify(fresh.sourceVersions)) throw Object.assign(new Error('Los datos cambiaron; revisar la vista previa.'), { status: 409 });
          tx.update(invoices.doc(id), { status: 'issuing' });
        });
        const outcome = await arcaOperation(id, () => client.issue(invoice.input, { idempotencyKey: invoice.idempotencyKey, abortSignal }));
        await invoices.doc(id).update(clean({ status: outcome.kind, outcome, lastError: null }));
        return get(id);
      });
    },
  };
}
module.exports = { createBillingService };
