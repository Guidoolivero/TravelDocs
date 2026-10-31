const { createHash, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { ArcaLockTimeoutError } = require('facturas/errors');

// Reservas y tickets sin TTL. Solo los locks vencen; una reserva pendiente
// sigue bloqueando la secuencia del SDK aunque la function haya terminado.
function createBillingStore(db, { leaseMs = 120000, onLockLost = () => {} } = {}) {
  const ref = (collection, key) => db.collection(collection).doc(createHash('sha256').update(key).digest('hex'));
  return {
    async get(key) { return (await ref('billingStore', key).get()).data()?.value ?? null; },
    async set(key, value) { await ref('billingStore', key).set({ value }); },
    async add(key, value) {
      return db.runTransaction(async tx => {
        const doc = ref('billingStore', key);
        if ((await tx.get(doc)).exists) return false;
        tx.set(doc, { value });
        return true;
      });
    },
    async delete(key) { await ref('billingStore', key).delete(); },
    async withLock(key, fn, { signal = AbortSignal.timeout(25000) } = {}) {
      const doc = ref('billingLocks', key), owner = randomUUID();
      const abortError = () => new ArcaLockTimeoutError('Espera del bloqueo cancelada.', { reason: 'aborted' });
      let acquired = false;
      while (!acquired) {
        if (signal.aborted) throw abortError();
        acquired = await db.runTransaction(async tx => {
          const data = (await tx.get(doc)).data();
          if (data && data.expiresAt > Date.now()) return false;
          tx.set(doc, { owner, expiresAt: Date.now() + leaseMs });
          return true;
        });
        if (!acquired) {
          try { await delay(100, undefined, { signal }); } catch { throw abortError(); }
        }
      }
      let timer, renewing = Promise.resolve(), lost;
      const renew = () => {
        renewing = db.runTransaction(async tx => {
          const data = (await tx.get(doc)).data();
          if (data?.owner !== owner || data.expiresAt <= Date.now()) throw new Error('Bloqueo de facturacion perdido.');
          tx.set(doc, { owner, expiresAt: Date.now() + leaseMs });
        }).then(() => { timer = setTimeout(renew, Math.floor(leaseMs / 3)); }).catch(err => {
          lost = err;
          onLockLost(err);
        });
      };
      timer = setTimeout(renew, Math.floor(leaseMs / 3));
      try {
        if (signal.aborted) throw abortError();
        const result = await fn();
        if (lost) throw lost;
        return result;
      } finally {
        clearTimeout(timer);
        await renewing;
        clearTimeout(timer);
        await db.runTransaction(async tx => {
          if ((await tx.get(doc)).data()?.owner === owner) tx.delete(doc);
        });
      }
    },
  };
}
module.exports = { createBillingStore };
