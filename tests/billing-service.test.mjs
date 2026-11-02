import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { createBillingService } from '../netlify/functions/lib/billing-service.cjs';
import { createBillingStore } from '../netlify/functions/lib/billing-store.cjs';
import { billingRecord } from '../netlify/functions/lib/billing.cjs';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Solo emulador.');
const db = new Firestore({ projectId: 'demo-billing' });
after(() => db.terminate());

test('dos confirmaciones de la misma factura emiten una sola vez y conservan snapshot', async () => {
  const id = randomUUID();
  await db.collection('agencies').doc(id).set({ status: 'active', createdAt: new Date('2026-01-01T12:00:00Z') });
  const profile = { taxId: '20123456786', legalName: 'Agencia de prueba', address: 'Calle 1', condition: 'monotributo', currency: 'ARS', amount: 10000 };
  await db.collection('billingProfiles').doc(id).set(billingRecord(profile, null, '2026-09-20'));
  let calls = 0;
  const client = { preview: input => ({ voucherType: 11, request: input }), issue: async () => { calls++; return { kind: 'authorized', voucher: { cae: 'TEST' } }; } };
  const options = { db, client, store: createBillingStore(db), issuer: { legalName: 'Emisor ficticio', taxId: '20123456786' }, salesPoint: 1, today: () => '2026-11-02' };
  const a = createBillingService(options), b = createBillingService(options);
  const preview = await a.preview(id);
  const results = await Promise.all([a.issue(preview.id, preview.digest), b.issue(preview.id, preview.digest)]);
  assert.equal(calls, 1);
  assert.equal(results[0].status, 'authorized');
  assert.equal(results[1].status, 'authorized');
  const saved = await a.get(preview.id);
  assert.equal(saved.receiver.legalName, 'Agencia de prueba');
  assert.equal(saved.input.items[0].amount, 10000);
});

async function setup(client) {
  const id = randomUUID();
  const ref = db.collection('agencies').doc(id);
  await ref.set({ status: 'active', createdAt: new Date('2026-01-01T12:00:00Z') });
  await db.collection('billingProfiles').doc(id).set(billingRecord({ taxId: '20123456786', legalName: 'Prueba', address: 'Calle 1', condition: 'monotributo', currency: 'ARS', amount: 10000 }, null, '2026-09-20'));
  const service = createBillingService({ db, client: { preview: input => input, ...client }, store: createBillingStore(db), issuer: { taxId: '20123456786' }, salesPoint: 1, today: () => '2026-11-02' });
  return { service, ref, draft: await service.preview(id) };
}

test('pruebas y produccion tienen obligaciones distintas y no recuperan el otro ambiente', async () => {
  const { service: sandbox, ref, draft: testDraft } = await setup({});
  const keys = [];
  const production = createBillingService({ db, environment: 'production',
    client: { preview: input => input, issue: async (input, options) => { keys.push(options.idempotencyKey); return { kind: 'authorized' }; } },
    store: createBillingStore(db), issuer: { taxId: '20123456786' }, salesPoint: 1, today: () => '2026-11-02' });
  const realDraft = await production.preview(ref.id);
  assert.notEqual(realDraft.id, testDraft.id);
  assert.equal(realDraft.environment, 'production');
  await assert.rejects(production.get(testDraft.id), /ambiente/);
  await assert.rejects(production.issue(testDraft.id, testDraft.digest), /ambiente/);
  await assert.rejects(sandbox.get(realDraft.id), /ambiente/);
  await production.issue(realDraft.id, realDraft.digest);
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^traveldocs:production:/);
  assert.equal((await sandbox.get(testDraft.id)).status, 'draft');
});

