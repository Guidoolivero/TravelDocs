import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchItineraryPassengers, mergePendingPassengers } from '../public/js/pasajeros/pending-passengers.mjs';

test('conserva nombres sin ficha y no enlaza coincidencias ambiguas', () => {
 const input = [{apellido:'Beraldi',nombre:'Jose'}, {apellido:'Perez',nombre:'Ana'}];
 const result = matchItineraryPassengers(input, [{id:'1',lastname:'PEREZ',firstname:'ANA'}, {id:'2',lastname:'PEREZ',firstname:'ANA MARIA'}]);
 assert.deepEqual(result.ids, []);
 assert.deepEqual(result.pending, [{lastname:'Beraldi',firstname:'Jose'}, {lastname:'Perez',firstname:'Ana'}]);
 assert.equal(mergePendingPassengers(result.pending,result.pending).length,2);
});
test('enlaza una coincidencia unica con acentos y mantiene el id', () => {
 assert.deepEqual(matchItineraryPassengers([{apellido:'Beraldi',nombre:'José'}], [{id:'x',lastname:'BERALDI',firstname:'JOSE'}]), {ids:['x'],pending:[]});
});

test('enlaza apostrofe o guion del PNR con la ficha escrita con espacio', () => {
  const pax = [{id:'g',lastname:'D IMPERIO',firstname:'GASTON FEDERICO'}];
  assert.deepEqual(matchItineraryPassengers([{apellido:"D'IMPERIO",nombre:'GASTON FEDERICO'}], pax), {ids:['g'],pending:[]});
  assert.deepEqual(matchItineraryPassengers([{apellido:'JOSE-MARIA',nombre:'PEREZ'}], [{id:'j',lastname:'JOSE MARIA',firstname:'PEREZ'}]), {ids:['j'],pending:[]});
});

test('enlaza IMPERIO del parser con la ficha D IMPERIO si el nombre es unico', () => {
  const pax = [{id:'m',lastname:'D IMPERIO',firstname:'MIGUEL ANGEL'}];
  assert.deepEqual(matchItineraryPassengers([{apellido:'IMPERIO',nombre:'MIGUEL ANGEL'}], pax), {ids:['m'],pending:[]});
});

test('no confunde nombres distintos por compartir el primer nombre ni enlaza nombres incompletos', () => {
 const passengers = [{id:'x',lastname:'PEREZ',firstname:'ANA MARIA'}];
 const input = [{apellido:'Perez',nombre:'Ana Laura'}, {apellido:'Perez',nombre:''}];
 assert.deepEqual(matchItineraryPassengers(input, passengers).ids, []);
 assert.deepEqual(matchItineraryPassengers([{apellido:'Perez',nombre:'  ANA   MARIA '}], passengers).ids, ['x']);
});
