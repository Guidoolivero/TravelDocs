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
const UID_ADMIN = 'admin-a-uid';
const ROLE_UID = { agent: UID_A, admin: UID_ADMIN, owner: 'owner-a-uid' };

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

      for (const role of ['owner', 'admin']) {
        await db.doc(`users/${ROLE_UID[role]}`).set({ agencyId: AGENCY_A, role, active: true });
      }

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
    return testEnv.authenticatedContext(uid, { agencyId, role, firebase: { sign_in_second_factor: 'totp' }, auth_time: Math.floor(Date.now() / 1000) });
  }

  describe('Firestore rules — aislamiento multi-tenant', () => {
    it('sin MFA o con sesion anterior al reset no accede a datos de agencia', async () => {
      const uid = 'mfa-session';
      await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`users/${uid}`).set({ active: true, agencyId: AGENCY_A, role: 'agent', mfaResetAt: 100 }));
      for (const extra of [{ auth_time: 200 }, { auth_time: 100, firebase: { sign_in_second_factor: 'totp' } }]) {
        const db = testEnv.authenticatedContext(uid, { agencyId: AGENCY_A, role: 'agent', ...extra }).firestore();
        await assertFails(db.collection(`agencies/${AGENCY_A}/passengers`).get());
        await assertFails(db.doc(`agencies/${AGENCY_A}/settings/gdsCities`).set({ items: [] }));
        await assertSucceeds(db.doc(`users/${uid}`).get());
      }
      const db = testEnv.authenticatedContext(uid, { agencyId: AGENCY_A, role: 'agent', auth_time: 200, firebase: { sign_in_second_factor: 'totp' } }).firestore();
      await assertSucceeds(db.collection(`agencies/${AGENCY_A}/passengers`).get());
    });

    it('membresias e invitaciones solo se escriben desde el backend', async () => {
      for (const role of ['owner', 'admin', 'agent']) {
        const uid = `member-${role}`;
        await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`users/${uid}`).set({ agencyId: AGENCY_A, role, active: true }));
        const db = authAs(uid, AGENCY_A, role).firestore();
        for (const collection of ['members', 'invites']) {
          const ref = db.doc(`agencies/${AGENCY_A}/${collection}/${uid}`);
          await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(ref.path).set({ role: 'agent', active: true }));
          await assertFails(ref.update({ role: 'owner' }));
          await assertFails(ref.delete());
          await assertFails(db.doc(`agencies/${AGENCY_A}/${collection}/new-${uid}`).set({ role: 'owner' }));
        }
      }
    });

    it('token anterior al cambio de agencia pierde acceso y el renovado accede solo a la nueva', async () => {
      const uid = 'transferred-user';
      await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`users/${uid}`).set({ active: true, agencyId: AGENCY_B, role: 'agent' }));
      const oldDb = authAs(uid, AGENCY_A, 'agent').firestore();
      await assertFails(oldDb.collection(`agencies/${AGENCY_A}/passengers`).get());
      await assertFails(oldDb.doc(`agencies/${AGENCY_A}/settings/gdsCities`).set({ items: [] }));
      await assertFails(oldDb.collection(`agencies/${AGENCY_B}/passengers`).get());
      const newDb = authAs(uid, AGENCY_B, 'agent').firestore();
      await assertSucceeds(newDb.collection(`agencies/${AGENCY_B}/passengers`).get());
      await assertFails(newDb.collection(`agencies/${AGENCY_A}/passengers`).get());
    });

    it('rol owner anterior no conserva permisos despues de bajar a agent', async () => {
      const uid = 'demoted-user';
      await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`users/${uid}`).set({ active: true, agencyId: AGENCY_A, role: 'agent' }));
      const oldDb = authAs(uid, AGENCY_A, 'owner').firestore();
      await assertFails(oldDb.collection(`agencies/${AGENCY_A}/passengers`).get());
      await assertFails(oldDb.doc(`agencies/${AGENCY_A}/settings/alerts`).set({ email: 'other@test.com' }));
      const newDb = authAs(uid, AGENCY_A, 'agent').firestore();
      await assertSucceeds(newDb.collection(`agencies/${AGENCY_A}/passengers`).get());
      await assertFails(newDb.doc(`agencies/${AGENCY_A}/settings/alerts`).set({ email: 'other@test.com' }));
      await assertSucceeds(newDb.doc(`agencies/${AGENCY_A}/settings/gdsCities`).set({ items: [] }));
    });

    for (const changedField of ['agencyId', 'role', 'mfaResetAt']) {
      it(`listener abierto deja de recibir datos cuando cambia ${changedField}`, { timeout: 15000 }, async () => {
        const uid = `listener-change-${changedField}`;
        await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`users/${uid}`).set({ active: true, agencyId: AGENCY_A, role: 'owner' }));
        const db = authAs(uid, AGENCY_A, 'owner').firestore();
        let ready;
        const firstSnapshot = new Promise(resolve => { ready = resolve; });
        let unsubscribe;
        const denied = new Promise(resolve => {
          unsubscribe = db.collection(`agencies/${AGENCY_A}/passengers`).onSnapshot(ready, resolve);
        });
        try {
          await firstSnapshot;
          await testEnv.withSecurityRulesDisabled(async c => {
            await c.firestore().doc(`users/${uid}`).update({ [changedField]: { role: 'agent', agencyId: AGENCY_B, mfaResetAt: Math.floor(Date.now() / 1000) + 1 }[changedField] });
            await c.firestore().doc(`agencies/${AGENCY_A}/passengers/change-${changedField}`).set({ firstname: 'TEST' });
          });
          assert.equal((await denied).code, 'permission-denied');
        } finally {
          unsubscribe();
        }
      });
    }

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
      await testEnv.withSecurityRulesDisabled(c => c.firestore().doc('users/listener').set({ active: true, agencyId: AGENCY_A, role: 'agent' }));
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
        for (const role of ['owner', 'admin', 'agent']) {
          await c.firestore().doc(`users/suspended-${role}`).set({ active: true, agencyId, role });
        }
      });
      for (const role of ['owner', 'admin', 'agent']) {
        const db = authAs(`suspended-${role}`, agencyId, role).firestore();
        await assertFails(db.doc(`agencies/${agencyId}`).get());
        await assertFails(db.doc(`agencies/${agencyId}`).update({ status: 'active' }));
        for (const collection of ['passengers', 'reservations', 'notifications', 'members', 'invites', 'settings']) {
          await assertFails(db.collection(`agencies/${agencyId}/${collection}`).get());
          const id = collection === 'settings' ? 'gdsCities' : 'test';
          await assertFails(db.doc(`agencies/${agencyId}/${collection}/${id}`).set({ test: true }));
        }
      }
      await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`agencies/${agencyId}`).update({ status: 'active' }));
      const db = authAs('suspended-agent', agencyId, 'agent').firestore();
      await assertSucceeds(db.collection(`agencies/${agencyId}/passengers`).get());
      await assertSucceeds(db.doc(`agencies/${agencyId}/settings/gdsCities`).set({ items: [] }));
    });

    it('listener abierto no recibe nuevos pasajeros al suspender la agencia', { timeout: 15000 }, async () => {
      const agencyId = 'listener-agency';
      await testEnv.withSecurityRulesDisabled(async c => {
        await c.firestore().doc(`agencies/${agencyId}`).set({ status: 'active' });
        await c.firestore().doc('users/agency-listener').set({ agencyId, role: 'agent', active: true });
      });
      const db = authAs('agency-listener', agencyId, 'agent').firestore();
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

    it('ningun rol de agencia modifica campos administrativos ni agrega campos nuevos', async () => {
      const agencyId = 'protected-agency-fields';
      const original = {
        name: 'Agencia', slug: agencyId, status: 'active', plan: 'starter', memberCount: 2,
        branding: { appName: 'Agencia' }, alerts: { email: 'agency@test.com' },
        createdAt: 'original', updatedAt: 'original',
      };
      await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`agencies/${agencyId}`).set(original));
      for (const role of ['owner', 'admin', 'agent']) {
        const uid = `${agencyId}-${role}`;
        await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`users/${uid}`).set({ agencyId, role, active: true }));
        const ref = authAs(uid, agencyId, role).firestore().doc(`agencies/${agencyId}`);
        await assertSucceeds(ref.get());
        for (const patch of [
          { plan: 'pro' }, { slug: 'otra' }, { memberCount: 999 }, { name: 'Otro nombre' },
          { branding: { appName: 'Otro' } }, { alerts: { email: 'other@test.com' } },
          { createdAt: 'otro' }, { updatedAt: 'otro' }, { futureAdminField: true },
        ]) {
          await assertFails(ref.update(patch));
        }
        await assertFails(ref.set({ ...original, plan: 'pro' }));
        await assertFails(ref.set({ name: 'Reemplazo' }));
        assert.deepEqual((await ref.get()).data(), original);
      }
    });

    it('estado de agencia solo se modifica desde el backend de plataforma', async () => {
      const agencyId = 'protected-status';
      await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`agencies/${agencyId}`).set({ status: 'active' }));
      for (const role of ['owner', 'admin']) {
        const uid = `${agencyId}-${role}`;
        await testEnv.withSecurityRulesDisabled(c => c.firestore().doc(`users/${uid}`).set({ agencyId, role, active: true }));
        const ref = authAs(uid, agencyId, role).firestore().doc(`agencies/${agencyId}`);
        await assertFails(ref.update({ status: 'suspended' }));
        await assertFails(ref.set({ name: 'Sin estado' }));
        await assertFails(ref.update({ name: 'Cambio directo' }));
        await assertFails(ref.update({ status: 'active' }));
      }
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
        const db = authAs(ROLE_UID[role], AGENCY_A, role).firestore();
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
      const db = authAs(UID_ADMIN, AGENCY_A, 'admin').firestore();
      await assertSucceeds(settingsDoc(db, AGENCY_A, 'alerts').set({ email: 'x@y.com' }));
    });

    it('usuario no autenticado NO escribe settings/gdsCities', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(settingsDoc(db, AGENCY_A, 'gdsCities').set({ items: [] }));
    });
    for (const role of ['owner', 'admin', 'agent']) {
      it(`${role} no accede a datos fiscales, tickets ni reservas del facturador`, async () => {
        const db = authAs(ROLE_UID[role], AGENCY_A, role).firestore();
        for (const collection of ['billingProfiles', 'billingInvoices', 'billingAttempts', 'billingStore', 'billingLocks']) {
          const ref = db.collection(collection).doc('prueba');
          await assertFails(ref.get());
          await assertFails(ref.set({ value: 'no permitido' }));
        }
      });
    }
  });
}