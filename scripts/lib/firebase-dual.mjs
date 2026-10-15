import { readFileSync, existsSync } from 'node:fs';
import admin from 'firebase-admin';

export const SOURCE_PROJECT_ID = 'doctravel-agencia';
export const TARGET_PROJECT_ID = 'tradingdocs-mt';

function loadCredential(inlineEnv, pathEnv) {
  const inline = process.env[inlineEnv];
  const credPath = process.env[pathEnv];

  if (inline) {
    return admin.credential.cert(JSON.parse(inline));
  }
  if (credPath && existsSync(credPath)) {
    return admin.credential.cert(JSON.parse(readFileSync(credPath, 'utf8')));
  }
  return null;
}

export function getLegacyFirestore() {
  if (!admin.apps.some(a => a.name === 'legacy')) {
    const credential = loadCredential(
      'FIREBASE_LEGACY_SERVICE_ACCOUNT',
      'GOOGLE_APPLICATION_CREDENTIALS_LEGACY'
    );
    if (!credential) {
      throw new Error(
        'Credenciales del proyecto ORIGEN (doctravel-agencia):\n' +
        '  GOOGLE_APPLICATION_CREDENTIALS_LEGACY=/ruta/doctravel-agencia.json\n' +
        '  o FIREBASE_LEGACY_SERVICE_ACCOUNT=<json>'
      );
    }
    admin.initializeApp({ credential, projectId: SOURCE_PROJECT_ID }, 'legacy');
  }
  return admin.app('legacy').firestore();
}

export function getTargetFirestore() {
  if (!admin.apps.some(a => a.name === 'target')) {
    const credential = loadCredential(
      'FIREBASE_SERVICE_ACCOUNT',
      'GOOGLE_APPLICATION_CREDENTIALS'
    );
    if (!credential) {
      throw new Error(
        'Credenciales del proyecto DESTINO (tradingdocs-mt):\n' +
        '  GOOGLE_APPLICATION_CREDENTIALS=/ruta/tradingdocs-mt.json\n' +
        '  o FIREBASE_SERVICE_ACCOUNT=<json>'
      );
    }
    admin.initializeApp({ credential, projectId: TARGET_PROJECT_ID }, 'target');
  }
  return admin.app('target').firestore();
}