import { readFileSync, existsSync } from 'node:fs';
import admin from 'firebase-admin';

const PROJECT_ID = 'tradingdocs-mt';

export function initAdmin() {
  if (admin.apps.length) return admin;

  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  let credential;
  if (inline) {
    credential = admin.credential.cert(JSON.parse(inline));
  } else if (credPath && existsSync(credPath)) {
    credential = admin.credential.cert(JSON.parse(readFileSync(credPath, 'utf8')));
  } else {
    throw new Error(
      'Configurá credenciales Admin SDK:\n' +
      '  FIREBASE_SERVICE_ACCOUNT=<json>  o  GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json'
    );
  }

  admin.initializeApp({ credential, projectId: PROJECT_ID });
  return admin;
}

export function getFirestore() {
  return initAdmin().firestore();
}

export function getAuth() {
  return initAdmin().auth();
}