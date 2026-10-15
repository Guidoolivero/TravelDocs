#!/usr/bin/env node
// ============================================================
//  set-platform-admins.mjs
//  Setea el claim `platformAdmin: true` (con merge, preservando
//  agencyId/role existentes) para uno o más emails.
//
//  Fuentes de emails (en orden):
//    1) CLI:  node scripts/set-platform-admins.mjs guido@... otro@...
//    2) Env:  PLATFORM_SUPER_ADMIN_EMAILS=guido@...,otro@...
//
//  El email debe existir en Firebase Auth y tener users/{uid} con
//  agencyId + role (sino se avisa y se saltea).
//
//  Uso:
//    GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json \
//      npm run admin:set-platform-admins -- guido@tradingtravel.com.ar
//
//  Después: el usuario debe cerrar sesión y volver a entrar para
//  refrescar el JWT con el nuevo claim.
// ============================================================

import { getAuth, getFirestore } from './lib/firebase-admin.mjs';

async function main() {
  const auth = getAuth();
  const db = getFirestore();

  const fromCli = process.argv.slice(2).filter(a => a.includes('@')).map(e => e.toLowerCase());
  const fromEnv = (process.env.PLATFORM_SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const emails = [...new Set([...fromCli, ...fromEnv])];

  if (!emails.length) {
    console.error('No hay emails. Pasalos por CLI o por PLATFORM_SUPER_ADMIN_EMAILS.');
    console.error('  npm run admin:set-platform-admins -- guido@tradingtravel.com.ar');
    process.exit(1);
  }

  console.log(`[platform-admin] Procesando ${emails.length} email(s): ${emails.join(', ')}\n`);

  let ok = 0;
  for (const email of emails) {
    let user;
    try {
      user = await auth.getUserByEmail(email);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.warn(`[platform-admin] SKIP ${email} — no existe en Firebase Auth. Crealo en Console primero.`);
        continue;
      }
      throw err;
    }

    // Validar que tenga agencyId/role en users/{uid}.
    const userDoc = await db.collection('users').doc(user.uid).get();
    const data = userDoc.data() || {};
    if (!data.agencyId || !data.role) {
      console.warn(`[platform-admin] SKIP ${email} — users/${user.uid} sin agencyId/role. Ejecutá el seed de su agencia primero.`);
      continue;
    }

    const existing = user.customClaims || {};
    await auth.setCustomUserClaims(user.uid, {
      ...existing,
      agencyId: data.agencyId,
      role: data.role,
      platformAdmin: true,
    });

    console.log(`[platform-admin] OK ${email} → platformAdmin:true (agencyId=${data.agencyId}, role=${data.role})`);
    ok++;
  }

  console.log(`\n[platform-admin] Actualizados: ${ok}.`);
  console.log('[platform-admin] Cada usuario debe cerrar sesión y volver a entrar para refrescar el JWT.');
  console.log('[platform-admin] Configurá también en Netlify: PLATFORM_SUPER_ADMIN_EMAILS=' + emails.join(','));
}

main().catch(err => {
  console.error('[platform-admin] Error:', err.message || err);
  process.exit(1);
});
