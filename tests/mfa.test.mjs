import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './firebase-fixture.mjs';

test('Functions rechaza sesion sin segundo factor aunque mfaEnrolled sea true', async () => {
  const f = fixture();
  delete f.tokens.get('user').firebase.sign_in_second_factor;
  assert.equal((await f.verify()).status, 403);
});
test('Functions confia en el segundo factor de Firebase aunque la marca informativa este atrasada', async () => {
  const f = fixture();
  assert.equal((await f.verify()).ok, true);
  f.tokens.get('user').mfaEnrolled = false;
  assert.equal((await f.verify()).ok, true);
});
test('Functions rechaza la sesion anterior a un reseteo aunque conserve MFA', async () => {
  const f = fixture();
  f.docs.get('users/user').mfaResetAt = f.tokens.get('user').auth_time;
  assert.equal((await f.verify()).status, 401);
});

test('force-reset exige permiso vigente y email autorizado, no el claim viejo', async () => {
  for (const change of ['claim', 'email']) {
    const f = fixture();
    f.tokens.get('admin').platformAdmin = true;
    if (change === 'claim') f.accounts.get('admin').customClaims.platformAdmin = false;
    else f.tokens.get('admin').email = 'other@test.com';
    f.docs.set('agencies/agency/members/user', { role: 'agent' });
    assert.equal((await f.invoke('mfa-admin', { action: 'force-reset', targetUid: 'user' })).statusCode, 403);
    assert.equal(f.calls.length, 0);
  }
});
test('platformAdmin puede resetear un usuario de otra agencia', async () => {
  const f = fixture();
  f.docs.get('users/user').agencyId = 'other';
  assert.equal((await f.invoke('mfa-admin', { action: 'force-reset', targetUid: 'user' })).statusCode, 200);
  assert.equal(f.accounts.get('user').multiFactor.enrolledFactors.length, 0);
  assert.equal(f.accounts.get('user').customClaims.mfaEnrolled, false);
});

function recoveryFixture() {
  const f = fixture();
  const code = 'ABCD-EFGH-JKLM-NPQR', salt = 'test-salt';
  f.docs.get('users/user').recoveryCodes = [{ salt, hash: createHash('sha256').update(`${salt}:${code}`).digest('hex') }];
  return { f, body: { action: 'reset', targetUid: 'user', recoveryCode: code } };
}
test('reset consume el codigo, invalida sesiones y no admite reutilizarlo', async () => {
  const { f, body } = recoveryFixture();
  assert.equal((await f.invoke('mfa-admin', body)).statusCode, 200);
  assert.equal(f.docs.get('users/user').recoveryCodes.length, 0);
  assert.equal(Number.isInteger(f.docs.get('users/user').mfaResetAt), true);
  assert.equal(f.calls.some(([op, uid]) => op === 'revoke' && uid === 'user'), true);
  assert.equal((await f.invoke('mfa-admin', body)).statusCode, 403);
});
test('dos resets concurrentes con el mismo codigo solo permiten uno', async () => {
  const { f, body } = recoveryFixture();
  const responses = await Promise.all([f.invoke('mfa-admin', body), f.invoke('mfa-admin', body)]);
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 403]);
  assert.equal(f.calls.filter(([op]) => op === 'updateUser').length, 1);
});

test('enrolamiento rechaza cuenta sin TOTP real y conserva la excepcion sin MFA para enrolar', async () => {
  const f = fixture();
  f.tokens.get('user').firebase = {};
  f.tokens.get('user').mfaEnrolled = false;
  f.accounts.get('user').multiFactor.enrolledFactors = [{ factorId: 'phone' }];
  assert.equal((await f.invoke('mfa-complete', {}, 'user')).statusCode, 400);
  assert.equal(f.calls.length, 0);
});
test('enrolamiento genera un codigo verificable y conserva los claims existentes', async () => {
  const f = fixture();
  f.tokens.get('admin').firebase = {};
  const response = await f.invoke('mfa-complete');
  assert.equal(response.statusCode, 200);
  const code = JSON.parse(response.body).recoveryCodes[0];
  const entry = f.docs.get('users/admin').recoveryCodes[0];
  assert.equal(entry.hash, createHash('sha256').update(`${entry.salt}:${code}`).digest('hex'));
  assert.equal(f.accounts.get('admin').customClaims.platformAdmin, true);
});
test('dos enrolamientos concurrentes entregan un solo codigo de recuperacion', async () => {
  const f = fixture();
  const responses = await Promise.all([f.invoke('mfa-complete'), f.invoke('mfa-complete')]);
  const bodies = responses.map(r => JSON.parse(r.body));
  assert.equal(bodies.filter(b => b.recoveryCodes?.length === 1).length, 1);
  assert.equal(bodies.filter(b => b.existing === true).length, 1);
});

