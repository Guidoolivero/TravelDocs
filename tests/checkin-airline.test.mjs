import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparePdfAirline, confirmAirline } from '../public/js/checkin-airline.mjs';

test('logo sin nombre escrito conserva el numero y requiere confirmacion', () => {
  const p = preparePdfAirline({ vuelo: 'UX1134', vueloDocumento: '1134', compania: 'AR', companiaFuente: 'logo', companiaEvidencia: 'Logo del condor' });
  assert.equal(p.vuelo, '1134');
  assert.equal(p.compania, '');
  assert.equal(p.companiaSugerida, 'AR');
  assert.equal(p.companiaPendiente, true);
  const confirmed = confirmAirline(p, 'AR');
  assert.equal(confirmed.vuelo, 'AR1134');
  assert.equal(confirmed.compania, 'AR');
  assert.equal(confirmed.companiaPendiente, false);
});

test('codigo escrito se conserva y evidencia textual permite completar automaticamente', () => {
  const p = preparePdfAirline({ vuelo: 'AR1134', vueloDocumento: 'AR 1134', compania: 'AR', companiaFuente: 'texto', companiaEvidencia: 'AR 1134' });
  assert.equal(p.vuelo, 'AR1134');
  assert.equal(p.compania, 'AR');
  assert.equal(p.companiaPendiente, false);
  const named = preparePdfAirline({ vuelo: 'AR1134', vueloDocumento: '1134', compania: 'AR', companiaFuente: 'texto', companiaEvidencia: 'Aerolíneas Argentinas' });
  assert.equal(named.vuelo, 'AR1134');
});

test('sin evidencia no inventa compania y conserva el numero incluso si el modelo omite el nuevo campo', () => {
  for (const raw of [{ vuelo: 'UX1134', compania: 'UX' }, { vuelo: '1134', vueloDocumento: '1134', compania: 'UX', companiaFuente: 'desconocida' }]) {
    const p = preparePdfAirline(raw);
    assert.equal(p.vuelo, '1134');
    assert.equal(p.compania, '');
    assert.equal(p.companiaSugerida, '');
    assert.equal(p.companiaPendiente, true);
  }
});

test('confirmar una operadora distinta no reemplaza el codigo comercial escrito', () => {
  const p = preparePdfAirline({ vuelo: 'IB1234', vueloDocumento: 'IB1234', compania: 'AR', companiaFuente: 'logo', companiaEvidencia: 'Logo de la operadora' });
  assert.equal(confirmAirline(p, 'AR').vuelo, 'IB1234');
  assert.throws(() => confirmAirline(p, 'ZZZZ'), /reconocido/);
});

test('prefijo de emision o evidencia vacia no confirman la operadora y un numero solo no se recorta', () => {
  for (const evidence of ['', 'ETK 044-0000000000']) {
    const p = preparePdfAirline({ vuelo: '1134', compania: 'AR', companiaFuente: 'texto', companiaEvidencia: evidence });
    assert.equal(p.vuelo, '1134');
    assert.equal(p.companiaPendiente, true);
    assert.equal(p.compania, '');
  }
});
