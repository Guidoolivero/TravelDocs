#!/usr/bin/env node
// Setea custom claims (agencyId, role) desde users/{uid} en Firestore.
// Uso: GOOGLE_APPLICATION_CREDENTIALS=... node scripts/set-custom-claims.mjs [email]

import { getFirestore, getAuth } from './lib/firebase-admin.mjs';

async function main() {
  const auth = getAuth();
  const db = getFirestore();
  const emailFilter = process.argv[2]?.toLowerCase();

  const snap = await db.collection('users').get();
  if (snap.empty) {
    throw new Error('No hay documentos en users/. Ejecutá npm run migrate:seed primero.');
  }

  let updated = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const email = (data.email || '').toLowerCase();
    if (emailFilter && email !== emailFilter) continue;
    if (!data.agencyId || !data.role) {
      console.warn(`[claims] SKIP ${doc.id} — falta agencyId o role`);
      continue;
    }

    await auth.setCustomUserClaims(doc.id, {
      agencyId: data.agencyId,
      role: data.role,
    });
    console.log(`[claims] OK ${email || doc.id} → agencyId=${data.agencyId}, role=${data.role}`);
    updated++;
  }

  console.log(`\n[claims] Actualizados: ${updated}. Cerrá sesión y volvé a entrar en la app.`);
}

main().catch(err => {
  console.error('[claims] Error:', err.message || err);
  process.exit(1);
});