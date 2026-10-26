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

test('una importacion parcial informa solo los IDs de los bloques confirmados', async () => {
  let nextId = 0, commits = 0;
  const persisted = [];
  const api = dbFixture({ getFirestore: () => ({}), collection: () => 'passengers', doc: () => ({ id: String(++nextId) }),
    writeBatch: () => {
      const pending = [];
      return { set: (ref, data) => pending.push([ref.id, data]), commit: async () => {
        if (++commits === 2) throw new Error('Firestore unavailable');
        persisted.push(...pending);
      } };
    },
  });
  await assert.rejects(api.addPassengersBatch(Array.from({ length: 901 }, (_, i) => ({ lastname: `TEST${i}` }))), error => {
    assert.equal(error.savedIds?.length, 450);
    assert.equal(persisted.length, 450);
    return true;
  });
});
