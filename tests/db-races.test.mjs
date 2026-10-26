import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbFixture } from './db-fixture.mjs';

test('la marca del email del cliente conserva check-in, tramos nuevos y datos actuales', async () => {
  const sent = { fecha: '2026-11-02T08:00', vuelo: 'AR100', origen: 'EZE', destino: 'MAD' };
  let stored = { piernas: [{ ...sent, checkin: true, extra: 'conservar' }, { fecha: '2026-11-10T08:00' }] };
  const api = dbFixture({ getFirestore: () => ({}), doc: () => 'reservation',
    runTransaction: async (_, fn) => fn({ get: async () => ({ exists: () => true, data: () => structuredClone(stored) }),
      update: (_, patch) => { stored = { ...stored, ...patch }; } }),
  });
  await api.markReservationLegsNotified('res', [sent]);
  assert.equal(stored.piernas[0].checkin, true);
  assert.equal(stored.piernas[0].notified, true);
  assert.equal(stored.piernas[0].extra, 'conservar');
  assert.equal(stored.piernas.length, 2);
});
