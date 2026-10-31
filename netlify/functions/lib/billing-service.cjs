const { createHash } = require('node:crypto');
const { billingInvoice, billingProfileForPeriod } = require('./billing.cjs');

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean = value => JSON.parse(JSON.stringify(value));
const version = snap => snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
function createBillingService({ db, client, store, issuer, salesPoint, today, abortSignal }) {
  const invoices = db.collection('billingInvoices');
  async function get(id) {
    const doc = await invoices.doc(id).get();
    if (!doc.exists) throw Object.assign(new Error('Factura no encontrada.'), { status: 404 });
    return { id: doc.id, ...doc.data() };
  }
  async function prepare(agencyId) {
    const agencySnap = await db.collection('agencies').doc(agencyId).get();
    const recordSnap = await db.collection('billingProfiles').doc(agencyId).get();
    const agency = agencySnap.data();
    const record = recordSnap.data() || {};
    const date = today(), period = date.slice(0, 7);
    const createdAt = agency?.createdAt?.toDate?.() ?? agency?.createdAt;
    const createdOn = createdAt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(createdAt)) : '';
    const receiver = billingProfileForPeriod(record, period);
    const quotation = receiver.currency === 'USD' ? await client.wsfe.getQuotation({ currencyId: 'DOL' }) : null;
    const input = billingInvoice({ agency: agency ? { ...agency, createdOn } : null, record, period, today: date, salesPoint, quotation });
    const snapshot = { agencyId, period, input, issuer, receiver, quotation, sourceVersions: [version(agencySnap), version(recordSnap)] };
    return { ...snapshot, digest: digest(snapshot), preview: client.preview(input) };
  }
  return {
    get,
    async preview(agencyId) {
      const data = await prepare(agencyId);
      const id = digest([issuer.taxId, salesPoint, agencyId, data.period]);
      return store.withLock(`monthly:${id}`, async () => {
        const existing = (await invoices.doc(id).get()).data();
        if (existing && !['draft', 'rejected'].includes(existing.status)) return { id, ...existing };
        const attempt = (existing?.attempt || 1) + (existing?.status === 'rejected' ? 1 : 0);
        const saved = clean({ ...data, sourceDigest: data.digest, digest: digest([data.digest, attempt]), attempt, status: 'draft', idempotencyKey: `traveldocs:test:${id}:${attempt}` });
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
          const outcome = await client.recover(invoice.idempotencyKey, { abortSignal });
          await invoices.doc(id).update(clean({ status: outcome.kind, outcome }));
          if (!retry || outcome.kind !== 'indeterminate' || outcome.lookup.kind !== 'not_found') return get(id);
        }
        // shortcut: un intento incierto de otro dia requiere revision manual, no se cambia su solicitud fiscal.
        if (recoverOnly) return get(id);
        const fresh = await prepare(invoice.agencyId);
        if (approvedDigest !== invoice.digest || fresh.digest !== invoice.sourceDigest) throw Object.assign(new Error('La vista previa cambio; revisar nuevamente.'), { status: 409 });
        abortSignal?.throwIfAborted();
        await db.runTransaction(async tx => {
          const agency = await tx.get(db.collection('agencies').doc(invoice.agencyId));
          const fiscal = await tx.get(db.collection('billingProfiles').doc(invoice.agencyId));
          if (JSON.stringify([version(agency), version(fiscal)]) !== JSON.stringify(fresh.sourceVersions)) throw Object.assign(new Error('Los datos cambiaron; revisar la vista previa.'), { status: 409 });
          tx.update(invoices.doc(id), { status: 'issuing' });
        });
        const outcome = await client.issue(invoice.input, { idempotencyKey: invoice.idempotencyKey, abortSignal });
        await invoices.doc(id).update(clean({ status: outcome.kind, outcome }));
        return get(id);
      });
    },
  };
}
module.exports = { createBillingService };