test('importacion inicial es simulacion por defecto y aplica una sola vez sin emitir', async () => {
  const { importInitialBilling } = await import('../scripts/import-initial-billing.mjs');
  const agencyId = randomUUID();
  await db.collection('agencies').doc(agencyId).set({ status: 'active', createdAt: new Date('2026-08-01T12:00:00Z') });
  const manifest = { period: '2026-11', agencies: [{ agencyId, profile: { taxId: '20123456786', legalName: 'Ficticia', address: 'Calle 1', condition: 'monotributo', currency: 'ARS', amount: 6000000 } }] };
  const options = { today: '2026-11-02' };
  const result = await importInitialBilling(db, manifest, options);
  assert.equal(result[0].firstPeriod, '2026-11');
  assert.equal((await db.collection('billingProfiles').doc(agencyId).get()).exists, false);
  await importInitialBilling(db, manifest, { ...options, apply: true });
  const saved = (await db.collection('billingProfiles').doc(agencyId).get()).data();
  assert.equal(saved.initialPeriod, '2026-11');
  assert.equal(saved.enabledOn, '2026-11-02');
  await assert.rejects(importInitialBilling(db, manifest, { ...options, apply: true }), /ficha/);
  const invoices = await db.collection('billingInvoices').where('agencyId', '==', agencyId).get();
  assert.equal(invoices.size, 0);
  await assert.rejects(importInitialBilling(db, { ...manifest, agencies: [...manifest.agencies, ...manifest.agencies] }, options), /repetida/);
});

test('suspender despues de preview bloquea emision y preview cambiado exige confirmar otra vez', async () => {
  let calls = 0;
  const { service, ref, draft } = await setup({ issue: async () => { calls++; return { kind: 'authorized' }; } });
  await ref.update({ status: 'suspended' });
  await assert.rejects(service.issue(draft.id, draft.digest), /habilitada/);
  await ref.update({ status: 'active' });
  await assert.rejects(service.issue(draft.id, 'preview-viejo'), /vista previa/);
  assert.equal(calls, 0);
});

test('corte despues de enviar recupera antes de reemitir incluso con agencia suspendida', async () => {
  let sends = 0, recoveries = 0;
  const { service, ref, draft } = await setup({
    issue: async () => { sends++; throw new Error('Conexion cortada'); },
    recover: async () => { recoveries++; return { kind: 'authorized', voucher: { cae: 'RECUPERADO' } }; },
  });
  await assert.rejects(service.issue(draft.id, draft.digest), /Conexion cortada/);
  await ref.update({ status: 'suspended' });
  const result = await service.issue(draft.id, draft.digest);
  assert.equal(result.status, 'authorized');
  assert.equal(result.outcome.voucher.cae, 'RECUPERADO');
  assert.equal(sends, 1);
  assert.equal(recoveries, 1);
});

test('resultado indeterminado solo reenvia con reintento explicito y not_found confirmado', async () => {
  let sends = 0;
  const uncertain = { kind: 'indeterminate', lookup: { kind: 'not_found' } };
  const { service, draft } = await setup({
    issue: async () => ++sends === 1 ? uncertain : { kind: 'authorized', voucher: { cae: 'TEST' } },
    recover: async () => uncertain,
  });
  assert.equal((await service.issue(draft.id, draft.digest)).status, 'indeterminate');
  await service.issue(draft.id, draft.digest);
  assert.equal(sends, 1);
  assert.equal((await service.issue(draft.id, draft.digest, { retry: true })).status, 'authorized');
  assert.equal(sends, 2);
});

test('rechazo permite corregir ficha con una clave nueva y conserva el intento rechazado', async () => {
  const keys = [];
  const { service, ref, draft } = await setup({ issue: async (input, options) => {
    keys.push(options.idempotencyKey);
    return keys.length === 1 ? { kind: 'rejected', issues: [{ message: 'Receptor invalido' }] } : { kind: 'authorized', voucher: { cae: 'TEST' } };
  } });
  await service.issue(draft.id, draft.digest);
  await db.collection('billingProfiles').doc(ref.id).update({ 'profile.address': 'Domicilio corregido' });
  const corrected = await service.preview(ref.id);
  assert.equal(corrected.status, 'draft');
  assert.equal(corrected.receiver.address, 'Domicilio corregido');
  await service.issue(corrected.id, corrected.digest);
  assert.notEqual(keys[0], keys[1]);
  const history = await db.collection('billingAttempts').where('invoiceId', '==', draft.id).get();
  assert.equal(history.size, 1);
  assert.equal(history.docs[0].data().status, 'rejected');
  assert.equal(history.docs[0].data().receiver.address, 'Calle 1');
});

