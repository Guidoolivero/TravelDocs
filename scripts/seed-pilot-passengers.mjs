#!/usr/bin/env node
// ============================================================
//  seed-pilot-passengers.mjs
//  Crea 5 pasajeros dummy por agencia (trading-travel + agencia-piloto)
//  para QA de aislamiento multi-tenant.
//
//  Uso:
//    GOOGLE_APPLICATION_CREDENTIALS=... node scripts/seed-pilot-passengers.mjs
//    npm run pilot:seed-passengers
// ============================================================

import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from './lib/firebase-admin.mjs';

const AGENCIES = [
  { id: 'trading-travel', prefix: 'TT', color: 'AZUL' },
  { id: 'agencia-piloto', prefix: 'AP', color: 'NARANJA' },
];

function buildPassenger(index, meta) {
  const n = String(index).padStart(3, '0');
  const year = 2026 + (index % 3);
  return {
    lastname: `PILOTO-${meta.prefix}`,
    firstname: `QA-${n}`,
    dni: `99${meta.prefix}${n}`,
    dniExp: `${year}-06-30`,
    passport: `P${meta.prefix}${n}`,
    passportExp: `${year}-09-15`,
    email: `piloto.${meta.prefix.toLowerCase()}.${n}@qa.test`,
    notes: `Pasajero dummy Fase 3 · ${meta.color} · seguro borrar`,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function seedAgency(db, agencyId, meta) {
  const col = db.collection('agencies').doc(agencyId).collection('passengers');
  let created = 0;

  for (let i = 1; i <= 5; i++) {
    const docId = `pilot-seed-${agencyId}-${String(i).padStart(2, '0')}`;
    const ref = col.doc(docId);
    const existing = await ref.get();
    if (existing.exists) {
      console.log(`[seed-pilot] SKIP ${docId} (ya existe)`);
      continue;
    }
    await ref.set(buildPassenger(i, meta));
    console.log(`[seed-pilot] OK agencies/${agencyId}/passengers/${docId}`);
    created++;
  }

  return created;
}

async function main() {
  const db = getFirestore();
  let total = 0;

  for (const meta of AGENCIES) {
    const agencySnap = await db.collection('agencies').doc(meta.id).get();
    if (!agencySnap.exists) {
      console.warn(`[seed-pilot] SKIP ${meta.id} — agencia no existe. Ejecutá create-pilot-agency o migrate:seed primero.`);
      continue;
    }
    total += await seedAgency(db, meta.id, meta);
  }

  console.log(`\n[seed-pilot] Listo. Pasajeros creados: ${total}`);
  if (total === 0) {
    console.log('[seed-pilot] Todos los dummy ya existían o faltan agencias.');
  }
}

main().catch(err => {
  console.error('[seed-pilot] Error:', err.message || err);
  process.exit(1);
});