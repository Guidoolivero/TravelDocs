#!/usr/bin/env node
// ============================================================
//  enable-totp-mfa.mjs
//  Habilita TOTP MFA (Google Authenticator) a nivel de proyecto
//  Firebase. Se corre UNA sola vez. No hay botón en la consola:
//  se hace vía Admin SDK (projectConfigManager).
//
//  Uso:
//    GOOGLE_APPLICATION_CREDENTIALS=./keys/tradingdocs-mt.json \
//      node scripts/enable-totp-mfa.mjs
// ============================================================

import { getAuth } from './lib/firebase-admin.mjs';

async function main() {
  const auth = getAuth();
  console.log('Habilitando TOTP MFA en el proyecto tradingdocs-mt...');
  await auth.projectConfigManager().updateProjectConfig({
    multiFactorConfig: {
      providerConfigs: [{
        state: 'ENABLED',
        totpProviderConfig: { adjacentIntervals: 5 }
      }]
    }
  });
  console.log('OK: TOTP MFA habilitado. Los usuarios ya pueden enrolar Google Authenticator.');
}

main().catch(err => {
  console.error('Error habilitando TOTP MFA:', err?.message || err);
  process.exit(1);
});