test('no emite un snapshot con otro emisor o punto de venta configurado', async () => {
  const { draft } = await setup({});
  await db.collection('billingInvoices').doc(draft.id).update({ status: 'issuing' });
  let calls = 0;
  const other = createBillingService({ db, client: { recover: async () => { calls++; return { kind: 'authorized' }; } }, store: createBillingStore(db), issuer: { taxId: '20999999990' }, salesPoint: 2, today: () => '2026-11-02' });
  await assert.rejects(other.issue(draft.id, draft.digest), /emisor|punto de venta/);
  assert.equal(calls, 0);
});

test('suspension durante consulta de cotizacion impide enviar una vista previa ya leida', async () => {
  const { ref } = await setup({});
  const fiscalRef = db.collection('billingProfiles').doc(ref.id);
  const old = (await fiscalRef.get()).data();
  await fiscalRef.set(billingRecord({ ...old.profile, currency: 'USD' }, null, '2026-09-01'));
  let quotes = 0, sends = 0;
  const client = { preview: input => input, wsfe: { getQuotation: async () => {
    if (++quotes === 2) await ref.update({ status: 'suspended' });
    return { currencyId: 'DOL', rate: 1500, date: '20261030' };
  } }, issue: async () => { sends++; return { kind: 'authorized' }; } };
  const service = createBillingService({ db, client, store: createBillingStore(db), issuer: { taxId: '20123456786' }, salesPoint: 1, today: () => '2026-11-02' });
  const draft = await service.preview(ref.id);
  await assert.rejects(service.issue(draft.id, draft.digest), /cambio|cambiaron/);
  assert.equal(sends, 0);
});

test('fallo al guardar CAE conserva intento y recupera sin segunda emision', async () => {
  const { draft } = await setup({});
  let fail = true, sends = 0;
  const flakyDb = { batch: () => db.batch(), runTransaction: callback => db.runTransaction(callback), collection(name) {
    const collection = db.collection(name);
    if (name !== 'billingInvoices') return collection;
    const doc = collection.doc.bind(collection);
    collection.doc = id => {
      const ref = doc(id), update = ref.update.bind(ref);
      ref.update = patch => {
        if (fail && patch.status === 'authorized') { fail = false; throw new Error('Persistencia interrumpida'); }
        return update(patch);
      };
      return ref;
    };
    return collection;
  } };
  const outcome = { kind: 'authorized', voucher: { cae: 'RECUPERADO' } };
  const service = createBillingService({ db: flakyDb, client: { preview: input => input, issue: async () => { sends++; return outcome; }, recover: async () => outcome }, store: createBillingStore(db), issuer: { taxId: '20123456786' }, salesPoint: 1, today: () => '2026-11-02' });
  await assert.rejects(service.issue(draft.id, draft.digest), /Persistencia interrumpida/);
  assert.equal((await service.issue(draft.id, draft.digest)).status, 'authorized');
  assert.equal(sends, 1);
});

test('blocked, failed y superseded nunca permiten reenvio automatico', async () => {
  for (const kind of ['blocked', 'failed', 'superseded', 'aborted', 'incomplete']) {
    let sends = 0;
    const outcome = { kind: 'indeterminate', lookup: { kind } };
    const { service, draft } = await setup({ issue: async () => { sends++; return outcome; }, recover: async () => outcome });
    await service.issue(draft.id, draft.digest);
    await service.issue(draft.id, draft.digest, { retry: true });
    assert.equal(sends, 1, kind);
  }
});

