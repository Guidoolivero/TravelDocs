import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { venceSesion, SESION_MAX_MS } from '../public/js/sesion.mjs';

const H = 60 * 60 * 1000;
const AHORA = Date.UTC(2026, 9, 18, 20, 0, 0);

// claims del JWT de Firebase en segundos: auth_time = login, iat = emision.
function claims(loginHaceMs) {
  const iat = Math.floor(AHORA / 1000);
  return { iat, auth_time: iat - loginHaceMs / 1000 };
}

describe('venceSesion', () => {
  it('la sesion dura 3 horas', () => {
    assert.equal(SESION_MAX_MS, 3 * H);
  });

  it('recien logueado: vence en 3 horas', () => {
    assert.equal(venceSesion(claims(0), AHORA), AHORA + 3 * H);
  });

  it('logueado hace 2 horas: le queda 1 hora', () => {
    assert.equal(venceSesion(claims(2 * H), AHORA), AHORA + 1 * H);
  });

  it('logueado hace 3 dias: ya vencio', () => {
    assert.ok(venceSesion(claims(72 * H), AHORA) <= AHORA);
  });

  it('no depende del reloj de la PC: mide con iat del server', () => {
    const c = claims(1 * H);
    const relojAdelantado = AHORA + 5 * H;
    assert.equal(venceSesion(c, relojAdelantado), relojAdelantado + 2 * H);
  });

  it('sin claims de tiempo: vence ya (falla cerrado)', () => {
    assert.equal(venceSesion({}, AHORA), AHORA);
    assert.equal(venceSesion({ iat: 123 }, AHORA), AHORA);
  });
});
