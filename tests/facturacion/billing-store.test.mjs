import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { createBillingStore } from '../../netlify/functions/lib/facturacion/billing-store.cjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Ejecutar con test:billing:emulator; nunca usar una base real.');
const db = new Firestore({ projectId: 'demo-billing' });
after(() => db.terminate());

test('add atomico conserva el primer intento y persiste entre instancias', async () => {
  const a = createBillingStore(db), b = createBillingStore(db);
  const key = randomUUID();
  const results = await Promise.all([a.add(key, 'primero'), b.add(key, 'segundo')]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await b.get(key), results[0] ? 'primero' : 'segundo');
  await b.set(key, 'actualizado');
  assert.equal(await a.get(key), 'actualizado');
});

test('dos procesos serializan el mismo lock y lo liberan aun al lanzar', async () => {
  const key = randomUUID(), a = createBillingStore(db), b = createBillingStore(db);
  let inside = 0, max = 0;
  await Promise.all([a, b].map(store => store.withLock(key, async () => {
    inside++; max = Math.max(max, inside);
    await new Promise(resolve => setTimeout(resolve, 40));
    inside--;
  })));
  assert.equal(max, 1);
  await assert.rejects(a.withLock(key, () => { throw new Error('fallo'); }));
  assert.equal(await b.withLock(key, async () => 'libre'), 'libre');
});

test('abortar la espera no ejecuta la operacion protegida', async () => {
  const key = randomUUID(), store = createBillingStore(db);
  await store.withLock(key, async () => {
    let ran = false;
    await assert.rejects(store.withLock(key, async () => { ran = true; }, { signal: AbortSignal.timeout(30) }), { code: 'ARCA_LOCK_TIMEOUT', reason: 'aborted' });
    assert.equal(ran, false);
  });
});

test('renueva el bloqueo durante una operacion larga', async () => {
  const key = randomUUID();
  const a = createBillingStore(db, { leaseMs: 600 }), b = createBillingStore(db, { leaseMs: 600 });
  let finish;
  const started = new Promise(resolve => { finish = resolve; });
  let running = false;
  const first = a.withLock(key, async () => {
    running = true;
    finish();
    await new Promise(resolve => setTimeout(resolve, 1500));
    running = false;
  });
  await started;
  await b.withLock(key, async () => assert.equal(running, false));
  await first;
});

test('recupera lease vencido y perder propietario cancela sin borrar el nuevo lock', async () => {
  const { createHash } = await import('node:crypto');
  const key = randomUUID();
  const ref = db.collection('billingLocks').doc(createHash('sha256').update(key).digest('hex'));
  await ref.set({ owner: 'anterior', expiresAt: Date.now() - 1 });
  let notify;
  const lost = new Promise(resolve => { notify = resolve; });
  const store = createBillingStore(db, { leaseMs: 600, onLockLost: notify });
  await assert.rejects(store.withLock(key, async () => {
    await ref.set({ owner: 'nuevo', expiresAt: Date.now() + 10000 });
    await lost;
  }), /Bloqueo de facturacion perdido/);
  assert.equal((await ref.get()).data().owner, 'nuevo');
});