test('consultar estado nunca emite un borrador aunque tenga digest valido', async () => {
  let sends = 0;
  const { service, draft } = await setup({ issue: async () => { sends++; return { kind: 'authorized' }; } });
  const result = await service.issue(draft.id, draft.digest, { recoverOnly: true });
  assert.equal(result.status, 'draft');
  assert.equal(sends, 0);
});

test('confirmacion vieja no autoriza un intento nuevo despues de un rechazo', async () => {
  let sends = 0;
  const { service, ref, draft } = await setup({ issue: async () => { sends++; return { kind: 'rejected', issues: [] }; } });
  await service.issue(draft.id, draft.digest);
  const next = await service.preview(ref.id);
  assert.equal(next.status, 'draft');
  await assert.rejects(service.issue(next.id, draft.digest), /vista previa/);
  assert.equal(sends, 1);
});

test('condicion de venta se congela por factura y override no cambia ficha de agencia', async () => {
  const { service, ref } = await setup({ issue: async () => ({ kind: 'authorized' }) });
  const original = await service.preview(ref.id);
  assert.equal(original.receiver.saleCondition, 'Transferencia bancaria');
  const changed = await service.preview(ref.id, { saleCondition: 'Cuenta corriente' });
  assert.equal(changed.receiver.saleCondition, 'Cuenta corriente');
  assert.equal(changed.input.concept, 'services');
  assert.notEqual(original.digest, changed.digest);
  await assert.rejects(service.issue(changed.id, original.digest), /vista previa/);
  assert.equal((await service.issue(changed.id, changed.digest)).receiver.saleCondition, 'Cuenta corriente');
  assert.equal((await db.collection('billingProfiles').doc(ref.id).get()).data().profile.saleCondition, undefined);
  await assert.rejects(service.preview(ref.id, { saleCondition: 'Inventada' }), /venta/);
});

test('error de ARCA deja aviso persistido sin secretos y recuperar lo limpia sin reemitir', async () => {
  let sends = 0;
  const { service, draft } = await setup({
    issue: async () => { sends++; throw Object.assign(new Error('TOKEN=privado'), { code: 'ARCA_TRANSPORT_ERROR' }); },
    recover: async () => ({ kind: 'authorized', voucher: { cae: 'RECUPERADO' } }),
  });
  await assert.rejects(service.issue(draft.id, draft.digest));
  const saved = await service.get(draft.id);
  assert.equal(saved.status, 'issuing');
  assert.match(saved.lastError, /Consultar ARCA/);
  assert.doesNotMatch(saved.lastError, /privado|TOKEN/);
  const recovered = await service.issue(draft.id, draft.digest, { recoverOnly: true });
  assert.equal(recovered.status, 'authorized');
  assert.equal(recovered.lastError, null);
  assert.equal(sends, 1);
});

test('preview de factura ya enviada devuelve su estado sin volver a pedir cotizacion', async () => {
  let quotes = 0, unavailable = false;
  const { service, ref } = await setup({
    wsfe: { getQuotation: async () => {
      quotes++;
      if (unavailable) throw new Error('ARCA sin conexion');
      return { currencyId: 'DOL', rate: 1500, date: '20261030' };
    } },
    issue: async () => ({ kind: 'authorized' }),
  });
  const fiscal = db.collection('billingProfiles').doc(ref.id);
  const record = (await fiscal.get()).data();
  await fiscal.set(billingRecord({ ...record.profile, currency: 'USD' }, null, '2026-09-20'));
  const draft = await service.preview(ref.id);
  await service.issue(draft.id, draft.digest);
  const before = quotes;
  unavailable = true;
  for (const state of ['authorized', 'issuing', 'indeterminate', 'conflict']) {
    await db.collection('billingInvoices').doc(draft.id).update({ status: state });
    const existing = await service.preview(ref.id);
    assert.equal(existing.id, draft.id);
    assert.equal(existing.status, state);
  }
  assert.equal(quotes, before);
});
