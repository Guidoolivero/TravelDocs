#!/usr/bin/env node
// ============================================================
//  seed-trading-travel.mjs
//  Crea agencia trading-travel, users/{uid} y members/{uid}
//  Uso: FIREBASE_SERVICE_ACCOUNT='...' node scripts/seed-trading-travel.mjs
// ============================================================

import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore, getAuth } from './lib/firebase-admin.mjs';
import { findUidByEmail, linkUserToAgency } from './lib/seed-helpers.mjs';

const AGENCY_ID = 'trading-travel';

const TEAM = [
  { email: 'guillermo@tradingtravel.com.ar', role: 'owner', displayName: 'Guillermo' },
  { email: 'guido@tradingtravel.com.ar', role: 'admin', displayName: 'Guido' },
  { email: 'mariela_dede@tradingtravel.com.ar', role: 'agent', displayName: 'Mariela' },
];

const AGENCY_DOC = {
  name: 'Trading Travel',
  slug: AGENCY_ID,
  status: 'active',
  plan: 'pro',
  branding: {
    appName: 'TravelDocs',
    logoUrl: '',
    primaryColor: '#1a4fd6',
  },
  alerts: {
    email: 'contacto@tradingtravel.com.ar',
    emailjsPublicKey: '9hDeLGPwhgAkqc7HZ',
    emailjsServiceId: 'service_g7h8qrd',
    emailjsTemplateId: 'template_jwdgrsr',
  },
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
  trialEndsAt: null,
};

async function main() {
  const db = getFirestore();
  const auth = getAuth();
  const now = FieldValue.serverTimestamp();

  console.log(`[seed] Creando/actualizando agencies/${AGENCY_ID}...`);
  await db.collection('agencies').doc(AGENCY_ID).set(AGENCY_DOC, { merge: true });

  let created = 0;
  let skipped = 0;

  for (const member of TEAM) {
    const email = member.email.toLowerCase();
    const uid = await findUidByEmail(auth, email);

    if (!uid) {
      console.warn(`[seed] SKIP ${email} — no existe en Firebase Auth. Creá el usuario en Console primero.`);
      skipped++;
      continue;
    }

    await linkUserToAgency({
      db,
      auth,
      uid,
      agencyId: AGENCY_ID,
      member,
      now,
    });

    console.log(`[seed] OK users/${uid} + members/${uid} + claims (${email}, ${member.role})`);
    created++;
  }

  console.log(`\n[seed] Listo. Usuarios vinculados: ${created}, omitidos: ${skipped}`);
  if (skipped > 0) {
    console.log('[seed] Los omitidos deben crearse en Firebase Auth → Users → Add user, y re-ejecutar este script.');
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('[seed] Error:', err.message || err);
  process.exit(1);
});