import test from 'node:test';
import assert from 'node:assert/strict';
import { esCabotaje, alcanzaConDni } from '../public/js/requisitos/cabotaje.mjs';
import { IATA_ISO2 } from '../lib/requisitos/iata-iso2.mjs';

const idaVuelta = (a, b, extra = {}) => [
  { origen: a, destino: b, escalas: extra.escalas || [] },
  { origen: b, destino: a, escalas: [] },
];

test('AEP-ROS y CRD-NQN son cabotaje', () => {
  assert.equal(esCabotaje(idaVuelta('AEP', 'ROS')), true);
  assert.equal(esCabotaje([{ origen: 'CRD', destino: 'NQN', escalas: [] }]), true);
});

test('un tramo afuera de Argentina no es cabotaje', () => {
  assert.equal(esCabotaje([{ origen: 'EZE', destino: 'MAD', escalas: [] }]), false);
  assert.equal(esCabotaje(idaVuelta('EZE', 'MAD')), false);
  assert.equal(esCabotaje([{ origen: 'AEP', destino: 'EZE', escalas: ['LIS'] }]), false);
  assert.equal(esCabotaje([{ origen: 'EZE', destino: 'ZZZ', escalas: [] }]), false);
  assert.equal(esCabotaje([]), false);
  assert.equal(esCabotaje([{ origen: '', destino: '', escalas: [] }]), false);
});

test('los aeropuertos de la regla son los de Argentina del mapa', () => {
  const ar = Object.keys(IATA_ISO2).filter(k => IATA_ISO2[k] === 'AR');
  const faltan = ar.filter(iata => !esCabotaje([{ origen: 'AEP', destino: iata }]));
  assert.deepEqual(faltan, []);
  assert.equal(esCabotaje([{ origen: 'EZE', destino: 'MAD' }]), false);
});

test('cabotaje con todos argentinos: alcanza el DNI', () => {
  const piernas = idaVuelta('AEP', 'ROS');
  assert.equal(alcanzaConDni(piernas, [{ nationality: 'ARG' }]), true);
  assert.equal(alcanzaConDni(piernas, [{ nationality: 'ARG', pext: { country: 'ITA', num: 'X' } }]), true);
  assert.equal(alcanzaConDni(piernas, [{ nationality: '', dni: { num: '30111222', country: 'ARG' } }]), true);
  assert.equal(alcanzaConDni(piernas, [{ nationality: '', parg: { num: 'AAA111' } }]), true);
});

test('cabotaje con un australiano: no alcanza el DNI', () => {
  const piernas = [{ origen: 'AEP', destino: 'ROS', escalas: [] }];
  assert.equal(alcanzaConDni(piernas, [{ nationality: 'AUS' }]), false);
  assert.equal(alcanzaConDni(piernas, [{ nationality: 'AUS', dni: { num: '1', country: 'ARG' } }]), false);
  assert.equal(alcanzaConDni(piernas, [{ nationality: 'ARG' }, { nationality: 'AUS' }]), false);
  assert.equal(alcanzaConDni(piernas, [{ nationality: '', pext: { country: 'AUS', num: 'P9' } }]), false);
  assert.equal(alcanzaConDni(piernas, []), false);
});

test('EZE-MAD se muestra aunque el pasajero sea argentino', () => {
  assert.equal(alcanzaConDni([{ origen: 'EZE', destino: 'MAD' }], [{ nationality: 'ARG' }]), false);
});
