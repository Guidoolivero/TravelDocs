import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nombreAerolinea } from '../public/js/compartido/airlines.mjs';

test('DM es Arajet y AR sigue siendo Aerolíneas Argentinas', () => {
  assert.equal(nombreAerolinea('dm'), 'Arajet');
  assert.equal(nombreAerolinea('AR'), 'Aerolíneas Argentinas');
  assert.equal(nombreAerolinea('FO'), 'Flybondi');
  assert.equal(nombreAerolinea('IB'), 'Iberia');
  assert.equal(nombreAerolinea(''), '');
  assert.equal(nombreAerolinea('1N'), '');
});
