import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './firebase-fixture.mjs';

test('el reporte atribuye cada escaneo al proveedor registrado y aplica su tarifa', async () => {
  const f = fixture({ env: { COST_PER_SCAN_GEMINI: '1', COST_PER_SCAN_CLAUDE: '10' } });
  await f.recordUsage({ agencyId: 'agency', kind: 'scans', source: 'claude' });
  await f.recordUsage({ agencyId: 'agency', kind: 'scans', source: 'gemini' });
  const response = await f.request('/usage', undefined, 'GET', { range: 'historical' });
  assert.equal(response.statusCode, 200);
  const { totals } = JSON.parse(response.body);
  assert.equal(totals.scans, 2);
  assert.equal(totals.claudeCount, 1);
  assert.equal(totals.estimatedCostUsd, 11);
});

test('el reporte conserva los contadores historicos con punto literal junto con los nuevos', async () => {
  const f = fixture({ env: { COST_PER_SCAN_GEMINI: '1', COST_PER_SCAN_CLAUDE: '10' } });
  f.docs.set('agencies/agency/usage/2020-01-01', { scans: 2, 'bySource.claude': 2 });
  await f.recordUsage({ agencyId: 'agency', kind: 'scans', source: 'claude' });
  await f.recordUsage({ agencyId: 'agency', kind: 'scans', source: 'gemini' });
  const response = await f.request('/usage', undefined, 'GET', { range: 'historical' });
  const { totals } = JSON.parse(response.body);
  assert.equal(totals.scans, 4);
  assert.equal(totals.claudeCount, 3);
  assert.equal(totals.estimatedCostUsd, 31);
});
