#!/usr/bin/env node
// ============================================================
//  set-email-verified.mjs
//  Firebase exige email verificado antes de enrolar un 2FA TOTP.
//  Las cuentas se crean vía Admin SDK (sin verificación por mail),
//  así que este script marca emailVerified=true en todos los
//  usuarios de Auth. Se corre una sola vez (back-fill).
//
//  Opcional: pasar emails por CLI para marcar solo algunos.
//    GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json \
//      node scripts/set-email-verified.mjs guido@... otro@...
// ============================================================

import { getAuth } from './lib/firebase-admin.mjs';

async function main() {
  const auth = getAuth();
  const filter = process.argv.slice(2).filter(a => a.includes('@')).map(e => e.toLowerCase());

  let updated = 0, skipped = 0, failed = 0;

  const processUser = async (u) => {
    if (filter.length && !filter.includes((u.email || '').toLowerCase())) { skipped++; return; }
    if (u.emailVerified) { skipped++; return; }
    try {
      await auth.updateUser(u.uid, { emailVerified: true });
      updated++;
      console.log(`OK ${u.email || u.uid}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${u.email || u.uid}: ${err?.message || err}`);
    }
  };

  if (filter.length) {
    for (const email of filter) {
      try {
        const u = await auth.getUserByEmail(email);
        await processUser(u);
      } catch (err) {
        failed++;
        console.error(`No se encontró ${email}: ${err?.message || err}`);
      }
    }
  } else {
    await auth.listUsers(1000).then(async (result) => {
      for (const u of result.users) await processUser(u);
      // paginado simple por si hay más de 1000
      let pageToken = result.pageToken;
      while (pageToken) {
        const next = await auth.listUsers(1000, pageToken);
        for (const u of next.users) await processUser(u);
        pageToken = next.pageToken;
      }
    });
  }

  console.log(`\nResumen: ${updated} actualizados, ${skipped} salteados (ya verificados o fuera del filtro), ${failed} fallidos.`);
}

main().catch(err => {
  console.error('Error:', err?.message || err);
  process.exit(1);
});
