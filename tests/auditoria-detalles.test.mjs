import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('reporte de uso: agencia sin escaneos muestra 0% de Claude, no null', () => {
  const { aggRow } = require('../netlify/functions/lib/administracion/admin-api.cjs');
  const row = aggRow('a', 'A', { scans: 0, travel: 5, claudeCount: 0 }, {});
  assert.equal(row.claudePct, 0);
});

test('cumpleanos descartado en diciembre sigue descartado el 1/1', async () => {
  const guardadas = new Set();
  globalThis.localStorage = { getItem: k => guardadas.has(k) ? '1' : null, setItem: k => guardadas.add(k) };
  const { estado } = await import('../public/js/compartido/estado.mjs');
  const { getAlertItems, setDismissed } = await import('../public/js/alertas/modelo.mjs');
  estado.passengers = [{ id: 'p1', lastname: 'PEREZ', firstname: 'ANA', dob: '1990-01-05' }];
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 11, 20, 12) });
  try {
    const cumple = getAlertItems().find(i => i.isBirthday);
    setDismissed(cumple.dismissKey);
    mock.timers.setTime(new Date(2027, 0, 1, 12).getTime());
    assert.equal(getAlertItems().some(i => i.isBirthday), false);
  } finally { mock.timers.reset(); }
});

test('version de un pasajero: detecta que otro agente lo guardo mientras se editaba', async () => {
  const { versionDe } = await import('../public/js/compartido/utils.js');
  const ts = ms => ({ toMillis: () => ms });
  assert.equal(versionDe({ updatedAt: ts(5) }), versionDe({ updatedAt: ts(5) }));
  assert.notEqual(versionDe({ updatedAt: ts(5) }), versionDe({ updatedAt: ts(9) }));
  assert.equal(versionDe({}), null);
});