test('owner no resetea usuarios trasladados aunque quede una membresia antigua', async () => {
  const { f, body } = recoveryFixture();
  f.docs.get('users/user').agencyId = 'other';
  f.docs.set('agencies/agency/members/user', { role: 'agent' });
  assert.equal((await f.invoke('mfa-admin', body)).statusCode, 404);
  assert.equal(f.calls.length, 0);
});
test('agent no resetea MFA y ni platformAdmin lo hace sin sesion TOTP', async () => {
  const { f, body } = recoveryFixture();
  assert.equal((await f.invoke('mfa-admin', body, 'user')).statusCode, 403);
  f.tokens.get('admin').firebase = {};
  assert.equal((await f.invoke('mfa-admin', { action: 'force-reset', targetUid: 'user' })).statusCode, 403);
  assert.equal(f.calls.length, 0);
});
test('un fallo de Auth deja el acceso bloqueado y no permite reutilizar el codigo', async () => {
  const { f, body } = recoveryFixture();
  f.sdkAuth.updateUser = async () => { throw new Error('Auth unavailable'); };
  assert.equal((await f.invoke('mfa-admin', body)).statusCode, 500);
  assert.equal((await f.verify()).status, 401);
  assert.equal((await f.invoke('mfa-admin', body)).statusCode, 403);
});
test('reseteo rechaza entradas invalidas sin modificar datos', async () => {
  const f = fixture();
  for (const body of [null, [], { action: 'reset', targetUid: 123 }, { action: 'reset', targetUid: 'user', recoveryCode: {} }]) {
    assert.equal((await f.invoke('mfa-admin', body)).statusCode, 400);
  }
  assert.equal(f.calls.length, 0);
});

test('despues del reset el usuario re-enrola, recibe otro codigo y vuelve a ingresar con TOTP', async () => {
  const { f, body } = recoveryFixture();
  assert.equal((await f.invoke('mfa-admin', body)).statusCode, 200);
  f.tokens.get('user').auth_time = f.docs.get('users/user').mfaResetAt + 1;
  f.tokens.get('user').firebase = {};
  f.tokens.get('user').mfaEnrolled = false;
  f.accounts.get('user').multiFactor.enrolledFactors = [{ factorId: 'totp' }];
  const response = await f.invoke('mfa-complete', {}, 'user');
  assert.equal(response.statusCode, 200);
  const newCode = JSON.parse(response.body).recoveryCodes[0];
  assert.notEqual(newCode, body.recoveryCode);
  f.tokens.get('user').firebase = { sign_in_second_factor: 'totp' };
  f.tokens.get('user').mfaEnrolled = true;
  assert.equal((await f.verify()).ok, true);
  assert.equal((await f.invoke('mfa-admin', body)).statusCode, 403);
  assert.equal((await f.invoke('mfa-admin', { ...body, recoveryCode: newCode })).statusCode, 200);
});

test('login con el factor viejo durante un reset tampoco conserva acceso', async () => {
  const { f, body } = recoveryFixture();
  const update = f.sdkAuth.updateUser;
  f.sdkAuth.updateUser = async (...args) => {
    f.clock.now += 2000;
    f.tokens.get('user').auth_time = Math.floor(f.clock.now / 1000);
    f.clock.now += 2000;
    return update(...args);
  };
  assert.equal((await f.invoke('mfa-admin', body)).statusCode, 200);
  assert.equal((await f.verify()).status, 401);
});
test('enrolamiento iniciado antes del reset no vuelve a generar codigos despues', async () => {
  const { f, body } = recoveryFixture();
  let ready, resume;
  const started = new Promise(resolve => { ready = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  const getUser = f.sdkAuth.getUser;
  let intercept = true;
  f.sdkAuth.getUser = async uid => {
    const record = await getUser(uid);
    if (uid === 'user' && intercept) {
      intercept = false;
      ready();
      await gate;
    }
    return record;
  };
  const completion = f.invoke('mfa-complete', {}, 'user');
  await started;
  assert.equal((await f.invoke('mfa-admin', body)).statusCode, 200);
  resume();
  assert.equal((await completion).statusCode, 401);
  assert.equal(f.docs.get('users/user').recoveryCodes.length, 0);
  assert.equal(f.accounts.get('user').customClaims.mfaEnrolled, false);
});
