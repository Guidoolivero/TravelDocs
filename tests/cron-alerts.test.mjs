import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

// El email se pausa en el borde externo para intercalar una edicion real del documento.
function fixture(edit) {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const leg = { fecha: '2026-11-02T08:00', vuelo: 'AR100', origen: 'EZE', destino: 'MAD', checkin: false, notified: false };
  const docs = new Map([
    ['agencies/test', { status: 'active', alerts: { email: 'test@example.invalid', emailjsPublicKey: 'dummy', emailjsServiceId: 'dummy', emailjsTemplateId: 'dummy' } }],
    ['agencies/test/reservations/res', { fecha: leg.fecha, compania: 'AR', piernas: [leg], reqs30Notified: true }],
  ]);
  const mails = [];
  const snapshot = (path, ref) => ({ id: path.split('/').at(-1), ref, exists: docs.has(path), data: () => structuredClone(docs.get(path)) });
  function ref(path) {
    const r = { collection: name => ref(`${path}/${name}`), doc: id => ref(`${path}/${id}`), where: () => r,
      async get() {
        if (path.split('/').length % 2 === 0) return snapshot(path, r);
        const children = [...docs.keys()].filter(k => k.startsWith(path + '/') && k.split('/').length === path.split('/').length + 1).map(k => {
          const data = structuredClone(docs.get(k));
          return { ...snapshot(k, ref(k)), data: () => structuredClone(data) };
        });
        return { docs: children, size: children.length, forEach: fn => children.forEach(fn) };
      },
      async update(patch) { docs.set(path, { ...docs.get(path), ...structuredClone(patch) }); },
    };
    return r;
  }
  const db = { collection: name => ref(name), async runTransaction(fn) { return fn({ get: r => r.get(), update: (r, patch) => r.update(patch) }); } };
  const url = new URL('../netlify/functions/lib/alertas/send-alerts.cjs', import.meta.url);
  const nativeRequire = createRequire(url);
  const module = { exports: {} };
  class Clock extends Date { static now() { return now; } }
  runInNewContext(readFileSync(url, 'utf8'), {
    module, exports: module.exports, console, Date: Clock, AbortSignal,
    process: { env: { EMAILJS_PRIVATE_KEY: 'dummy' } }, setTimeout: fn => { fn(); },
    fetch: async (_, options) => { mails.push(JSON.parse(options.body)); edit(docs.get('agencies/test/reservations/res')); return { ok: true }; },
    require: id => id === 'firebase-admin' ? { apps: [{}], firestore: () => db }
      : id === 'firebase-admin/firestore' ? { FieldValue: { serverTimestamp: () => 1 }, FieldPath: { documentId: () => '__name__' } }
      : id.endsWith('/_sentry.cjs') ? { wrapHandler: fn => fn } : nativeRequire(id),
  });
  return { docs, mails, run: () => module.exports.handler({}) };
}

test('el cron conserva un check-in guardado mientras se envia el email', async () => {
  const f = fixture(r => { r.piernas[0].checkin = true; });
  assert.equal(JSON.parse((await f.run()).body).ok, true);
  const leg = f.docs.get('agencies/test/reservations/res').piernas[0];
  assert.equal(leg.checkin, true);
  assert.equal(leg.notified, true);
});

test('el cron conserva una fecha editada y los tramos agregados sin marcar el vuelo nuevo', async () => {
  const f = fixture(r => {
    r.fecha = r.piernas[0].fecha = '2026-11-05T08:00';
    r.piernas.push({ fecha: '2026-11-10T08:00', vuelo: 'AR101', checkin: false });
  });
  await f.run();
  const r = f.docs.get('agencies/test/reservations/res');
  assert.equal(r.fecha, '2026-11-05T08:00');
  assert.equal(r.piernas[0].fecha, r.fecha);
  assert.equal(r.piernas[0].notified, false);
  assert.equal(r.piernas.length, 2);
});


test('cron envia salida local y check-in ART conservando los metadatos', async () => {
  const f = fixture(() => {});
  const r = f.docs.get('agencies/test/reservations/res');
  r.fecha = r.piernas[0].fecha = '2026-11-02T03:59';
  Object.assign(r.piernas[0], { origen:'DEN', destino:'MIA', fechaLocal:'2026-11-01T23:59', zonaHoraria:'America/Denver' });
  await f.run();
  assert.equal(f.mails.length,1);
  const html = f.mails[0].template_params.message;
  assert.match(html,/01 nov.*23:59/);
  assert.match(html,/01 nov.*03:59/);
  assert.match(html,/Horario argentino para hacer el check-in/);
  assert.equal(r.piernas[0].fechaLocal,'2026-11-01T23:59');
  assert.equal(f.docs.get('agencies/test/reservations/res').piernas[0].zonaHoraria,'America/Denver');
});
