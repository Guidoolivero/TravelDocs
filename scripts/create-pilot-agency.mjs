#!/usr/bin/env node
// ============================================================
//  create-pilot-agency.mjs
//  Crea agencies/agencia-piloto con branding/alerts de prueba
//  y vincula un usuario piloto (debe existir en Firebase Auth).
//
//  Uso:
//    GOOGLE_APPLICATION_CREDENTIALS=... node scripts/create-pilot-agency.mjs <email>
//    npm run pilot:create -- piloto@tuagencia.com
// ============================================================

import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore, getAuth } from './lib/firebase-admin.mjs';
import { findUidByEmail, linkUserToAgency } from './lib/seed-helpers.mjs';

const AGENCY_ID = 'agencia-piloto';

const AGENCY_DOC = {
  name: 'Agencia Piloto QA',
  slug: AGENCY_ID,
  status: 'active',
  plan: 'trial',
  branding: {
    appName: 'PilotoDocs',
    logoUrl: '',
    primaryColor: '#c45c26',
  },
  alerts: {
    email: 'piloto.qa@tradingtravel.com.ar',
    emailjsPublicKey: '9hDeLGPwhgAkqc7HZ',
    emailjsServiceId: 'service_g7h8qrd',
    emailjsTemplateId: 'template_jwdgrsr',
  },
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
  trialEndsAt: null,
};

function parseArgs(argv) {
  const email = argv.find(a => a.includes('@'));
  const alertsIdx = argv.indexOf('--alerts-email');
  const alertsEmail = alertsIdx >= 0 ? argv[alertsIdx + 1] : null;
  return { email: email?.toLowerCase() || null, alertsEmail: alertsEmail?.toLowerCase() || null };
}

async function main() {
  const { email, alertsEmail } = parseArgs(process.argv.slice(2));

  if (!email) {
    console.error('Uso: node scripts/create-pilot-agency.mjs <email-piloto> [--alerts-email destino@ejemplo.com]');
    console.error('El usuario debe existir en Firebase Auth (Console → Authentication → Add user).');
    process.exit(1);
  }

  const db = getFirestore();
  const auth = getAuth();
  const now = FieldValue.serverTimestamp();

  const doc = { ...AGENCY_DOC };
  if (alertsEmail) {
    doc.alerts = { ...doc.alerts, email: alertsEmail };
  }

  console.log(`[pilot] Creando/actualizando agencies/${AGENCY_ID}...`);
  await db.collection('agencies').doc(AGENCY_ID).set(doc, { merge: true });

  const uid = await findUidByEmail(auth, email);
  if (!uid) {
    console.error(`[pilot] ERROR: ${email} no existe en Firebase Auth.`);
    console.error('[pilot] Creá el usuario en Console → Authentication → Add user, y re-ejecutá.');
    process.exit(1);
  }

  await linkUserToAgency({
    db,
    auth,
    uid,
    agencyId: AGENCY_ID,
    member: { email, role: 'admin', displayName: 'Piloto QA' },
    now,
  });

  console.log(`[pilot] OK users/${uid} + members/${uid} + claims (${email}, admin)`);
  console.log(`[pilot] Agencia: ${AGENCY_ID}`);
  console.log(`[pilot] Branding: ${doc.branding.appName} · color ${doc.branding.primaryColor}`);
  console.log(`[pilot] Alertas → ${doc.alerts.email}`);
  console.log('\n[pilot] Próximo paso: npm run pilot:seed-passengers');
  console.log('[pilot] El usuario piloto debe cerrar sesión y volver a entrar para refrescar claims.');
}

main().catch(err => {
  console.error('[pilot] Error:', err.message || err);
  process.exit(1);
});