import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialBillingRecord } from '../../netlify/functions/lib/facturacion/billing.cjs';

// Lee y valida todo antes de escribir. No importa historial ni emite comprobantes.
export async function importInitialBilling(db, manifest, { today, apply = false }) {
  if (!Array.isArray(manifest?.agencies) || !manifest.agencies.length) throw new Error('Faltan agencias para incorporar.');
  const seen = new Set();
  for (const entry of manifest.agencies) {
    if (!/^[a-z0-9-]{3,40}$/.test(entry?.agencyId || '')) throw new Error('Agencia invalida.');
    if (seen.has(entry.agencyId)) throw new Error('Agencia repetida.');
    seen.add(entry.agencyId);
  }
  return db.runTransaction(async tx => {
    const pending = [];
    for (const entry of manifest.agencies) {
      const agency = await tx.get(db.collection('agencies').doc(entry.agencyId));
      const ref = db.collection('billingProfiles').doc(entry.agencyId);
      if ((await tx.get(ref)).exists) throw new Error('Ya existe una ficha fiscal; revisar sin sobrescribirla.');
      const invoices = await tx.get(db.collection('billingInvoices').where('agencyId', '==', entry.agencyId).limit(1));
      if (!invoices.empty) throw new Error('La agencia ya tiene comprobantes; revisar el corte inicial.');
      const data = agency.data();
      const createdAt = data?.createdAt?.toDate?.() ?? data?.createdAt;
      const createdOn = createdAt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(createdAt)) : '';
      const record = initialBillingRecord(entry.profile, data ? { ...data, createdOn } : null, manifest.period, today);
      pending.push({ ref, record, agencyId: entry.agencyId });
    }
    if (apply) for (const { ref, record } of pending) tx.create(ref, record);
    return pending.map(({ agencyId, record }) => ({ agencyId, firstPeriod: record.initialPeriod, amount: record.profile.amount, currency: record.profile.currency }));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let db;
  try {
    const [file, flag] = process.argv.slice(2);
    if (!file || (flag && flag !== '--apply') || process.argv.length > 4) throw new Error('Uso: node scripts/facturacion/import-initial-billing.mjs archivo-privado.json [--apply]');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    const { getFirestore } = await import('../lib/firebase-admin.mjs');
    db = getFirestore();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
    const rows = await importInitialBilling(db, manifest, { today, apply: flag === '--apply' });
    console.log(JSON.stringify({ applied: flag === '--apply', rows }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally { await db?.terminate(); }
}
