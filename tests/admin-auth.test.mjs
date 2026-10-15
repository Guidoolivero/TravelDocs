// Test de la lógica de autorización de super-admin (Fase 2).
// checkPlatformAdmin es pura: no toca Admin SDK ni env vars, así que corre
// sin emulator ni service account. Cubre el criterio de aceptación:
// "request sin platformAdmin → 403" + la doble verificación claim+email.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkPlatformAdmin } from '../netlify/functions/_platform-admin.cjs';

const ALLOWED = ['guido@tradingtravel.com.ar'];

describe('checkPlatformAdmin — autorización de super-admin', () => {
  it('rechaza con 403 (no-claim) si no hay claims', () => {
    const r = checkPlatformAdmin({ claims: null, email: 'guido@tradingtravel.com.ar', allowedEmails: ALLOWED });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.reason, 'no-claim');
  });

  it('rechaza con 403 (no-claim) si el claim platformAdmin no es true', () => {
    const r = checkPlatformAdmin({ claims: { agencyId: 'x', role: 'admin' }, email: 'guido@tradingtravel.com.ar', allowedEmails: ALLOWED });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-claim');
  });

  it('rechaza con 403 (no-claim) si platformAdmin es false explícito', () => {
    const r = checkPlatformAdmin({ claims: { platformAdmin: false }, email: 'guido@tradingtravel.com.ar', allowedEmails: ALLOWED });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-claim');
  });

  it('rechaza con 403 (email-mismatch) si tiene claim pero el email no está en la lista', () => {
    const r = checkPlatformAdmin({ claims: { platformAdmin: true }, email: 'intruso@otro.com', allowedEmails: ALLOWED });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.reason, 'email-mismatch');
  });

  it('aprueba si claim true y email en la lista (case-insensitive)', () => {
    const r = checkPlatformAdmin({ claims: { platformAdmin: true }, email: 'GUIDO@tradingtravel.com.ar', allowedEmails: ALLOWED });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.reason, 'ok');
  });

  it('rechaza con 403 si allowedEmails está vacío (env var no configurada)', () => {
    const r = checkPlatformAdmin({ claims: { platformAdmin: true }, email: 'guido@tradingtravel.com.ar', allowedEmails: [] });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'email-mismatch');
  });

  it('aprueba con varios super-admines en la lista', () => {
    const r = checkPlatformAdmin({ claims: { platformAdmin: true }, email: 'b@ejemplo.com', allowedEmails: ['a@ejemplo.com', 'b@ejemplo.com'] });
    assert.strictEqual(r.ok, true);
  });
});
