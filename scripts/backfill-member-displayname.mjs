#!/usr/bin/env node
// ============================================================
//  backfill-member-displayname.mjs
//  Backfill one-time: copia displayName desde users/{uid} a
//  agencies/{agencyId}/members/{uid} para los miembros existentes
//  que no lo tengan (los creados antes de la v1.1 del helper).
//
//  Uso:
//    GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json \
//      npm run admin:backfill-displayname
//
//  Idempotente: solo escribe si members/{uid} no tiene displayName
//  y users/{uid} sí.
// ============================================================

import { getFirestore } from './lib/firebase-admin.mjs';

async function main() {
  const db = getFirestore();

  const agenciesSnap = await db.collection('agencies').get();
  let updated = 0;
  let skipped = 0;

  for (const agency of agenciesSnap.docs) {
    const membersSnap = await db.collection('agencies').doc(agency.id).collection('members').get();
    for (const mDoc of membersSnap.docs) {
      const m = mDoc.data() || {};
      if (m.displayName) { skipped++; continue; }

      const userDoc = await db.collection('users').doc(mDoc.id).get();
      const u = userDoc.data() || {};
      if (!u.displayName) { skipped++; continue; }

      await mDoc.ref.set({ displayName: u.displayName }, { merge: true });
      console.log(`[backfill] ${agency.id}/members/${mDoc.id} ← "${u.displayName}"`);
      updated++;
    }
  }

  console.log(`\n[backfill] Listo. Actualizados: ${updated}. Sin cambios: ${skipped}.`);
}

main().catch(err => {
  console.error('[backfill] Error:', err.message || err);
  process.exit(1);
});
