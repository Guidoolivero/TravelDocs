#!/usr/bin/env node
// ============================================================
//  import-from-legacy.mjs
//  Copia SOLO LECTURA desde doctravel-agencia → tradingdocs-mt
//
//  Origen (intacto, no se modifica):
//    /passengers/{id}
//    /notifications/{key}
//
//  Destino:
//    /agencies/trading-travel/passengers/{id}
//    /agencies/trading-travel/notifications/{key}
//
//  Uso:
//    export GOOGLE_APPLICATION_CREDENTIALS_LEGACY="$HOME/Documents/keys/doctravel-agencia.json"
//    export GOOGLE_APPLICATION_CREDENTIALS="$HOME/Documents/keys/tradingdocs-mt.json"
//    npm run import:legacy:dry-run
//    npm run import:legacy
// ============================================================

import { getLegacyFirestore, getTargetFirestore, SOURCE_PROJECT_ID, TARGET_PROJECT_ID } from './lib/firebase-dual.mjs';

const AGENCY_ID = 'trading-travel';
const BATCH_SIZE = 400;

const COLLECTIONS = [
  {
    label: 'passengers',
    sourcePath: 'passengers',
    targetPath: `agencies/${AGENCY_ID}/passengers`,
  },
  {
    label: 'notifications',
    sourcePath: 'notifications',
    targetPath: `agencies/${AGENCY_ID}/notifications`,
  },
];

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    forceUpdate: argv.includes('--force-update'),
  };
}

async function copyCollection(sourceDb, targetDb, { label, sourcePath, targetPath }, options) {
  const { dryRun, forceUpdate } = options;

  console.log(`\n[import] ${label}: leyendo ${SOURCE_PROJECT_ID}/${sourcePath} (solo lectura)...`);
  const snap = await sourceDb.collection(sourcePath).get();

  if (snap.empty) {
    console.log(`[import] ${label}: origen vacío, nada que copiar.`);
    return { copied: 0, skipped: 0, total: 0 };
  }

  console.log(`[import] ${label}: ${snap.size} documentos en origen.`);

  let existingIds = new Set();
  if (!forceUpdate) {
    console.log(`[import] ${label}: cargando IDs existentes en destino...`);
    const targetSnap = await targetDb.collection(targetPath).get();
    existingIds = new Set(targetSnap.docs.map(d => d.id));
    console.log(`[import] ${label}: ${existingIds.size} ya existen en destino (se omiten).`);
  }

  let copied = 0;
  let skipped = 0;
  let batch = targetDb.batch();
  let ops = 0;
  const started = Date.now();

  for (const docSnap of snap.docs) {
    if (!forceUpdate && existingIds.has(docSnap.id)) {
      skipped++;
      continue;
    }

    if (!dryRun) {
      const targetRef = targetDb.doc(`${targetPath}/${docSnap.id}`);
      batch.set(targetRef, docSnap.data(), { merge: forceUpdate });
      ops++;
      copied++;

      if (ops >= BATCH_SIZE) {
        await batch.commit();
        const sec = ((Date.now() - started) / 1000).toFixed(0);
        console.log(`[import] ${label}: ${copied} copiados (${sec}s)...`);
        batch = targetDb.batch();
        ops = 0;
      }
    } else {
      copied++;
    }
  }

  if (!dryRun && ops > 0) {
    await batch.commit();
  }

  const suffix = dryRun ? ' (dry-run)' : '';
  console.log(
    `[import] ${label}: ${copied} copiados, ${skipped} omitidos (ya existían)${suffix}.`
  );

  return { copied, skipped, total: snap.size };
}

async function main() {
  const { dryRun, forceUpdate } = parseArgs(process.argv.slice(2));

  console.log('[import] ═══════════════════════════════════════════════');
  console.log('[import]  COPIA cross-project — el origen NO se modifica');
  console.log(`[import]  Origen:  ${SOURCE_PROJECT_ID} (solo lectura)`);
  console.log(`[import]  Destino: ${TARGET_PROJECT_ID} → agencies/${AGENCY_ID}/`);
  if (dryRun) console.log('[import]  Modo: DRY-RUN (no escribe en destino)');
  if (forceUpdate) console.log('[import]  Modo: force-update (sobrescribe existentes en destino)');
  console.log('[import] ═══════════════════════════════════════════════');

  const sourceDb = getLegacyFirestore();
  const targetDb = getTargetFirestore();

  const agencySnap = await targetDb.collection('agencies').doc(AGENCY_ID).get();
  if (!agencySnap.exists) {
    throw new Error(
      `No existe agencies/${AGENCY_ID} en ${TARGET_PROJECT_ID}. Ejecutá: npm run migrate:seed`
    );
  }

  const totals = { copied: 0, skipped: 0, source: 0 };

  for (const spec of COLLECTIONS) {
    const result = await copyCollection(sourceDb, targetDb, spec, { dryRun, forceUpdate });
    totals.copied += result.copied;
    totals.skipped += result.skipped;
    totals.source += result.total;
  }

  console.log('\n[import] ─── Resumen ───');
  console.log(`[import] Documentos en origen:  ${totals.source}`);
  console.log(`[import] Copiados al destino:   ${totals.copied}${dryRun ? ' (simulado)' : ''}`);
  console.log(`[import] Omitidos (ya existían): ${totals.skipped}`);
  console.log(`[import] Origen ${SOURCE_PROJECT_ID}: SIN CAMBIOS (solo lectura).`);

  if (dryRun) {
    console.log('\n[import] Dry-run OK. Para copiar de verdad: npm run import:legacy');
  } else {
    console.log('\n[import] Verificá en Firebase Console → tradingdocs-mt → agencies/trading-travel/passengers');
  }
}

main().catch(err => {
  console.error('[import] Error:', err.message || err);
  process.exit(1);
});