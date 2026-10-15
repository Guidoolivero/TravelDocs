#!/usr/bin/env node
// Exporta los mails de los pasajeros a un txt (una linea por mail, sin repetir):
//   Apellido, Nombre - email
// Uso:
//   GOOGLE_APPLICATION_CREDENTIALS=~/Documents/keys/tradingdocs-mt.json \
//     node scripts/export-passenger-emails.mjs [salida.txt] [agencyId]
// Sin agencyId exporta de todas las agencias (dedup global por mail).

import { writeFileSync } from 'node:fs';
import { getFirestore } from './lib/firebase-admin.mjs';

async function main() {
  const db = getFirestore();
  const outFile = process.argv[2] || 'emails-pasajeros.txt';
  const agencyFilter = process.argv[3] || null;

  const agencies = await db.collection('agencies').get();
  const seen = new Map(); // email normalizado -> linea
  let total = 0;

  for (const ag of agencies.docs) {
    if (agencyFilter && ag.id !== agencyFilter) continue;
    const snap = await db.collection('agencies').doc(ag.id).collection('passengers').get();
    let conEmail = 0;
    for (const doc of snap.docs) {
      const p = doc.data() || {};
      total++;
      const email = String(p.email || '').trim();
      if (!email) continue;
      conEmail++;
      const key = email.toLowerCase();
      if (seen.has(key)) continue; // mail repetido: queda el primero
      seen.set(key, `${(p.lastname || '').trim()}, ${(p.firstname || '').trim()} - ${email}`);
    }
    console.log(`${ag.id}: ${snap.size} pasajeros, ${conEmail} con mail`);
  }

  const lineas = [...seen.values()].sort((a, b) => a.localeCompare(b, 'es'));
  writeFileSync(outFile, lineas.join('\n') + '\n');
  console.log(`\n${lineas.length} mails unicos -> ${outFile} (${total} pasajeros en total)`);
}

main().catch(err => { console.error(err); process.exit(1); });
