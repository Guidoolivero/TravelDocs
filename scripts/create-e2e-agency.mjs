#!/usr/bin/env node
// Crea agencies/agencia-e2e y un usuario con TOTP para los tests e2e.
// No toca trading-travel. La agencia no tiene claves de EmailJS, asi que
// un check-in de prueba no manda mail.
//
//   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' node scripts/create-e2e-agency.mjs
//
// Escribe E2E_USER_EMAIL, E2E_USER_PASSWORD y E2E_TOTP_SECRET en .env (gitignored).

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth, getFirestore } from './lib/firebase-admin.mjs';
import { findUidByEmail, linkUserToAgency } from './lib/seed-helpers.mjs';
import { totp } from '../tests/e2e-totp.mjs';

const AGENCY_ID = 'agencia-e2e';
const EMAIL = 'e2e.qa@traveldocs.test';
const API_KEY = 'AIzaSyBBqUsxjkLx2RMNQ7ivIINX0kAznlICyHc';

function upsertEnv(key, value) {
  const path = '.env';
  const text = readFileSync(path, 'utf8');
  const line = `${key}="${String(value).replace(/"/g, '')}"`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  const next = re.test(text)
    ? text.replace(re, line)
    : `${text.replace(/\s*$/, '')}\n${line}\n`;
  writeFileSync(path, next);
}

function safeBody(text) {
  return text.replace(/sharedSecretKey"\s*:\s*"[^"]*/g, 'sharedSecretKey":"***').slice(0, 240);
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url.split('?')[0].split('/').pop()} ${res.status} ${safeBody(text)}`);
  return JSON.parse(text);
}

async function idTokenFor(password) {
  const data = await post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { email: EMAIL, password, returnSecureToken: true },
  );
  return data.idToken;
}

async function enrollTotp(password) {
  const idToken = await idTokenFor(password);
  const started = await post(
    `https://identitytoolkit.googleapis.com/v2/accounts/mfaEnrollment:start?key=${API_KEY}`,
    { idToken, displayName: 'E2E', totpEnrollmentInfo: {} },
  );
  const info = started.totpSessionInfo || {};
  const secret = info.sharedSecretKey;
  if (!secret || !info.sessionInfo) throw new Error('Firebase no devolvio el secreto TOTP.');

  let finalized = false;
  for (const delta of [0, -30_000, 30_000]) {
    try {
      await post(
        `https://identitytoolkit.googleapis.com/v2/accounts/mfaEnrollment:finalize?key=${API_KEY}`,
        {
          idToken,
          displayName: 'E2E',
          totpVerificationInfo: {
            sessionInfo: info.sessionInfo,
            verificationCode: totp(secret, Date.now() + delta),
          },
        },
      );
      finalized = true;
      break;
    } catch (err) {
      if (!String(err.message).includes('INVALID_CODE')) throw err;
    }
  }
  if (!finalized) throw new Error('No se pudo confirmar el codigo TOTP.');
  return secret;
}

async function main() {
  process.loadEnvFile('.env');
  const auth = getAuth();
  const db = getFirestore();
  const now = FieldValue.serverTimestamp();

  await db.collection('agencies').doc(AGENCY_ID).set({
    name: 'Agencia E2E',
    slug: AGENCY_ID,
    status: 'active',
    plan: 'trial',
    branding: { appName: 'E2E Docs', logoUrl: '', primaryColor: '#2563eb' },
    // Sin claves de EmailJS: el check-in de prueba no dispara un mail.
    alerts: { email: '', emailjsPublicKey: '', emailjsServiceId: '', emailjsTemplateId: '' },
    createdAt: now,
    updatedAt: now,
    trialEndsAt: null,
  }, { merge: true });

  let uid = await findUidByEmail(auth, EMAIL);
  let password = process.env.E2E_USER_PASSWORD || '';
  if (!uid) {
    password = randomBytes(18).toString('base64url');
    const created = await auth.createUser({ email: EMAIL, password, emailVerified: true });
    uid = created.uid;
    console.log('[e2e] usuario creado');
  } else if (!password) {
    const factors = (await auth.getUser(uid)).multiFactor?.enrolledFactors || [];
    if (factors.length) {
      throw new Error('El usuario ya tiene 2FA y .env no tiene E2E_USER_PASSWORD. No reseteo la clave.');
    }
    password = randomBytes(18).toString('base64url');
    await auth.updateUser(uid, { password });
    console.log('[e2e] clave nueva: el alta anterior no llego a guardarla');
  } else {
    console.log('[e2e] usuario ya existia');
  }

  await linkUserToAgency({
    db,
    auth,
    uid,
    agencyId: AGENCY_ID,
    member: { email: EMAIL, role: 'admin', displayName: 'E2E QA' },
    now,
  });

  await auth.updateUser(uid, { displayName: 'E2E QA', emailVerified: true });
  upsertEnv('E2E_USER_EMAIL', EMAIL);
  upsertEnv('E2E_USER_PASSWORD', password);

  const record = await auth.getUser(uid);
  const enrolled = record.multiFactor?.enrolledFactors || [];
  let secret = process.env.E2E_TOTP_SECRET || '';
  if (!enrolled.length) {
    secret = await enrollTotp(password);
    console.log('[e2e] TOTP enrolado');
  } else if (!secret) {
    throw new Error('El usuario ya tiene 2FA y .env no tiene E2E_TOTP_SECRET. No puedo leer el secreto de nuevo.');
  } else {
    console.log('[e2e] TOTP ya estaba enrolado');
  }

  const claims = (await auth.getUser(uid)).customClaims || {};
  await auth.setCustomUserClaims(uid, { ...claims, agencyId: AGENCY_ID, role: 'admin', mfaEnrolled: true });

  upsertEnv('E2E_TOTP_SECRET', secret);
  console.log(`[e2e] OK agencies/${AGENCY_ID} (${EMAIL}). Claves en .env, sin imprimir.`);
}

main().catch(err => {
  console.error('[e2e]', err.message || err);
  process.exit(1);
});
