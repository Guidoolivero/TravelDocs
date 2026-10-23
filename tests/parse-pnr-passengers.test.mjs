import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePnrPassengers } from '../public/js/parse-pnr-passengers.mjs';
import { matchItineraryPassengers } from '../public/js/pending-passengers.mjs';

test('conserva la D de D IMPERIO despues del numero de pasajero', () => {
  const pnr = `BERALDI/JOSE PEDRO   2.D IMPERIO/MIGUEL ANGEL
  3  AR1410 S 14NOV 6 AEPMDZ HK2  0905 1105  14NOV  E  AR/GLLXHV
  4  AR1415 S 15NOV 7 MDZAEP HK2  1420 1600  15NOV  E  AR/GLLXHV`;
  assert.deepEqual(parsePnrPassengers(pnr), [
    { apellido: 'BERALDI', nombre: 'JOSE PEDRO', tipo: 'ADT' },
    { apellido: 'D IMPERIO', nombre: 'MIGUEL ANGEL', tipo: 'ADT' }
  ]);
});

test('conserva la D cuando el primer pasajero tambien trae numero de linea', () => {
  const names = parsePnrPassengers('1.BERALDI/JOSE PEDRO  2.D IMPERIO/MIGUEL ANGEL\n  3  AR1410 S 14NOV 6 AEPMDZ HK2  0905 1105  14NOV  E  AR/GLLXHV');
  assert.deepEqual(names.map(p => `${p.apellido}/${p.nombre}`), [
    'BERALDI/JOSE PEDRO',
    'D IMPERIO/MIGUEL ANGEL'
  ]);
});

test('conserva D apostrofe y no toma el localizador AR/GLLXHV como pasajero', () => {
  const pnr = `1.D'IMPERIO/GASTON FEDERICO  2.D'IMPERIO/HERNAN MATIAS
3.GAGLIARDI/PABLO RICARDO
 4 AR1410 B 14NOV 6 AEPMDZ HK3  0905 1105  14NOV  E  AR/GLLXHV`;
  const names = parsePnrPassengers(pnr);
  assert.deepEqual(names.map(p => `${p.apellido}/${p.nombre}`), [
    "D'IMPERIO/GASTON FEDERICO",
    "D'IMPERIO/HERNAN MATIAS",
    'GAGLIARDI/PABLO RICARDO'
  ]);
});

test('el PNR de Beraldi + D Imperio enlaza las dos fichas', () => {
  const pnr = `BERALDI/JOSE PEDRO   2.D IMPERIO/MIGUEL ANGEL
  3  AR1410 S 14NOV 6 AEPMDZ HK2  0905 1105  14NOV  E  AR/GLLXHV
  4  AR1415 S 15NOV 7 MDZAEP HK2  1420 1600  15NOV  E  AR/GLLXHV`;
  const result = matchItineraryPassengers(parsePnrPassengers(pnr), [
    { id: 'b', lastname: 'BERALDI', firstname: 'JOSE PEDRO' },
    { id: 'm', lastname: 'D IMPERIO', firstname: 'MIGUEL ANGEL' }
  ]);
  assert.deepEqual(result, { ids: ['b', 'm'], pending: [] });
});
