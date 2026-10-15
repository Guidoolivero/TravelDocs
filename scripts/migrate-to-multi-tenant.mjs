#!/usr/bin/env node
// ============================================================
//  migrate-to-multi-tenant.mjs
//  Copia /passengers y /notifications → /agencies/trading-travel/*
//
//  Uso:
//    node scripts/migrate-to-multi-tenant.mjs --dry-run
//    node scripts/migrate-to-multi-tenant.mjs
//    node scripts/migrate-to-multi-tenant.mjs --delete-legacy
// ============================================================

import { getFirestore } from './lib/firebase-admin.mjs';

const AGENCY_ID = 'trading-travel';
const BATCH_SIZE = 400;

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    deleteLegacy: argv.includes('--delete-legacy'),
  };
}

async function copyCollection(db, sourcePath, targetPath, dryRun) {
  const snap = await db.collection(sourcePath).get();
  if (snap.empty) {
    console.log(`[migrate] ${sourcePath}: vacío, nada que copiar.`);
    return { copied: 0, skipped: 0 };
  }

  let copied = 0;
  let skipped = 0;
  let batch = db.batch();
  let ops = 0;

  for (const docSnap of snap.docs) {
    const targetRef = db.collection(targetPath).doc(docSnap.id);
    const existing = await targetRef.get();

    if (existing.exists) {
      skipped++;
      continue;
    }

    if (!dryRun) {
      batch.set(targetRef, docSnap.data());
      ops++;
      if (ops >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    copied++;
  }

  if (!dryRun && ops > 0) {
    await batch.commit();
  }

  console.log(`[migrate] ${sourcePath} → ${targetPath}: ${copied} copiados, ${skipped} ya existían${dryRun ? ' (dry-run)' : ''}.`);
  return { copied, skipped };
}

async function deleteCollection(db, collectionPath, dryRun) {
  const snap = await db.collection(collectionPath).get();
  if (snap.empty) {
    console.log(`[migrate] ${collectionPath}: ya vacío.`);
    return 0;
  }

  if (dryRun) {
    console.log(`[migrate] ${collectionPath}: se eliminarían ${snap.size} docs (dry-run).`);
    return snap.size;
  }

  let deleted = 0;
  let batch = db.batch();
  let ops = 0;

  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
    ops++;
    deleted++;
    if (ops >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  console.log(`[migrate] ${collectionPath}: ${deleted} docs eliminados.`);
  return deleted;
}

async function main() {
  const { dryRun, deleteLegacy } = parseArgs(process.argv.slice(2));
  const db = getFirestore();

  const agencyRef = db.collection('agencies').doc(AGENCY_ID);
  const agencySnap = await agencyRef.get();
  if (!agencySnap.exists) {
    throw new Error(`No existe agencies/${AGENCY_ID}. Ejecutá primero: npm run migrate:seed`);
  }

  if (dryRun) console.log('[migrate] Modo dry-run — no se escribirá en Firestore.\n');

  await copyCollection(db, 'passengers', `agencies/${AGENCY_ID}/passengers`, dryRun);
  await copyCollection(db, 'notifications', `agencies/${AGENCY_ID}/notifications`, dryRun);

  if (deleteLegacy) {
    if (dryRun) {
      await deleteCollection(db, 'passengers', true);
      await deleteCollection(db, 'notifications', true);
    } else {
      console.log('\n[migrate] Eliminando colecciones legacy...');
      await deleteCollection(db, 'passengers', false);
      await deleteCollection(db, 'notifications', false);
    }
  } else {
    console.log('\n[migrate] Legacy intacto. Cuando valides el cutover, re-ejecutá con --delete-legacy');
  }

  console.log('\n[migrate] Completado.');
}

main().catch(err => {
  console.error('[migrate] Error:', err.message || err);
  process.exit(1);
});