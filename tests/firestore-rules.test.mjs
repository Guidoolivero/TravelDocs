import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'doctravel-rules-test';
const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const HAS_EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const AGENCY_A = 'trading-travel';
const AGENCY_B = 'agencia-piloto';
const UID_A = 'user-a-uid';
const UID_B = 'user-b-uid';

let testEnv;

if (!HAS_EMULATOR) {
  describe('Firestore rules — aislamiento multi-tenant', () => {
    it('requiere emulador (npm run test:rules:emulator)', { skip: 'Firestore emulator no configurado' }, () => {});
  });
} else {
  before(async () => {
    const [host, portStr] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: RULES,
        host,
        port: Number(portStr),
      },
    });

    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();

      await db.collection('users').doc(UID_A).set({
        agencyId: AGENCY_A,
        email: 'a@test.com',
        role: 'agent',
        active: true,
      });
      await db.collection('users').doc(UID_B).set({
        agencyId: AGENCY_B,
        email: 'b@test.com',
        role: 'agent',
        active: true,
      });

      await db.collection('agencies').doc(AGENCY_A).set({ name: 'A', slug: AGENCY_A });
      await db.collection('agencies').doc(AGENCY_B).set({ name: 'B', slug: AGENCY_B });

      await db.collection('agencies').doc(AGENCY_A).collection('passengers').doc('p1').set({
        lastname: 'GARCIA',
        firstname: 'JUAN',
      });
      await db.collection('agencies').doc(AGENCY_B).collection('passengers').doc('p2').set({
        lastname: 'LOPEZ',
        firstname: 'ANA',
      });

      await db.collection('agencies').doc(AGENCY_A).collection('reservations').doc('r1').set({
        pnr: 'ABC123', compania: 'AR', fecha: '2026-08-01T13:00',
      });
      await db.collection('agencies').doc(AGENCY_B).collection('reservations').doc('r2').set({
        pnr: 'XYZ999', compania: 'LA', fecha: '2026-08-01T13:00',
      });
    });
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  function authAs(uid, agencyId, role) {
    return testEnv.authenticatedContext(uid, { agencyId, role });
  }

  describe('Firestore rules — aislamiento multi-tenant', () => {
    it('usuario desactivado no lee ni escribe con claims antiguos de cualquier rol', async () => {
      await testEnv.withSecurityRulesDisabled(c => c.firestore().doc('users/disabled').set({ active: false }));
      for (const role of ['agent', 'admin', 'owner']) {
        const db = authAs('disabled', AGENCY_A, role).firestore();
        await assertFails(db.collection(`agencies/${AGENCY_A}/passengers`).get());
        await assertFails(db.doc(`agencies/${AGENCY_A}/passengers/p1`).get());
        await assertFails(db.doc(`agencies/${AGENCY_A}/passengers/new`).set({ firstname: 'TEST' }));
        await assertFails(db.doc(`agencies/${AGENCY_A}/settings/gdsCities`).set({ cities: [] }));
        await assertFails(db.doc(`agencies/${AGENCY_A}`).update({ name: 'blocked' }));
      }
    });

    it('perfil inexistente no accede con claims antiguos', async () => {
      const db = authAs('missing', AGENCY_A, 'owner').firestore();
      await assertFails(db.collection(`agencies/${AGENCY_A}/passengers`).get());
    });

    it('onSnapshot activo funciona y no entrega cambios tras desactivar el perfil', { timeout: 15000 }, async () => {
      await testEnv.withSecurityRulesDisabled(c => c.firestore().doc('users/listener').set({ active: true }));
      const db = authAs('listener', AGENCY_A, 'agent').firestore();
      let unsubscribe;
      let ready;
      const firstSnapshot = new Promise(resolve => { ready = resolve; });
      const denied = new Promise(resolve => {
        unsubscribe = db.collection(`agencies/${AGENCY_A}/passengers`).onSnapshot(ready, resolve);
      });
      try {
        await firstSnapshot;
        await testEnv.withSecurityRulesDisabled(c => c.firestore().doc('users/listener').update({ active: false }));
        // Disparar una entrega: el emulador reevalua el listener al cambiar sus datos.
        await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`agencies/${AGENCY_A}/passengers/p1`).update({ firstname: 'UPDATED' }));
        assert.equal((await denied).code, 'permission-denied');
      } finally {
        unsubscribe();
      }
    });

    it('agencia suspendida bloquea todos los roles y no puede reactivarse desde el cliente', async () => {
      const agencyId = 'suspended-agency';
      await testEnv.withSecurityRulesDisabled(async c => {
        await c.firestore().doc(`agencies/${agencyId}`).set({ status: 'suspended' });
        await c.firestore().doc('users/suspended-member').set({ active: true });
      });
      for (const role of ['owner', 'admin', 'agent']) {
        const db = authAs('suspended-member', agencyId, role).firestore();
        await assertFails(db.doc(`agencies/${agencyId}`).get());
        await assertFails(db.doc(`agencies/${agencyId}`).update({ status: 'active' }));
        for (const collection of ['passengers', 'reservations', 'notifications', 'members', 'invites', 'settings']) {
          await assertFails(db.collection(`agencies/${agencyId}/${collection}`).get());
          const id = collection === 'settings' ? 'gdsCities' : 'test';
          await assertFails(db.doc(`agencies/${agencyId}/${collection}/${id}`).set({ test: true }));
        }
      }
      await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`agencies/${agencyId}`).update({ status: 'active' }));
      const db = authAs('suspended-member', agencyId, 'agent').firestore();
      await assertSucceeds(db.collection(`agencies/${agencyId}/passengers`).get());
      await assertSucceeds(db.doc(`agencies/${agencyId}/settings/gdsCities`).set({ items: [] }));
    });

    it('listener abierto no recibe nuevos pasajeros al suspender la agencia', { timeout: 15000 }, async () => {
      const agencyId = 'listener-agency';
      await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`agencies/${agencyId}`).set({ status: 'active' }));
      const db = authAs(UID_A, agencyId, 'agent').firestore();
      let ready;
      const firstSnapshot = new Promise(resolve => { ready = resolve; });
      let unsubscribe;
      const denied = new Promise(resolve => {
        unsubscribe = db.collection(`agencies/${agencyId}/passengers`).onSnapshot(ready, resolve);
      });
      try {
        await firstSnapshot;
        await testEnv.withSecurityRulesDisabled(async c => {
          await c.firestore().doc(`agencies/${agencyId}`).update({ status: 'suspended' });
          await c.firestore().doc(`agencies/${agencyId}/passengers/new`).set({ firstname: 'TEST' });
        });
        assert.equal((await denied).code, 'permission-denied');
      } finally {
        unsubscribe();
      }
    });

    it('agencia eliminada no permite leer ni recrear datos con claims antiguos', async () => {
      const db = authAs(UID_A, 'missing-agency', 'owner').firestore();
      await assertFails(db.collection('agencies/missing-agency/passengers').get());
      await assertFails(db.doc('agencies/missing-agency/passengers/test').set({ test: true }));
    });

    it('usuario A lee pasajeros de su agencia', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertSucceeds(
        db.collection('agencies').doc(AGENCY_A).collection('passengers').doc('p1').get()
      );
    });

    it('usuario A NO lee pasajeros de agencia B', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(
        db.collection('agencies').doc(AGENCY_B).collection('passengers').doc('p2').get()
      );
    });

    it('usuario B NO lee pasajeros de agencia A', async () => {
      const db = authAs(UID_B, AGENCY_B, 'agent').firestore();
      await assertFails(
        db.collection('agencies').doc(AGENCY_A).collection('passengers').doc('p1').get()
      );
    });

    it('usuario A lee su propio doc users/{uid}', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertSucceeds(db.collection('users').doc(UID_A).get());
    });

    it('usuario A NO escribe users/{uid}', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(
        db.collection('users').doc(UID_A).set({ agencyId: AGENCY_B })
      );
    });

    it('usuario no autenticado no lee pasajeros', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        db.collection('agencies').doc(AGENCY_A).collection('passengers').doc('p1').get()
      );
    });

    it('usuario A lista solo pasajeros de su agencia', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertSucceeds(
        db.collection('agencies').doc(AGENCY_A).collection('passengers').get()
      );
    });

    it('usuario A NO lista pasajeros de agencia B', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(
        db.collection('agencies').doc(AGENCY_B).collection('passengers').get()
      );
    });

    // ── Reservations: mismo aislamiento multi-tenant que passengers ──────
    it('usuario A lee reservas de su agencia', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertSucceeds(
        db.collection('agencies').doc(AGENCY_A).collection('reservations').doc('r1').get()
      );
    });

    it('usuario A NO lee reservas de agencia B', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(
        db.collection('agencies').doc(AGENCY_B).collection('reservations').doc('r2').get()
      );
    });

    it('usuario A NO lista reservas de agencia B', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(
        db.collection('agencies').doc(AGENCY_B).collection('reservations').get()
      );
    });

    it('usuario A escribe notificación solo en su agencia', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertSucceeds(
        db.collection('agencies').doc(AGENCY_A).collection('notifications').doc('k1').set({ sentAt: new Date() })
      );
    });

    it('usuario A NO escribe notificación en agencia B', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(
        db.collection('agencies').doc(AGENCY_B).collection('notifications').doc('k2').set({ sentAt: new Date() })
      );
    });

    it('usuario sin claims de tenant no lee pasajeros', async () => {
      const db = testEnv.authenticatedContext(UID_A).firestore();
      await assertFails(
        db.collection('agencies').doc(AGENCY_A).collection('passengers').doc('p1').get()
      );
    });

    // ── Regresión: colecciones raíz legacy eliminadas (default deny) ──────
    // Antes los match raíz /passengers, /notifications, /config permitían read
    // a cualquier usuario autenticado (sin scope de agencia). Ahora no existen
    // → el default es deny, sin importar la agencia del lector.
    it('usuario autenticado NO lee colección raíz /passengers (legacy eliminada)', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(db.collection('passengers').doc('anything').get());
    });

    it('usuario autenticado NO lee colección raíz /notifications (legacy eliminada)', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(db.collection('notifications').doc('anything').get());
    });

    it('usuario autenticado NO lee colección raíz /config (legacy eliminada)', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(db.collection('config').doc('anything').get());
    });

    // ── Regresión: medición de uso no legible por el cliente ─────────────
    // El contador /agencies/{id}/usage/{day} lo escriben las Functions vía
    // Admin SDK (service account). Un cliente (incluso miembro de la agencia)
    // no debe poder leerlo: el reporte se sirve por la ruta super-admin.
    it('miembro de la agencia NO lee /agencies/{id}/usage/{day}', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(
        db.collection('agencies').doc(AGENCY_A).collection('usage').doc('2026-01-01').get()
      );
    });

    // ── Regresión: cache de gemini-travel no accesible por el cliente ────
    // La colección raíz /travelCache (resultados de requisitos reutilizados
    // entre agencias) la escriben/leen las Functions vía Admin SDK.
    it('miembro de la agencia NO lee ni escribe /travelCache', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(db.collection('travelCache').doc('v1_XX123_EZE_MIA_ARG').get());
      await assertFails(
        db.collection('travelCache').doc('v1_XX123_EZE_MIA_ARG').set({ data: {} })
      );
    });

    // ── settings/gdsCities: agentes de la misma agencia pueden guardar ──
    function settingsDoc(db, agencyId, docId) {
      return db.collection('agencies').doc(agencyId).collection('settings').doc(docId);
    }

    it('agent de A escribe y lee settings/gdsCities de su agencia', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertSucceeds(settingsDoc(db, AGENCY_A, 'gdsCities').set({ items: [] }));
      await assertSucceeds(settingsDoc(db, AGENCY_A, 'gdsCities').get());
    });

    for (const role of ['owner', 'admin', 'agent']) {
      it(`${role} crea, edita y borra ciudades de su agencia`, async () => {
        const db = authAs(UID_A, AGENCY_A, role).firestore();
        const ref = settingsDoc(db, AGENCY_A, 'gdsCities');
        await testEnv.withSecurityRulesDisabled(c => settingsDoc(c.firestore(), AGENCY_A, 'gdsCities').delete());
        await assertSucceeds(ref.set({ items: [{ id: 'city', title: 'Buenos Aires', code: 'BUE' }] }));
        await assertSucceeds(ref.update({ items: [{ id: 'city', title: 'Buenos Aires editada', code: 'EZE' }] }));
        assert.equal((await ref.get()).data().items[0].code, 'EZE');
        await assertSucceeds(ref.set({ items: [] }));
        assert.equal((await ref.get()).data().items.length, 0);
        await assertSucceeds(ref.delete());
      });
    }

    it('agent de A NO escribe ni lee settings/gdsCities de agencia B', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(settingsDoc(db, AGENCY_B, 'gdsCities').set({ items: [] }));
      await assertFails(settingsDoc(db, AGENCY_B, 'gdsCities').get());
    });

    it('agent de A NO escribe otro doc de settings (solo gdsCities)', async () => {
      const db = authAs(UID_A, AGENCY_A, 'agent').firestore();
      await assertFails(settingsDoc(db, AGENCY_A, 'alerts').set({ email: 'x@y.com' }));
    });

    it('admin de A escribe otros docs de settings', async () => {
      const db = authAs(UID_A, AGENCY_A, 'admin').firestore();
      await assertSucceeds(settingsDoc(db, AGENCY_A, 'alerts').set({ email: 'x@y.com' }));
    });

    it('usuario no autenticado NO escribe settings/gdsCities', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(settingsDoc(db, AGENCY_A, 'gdsCities').set({ items: [] }));
    });
  });
}