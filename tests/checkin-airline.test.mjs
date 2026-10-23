import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparePdfAirline, confirmAirline } from '../public/js/checkin-airline.mjs';

test('solo logo o evidencia inventada dejan vacia la compania sin sugerencias', () => {
  const p = preparePdfAirline({ vuelo: 'UX1134', vueloDocumento: 'UX1134', compania: 'AR', companiaFuente: 'texto', companiaEvidencia: 'Aerolíneas Argentinas' }, 'VUELO 1134 EZE MAD\nETK: 044-0000000000');
  assert.equal(p.vuelo, '1134');
  assert.equal(p.compania, '');
  assert.ok(!p.companiaSugerida);
  assert.equal(p.companiaPendiente, true);
  const confirmed = confirmAirline(p, 'AR');
  assert.equal(confirmed.vuelo, 'AR1134');
  assert.equal(confirmed.compania, 'AR');
  assert.equal(confirmed.companiaPendiente, false);
});

test('codigo escrito se conserva y evidencia textual permite completar automaticamente', () => {
  const p = preparePdfAirline({ vuelo: 'AR1134', vueloDocumento: 'AR 1134', compania: 'AR', companiaFuente: 'texto', companiaEvidencia: 'AR 1134' }, 'Vuelo AR 1134 EZE MAD');
  assert.equal(p.vuelo, 'AR1134');
  assert.equal(p.compania, 'AR');
  assert.equal(p.companiaPendiente, false);
  const named = preparePdfAirline({ vuelo: 'AR1134', vueloDocumento: '1134', compania: 'AR', companiaFuente: 'texto', companiaEvidencia: 'Aerolíneas Argentinas' }, 'Aerolíneas Argentinas\nVuelo 1134 EZE MAD');
  assert.equal(named.vuelo, 'AR1134');
});

test('sin evidencia no inventa compania y conserva el numero incluso si el modelo omite el nuevo campo', () => {
  for (const raw of [{ vuelo: 'UX1134', compania: 'UX' }, { vuelo: '1134', vueloDocumento: '1134', compania: 'UX', companiaFuente: 'desconocida' }]) {
    const p = preparePdfAirline(raw);
    assert.equal(p.vuelo, '1134');
    assert.equal(p.compania, '');
    assert.ok(!p.companiaSugerida);
    assert.equal(p.companiaPendiente, true);
  }
});

test('confirmar una operadora distinta no reemplaza el codigo comercial escrito', () => {
  const p = preparePdfAirline({ vuelo: 'IB1234', vueloDocumento: 'IB1234', compania: 'AR', companiaEvidencia: 'IB1234 - Operado por Aerolíneas Argentinas' }, 'IB1234 - Operado por Aerolíneas Argentinas');
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

test('el texto prevalece sobre cualquier codigo o logo propuesto y sirve para distintas aerolineas', () => {
  for (const code of ['AR', 'UX', 'AA', 'IB', 'G3', 'U2', '6E']) {
    const p = preparePdfAirline({ vuelo: 'UX1134', compania: 'UX', companiaSugerida: 'UX' }, `Vuelo ${code}1134 EZE MAD`);
    assert.equal(p.compania, code);
    assert.equal(p.vuelo, `${code}1134`);
    assert.equal(p.companiaPendiente, false);
    assert.ok(!p.companiaSugerida);
  }
  const named = preparePdfAirline({ vuelo: '1134', compania: 'AR' }, 'Air Europa\nVuelo 1134 EZE MAD');
  assert.equal(named.compania, 'UX');
});

test('nombre de emisora, codigos en localizadores y nombres ambiguos no completan la operadora', () => {
  for (const text of ['Emitido por Aerolíneas Argentinas\nVuelo 1134 EZE MAD', 'LOCALIZADOR ARABCD\nVuelo 1134', 'LOCALIZADOR AR1134\nVuelo 1134', 'Air Europa / Iberia\nVuelo 1134', 'PASAJERO: CONDOR, ANA\nITINERARIO\nVuelo 1134 EZE MAD']) {
    const p = preparePdfAirline({ vuelo: 'AR1134', compania: 'AR' }, text);
    assert.equal(p.compania, '');
    assert.equal(p.vuelo, '1134');
  }
});

test('un codigo identificado expresamente como aerolinea tambien sirve sin prefijo en el vuelo', () => {
  const p = preparePdfAirline({ vuelo: '1134', compania: 'UX' }, 'Compañía aérea: AR\nVuelo 1134 EZE MAD');
  assert.equal(p.compania, 'AR');
  assert.equal(p.vuelo, 'AR1134');
});

test('codigo compartido usa la operadora escrita despues de operado por y conserva el comercial', () => {
  const p = preparePdfAirline({ vuelo: 'IB1234', compania: 'AR', companiaEvidencia: 'IB1234 Operado por AR' }, 'IB1234 Operado por AR');
  assert.equal(p.compania, 'AR');
  assert.equal(p.vuelo, 'IB1234');
  const contradicted = preparePdfAirline({ vuelo: 'IB1234', compania: 'AR', companiaEvidencia: 'IB1234 Aerolíneas Argentinas - Operado por Air Europa' }, 'IB1234 Aerolíneas Argentinas - Operado por Air Europa');
  assert.notEqual(contradicted.compania, 'AR');
});
