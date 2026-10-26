import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { markNotifiedLegs } from '../public/js/alert-core.mjs';

export function dbFixture(sdk) {
  const source = readFileSync(new URL('../public/js/db.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\n/gm, '').replace(/\bexport /g, '');
  const context = { ...sdk, markNotifiedLegs, storeAgencyId() {}, serverTimestamp: () => 1, console };
  runInNewContext(source + '\nthis.api = { initDB, setTenantContext, addPassengersBatch, markReservationLegsNotified };', context);
  context.api.initDB({});
  context.api.setTenantContext('test');
  return context.api;
}
