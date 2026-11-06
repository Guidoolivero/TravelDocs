// Tests de las validaciones puras del panel super-admin.
// canDeleteAgency, canDeleteUser y validateUserPatch son funciones puras
// (sin Admin SDK ni env vars), así que corren sin emulator ni service account.
// Estilo idéntico a admin-auth.test.mjs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteAgency, canDeleteUser, validateUserPatch } from '../netlify/functions/lib/administracion/admin-validators.cjs';

describe('canDeleteAgency', () => {
  it('rechaza si es la ultima agencia de la plataforma', () => {
    const r = canDeleteAgency({ agencyCount: 1, superAdminUid: 'u1', superAdminMemberUids: [] });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'last-agency');
  });

  it('aprueba con varias agencias y el super-admin no es miembro', () => {
    const r = canDeleteAgency({ agencyCount: 3, superAdminUid: 'u1', superAdminMemberUids: ['u2', 'u3'] });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.reason, 'ok');
  });

  it('rechaza si el super-admin es miembro de la agencia a borrar', () => {
    const r = canDeleteAgency({ agencyCount: 3, superAdminUid: 'u1', superAdminMemberUids: ['u1', 'u2'] });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'self-member');
  });

  it('aprueba con agencyCount 0 (defensivo, no deberia pasar)', () => {
    // agencyCount <= 1 → last-agency también aplica con 0.
    const r = canDeleteAgency({ agencyCount: 0, superAdminUid: 'u1', superAdminMemberUids: [] });
    assert.strictEqual(r.reason, 'last-agency');
  });
});

describe('canDeleteUser', () => {
  it('rechaza si el super-admin se elimina a si mismo', () => {
    const r = canDeleteUser({ targetUid: 'u1', superAdminUid: 'u1', targetRole: 'agent', activeOwnerCount: 5 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'self');
  });

  it('aprueba un agente no-owner', () => {
    const r = canDeleteUser({ targetUid: 'u2', superAdminUid: 'u1', targetRole: 'agent', activeOwnerCount: 1 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.reason, 'ok');
  });

  it('rechaza si es el unico owner activo', () => {
    const r = canDeleteUser({ targetUid: 'u2', superAdminUid: 'u1', targetRole: 'owner', activeOwnerCount: 1 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'last-owner');
  });

  it('aprueba borrar un owner si hay otros owners activos', () => {
    const r = canDeleteUser({ targetUid: 'u2', superAdminUid: 'u1', targetRole: 'owner', activeOwnerCount: 2 });
    assert.strictEqual(r.ok, true);
  });

  it('aprueba borrar un owner inactivo aunque activeOwnerCount sea 1', () => {
    const r = canDeleteUser({ targetUid: 'u2', superAdminUid: 'u1', targetRole: 'owner', targetActive: false, activeOwnerCount: 1 });
    assert.strictEqual(r.ok, true);
  });
});

describe('validateUserPatch', () => {
  it('no-op si el email no cambia y no hay password', () => {
    const r = validateUserPatch({ email: 'a@b.com', password: '', currentEmail: 'a@b.com' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.emailChanged, false);
    assert.strictEqual(r.passwordChanged, false);
  });

  it('detecta cambio de email (case-insensitive) y normaliza', () => {
    const r = validateUserPatch({ email: '  B@C.COM ', password: '', currentEmail: 'b@c.com' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.emailChanged, false); // normalizado coincide
    assert.strictEqual(r.normalizedEmail, undefined);
  });

  it('marca emailChanged true cuando cambia realmente', () => {
    const r = validateUserPatch({ email: 'nuevo@b.com', password: '', currentEmail: 'a@b.com' });
    assert.strictEqual(r.emailChanged, true);
    assert.strictEqual(r.normalizedEmail, 'nuevo@b.com');
  });

  it('rechaza email con formato invalido', () => {
    const r = validateUserPatch({ email: 'no-es-email', password: '', currentEmail: 'a@b.com' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.emailChanged, false);
    assert.match(r.error, /Email/);
  });

  it('rechaza password menor a 8 caracteres', () => {
    const r = validateUserPatch({ email: 'a@b.com', password: '1234567', currentEmail: 'a@b.com' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.passwordChanged, false);
    assert.match(r.error, /8 caracteres/);
  });

  it('aprueba password valida', () => {
    const r = validateUserPatch({ email: 'a@b.com', password: '12345678', currentEmail: 'a@b.com' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.passwordChanged, true);
  });

  it('sin email ni password → todo no-op y ok', () => {
    const r = validateUserPatch({ email: undefined, password: undefined, currentEmail: 'a@b.com' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.emailChanged, false);
    assert.strictEqual(r.passwordChanged, false);
  });
});
