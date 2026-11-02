import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../netlify/functions/lib/billing-config.cjs';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const testEnv = { BILLING_ENABLED: 'true', ARCA_ENVIRONMENT: 'test', BILLING_FIREBASE_PROJECT_ID: 'demo-billing', FIREBASE_SERVICE_ACCOUNT: '{"project_id":"demo-billing"}', FIRESTORE_EMULATOR_HOST: 'localhost:8185' };
const production = { BILLING_ENABLED: 'true', ARCA_ENVIRONMENT: 'production', BILLING_FIREBASE_PROJECT_ID: 'tradingdocs-mt', FIREBASE_SERVICE_ACCOUNT: '{"project_id":"tradingdocs-mt"}', CONTEXT: 'production', ARCA_TAX_ID: '20123456786', ARCA_SALES_POINT: '2', BILLING_PRODUCTION_CONFIRMATION: '20123456786:2' };

test('produccion exige proyecto real, contexto de produccion y confirmacion del emisor y punto', () => {
  assert.equal(config.assertBillingEnvironment(production), 'production');
  for (const patch of [
    { BILLING_ENABLED: 'false' }, { CONTEXT: 'deploy-preview' }, { CONTEXT: undefined },
    { FIRESTORE_EMULATOR_HOST: 'localhost:8185' }, { ARCA_ENVIRONMENT: 'prod' },
    { BILLING_PRODUCTION_CONFIRMATION: undefined }, { ARCA_SALES_POINT: '3' }, { ARCA_TAX_ID: '20999999990' },
    { FIREBASE_SERVICE_ACCOUNT: '{"project_id":"demo-billing"}', BILLING_FIREBASE_PROJECT_ID: 'demo-billing' },
  ]) assert.throws(() => config.assertBillingEnvironment({ ...production, ...patch }), undefined, JSON.stringify(patch));
});

test('homologacion sigue aislada de Firebase real y demo requiere emulador', () => {
  assert.equal(config.assertBillingEnvironment(testEnv), 'test');
  for (const patch of [{ FIRESTORE_EMULATOR_HOST: undefined }, { BILLING_ENABLED: 'false' },
    { FIREBASE_SERVICE_ACCOUNT: '{"project_id":"tradingdocs-mt"}', BILLING_FIREBASE_PROJECT_ID: 'tradingdocs-mt' },
    { BILLING_FIREBASE_PROJECT_ID: 'otro' }, { FIREBASE_SERVICE_ACCOUNT: 'no-json' },
  ]) assert.throws(() => config.assertBillingEnvironment({ ...testEnv, ...patch }));
});

test('paquete usa contexto de build y preview no hereda habilitacion de produccion', async () => {
  for (const context of ['production', 'deploy-preview']) {
    const result = await build({ entryPoints: ['netlify/functions/lib/billing-config.cjs'], bundle: true, platform: 'node', format: 'cjs', write: false, define: { BILLING_BUILD_CONTEXT: JSON.stringify(context) } });
    const module = { exports: {} };
    runInNewContext(result.outputFiles[0].text, { module, exports: module.exports });
    if (context === 'production') assert.equal(module.exports.assertBillingEnvironment({ ...production, CONTEXT: undefined }), 'production');
    else assert.throws(() => module.exports.assertBillingEnvironment(production));
  }
});
