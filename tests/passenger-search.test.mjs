import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesPassenger } from '../public/js/passenger-search.mjs';

test('busca nombre y apellido parcial en cualquier orden y sin acentos', () => {
  const p = { firstname: 'JOSE LUIS', lastname: 'BERALDI' };
  for (const q of ['jose ber', 'BER JOSÉ', '  José   Beraldi  ']) assert.equal(matchesPassenger(p, q), true);
  assert.equal(matchesPassenger(p, 'jose perez'), false);
  assert.equal(matchesPassenger(p, ''), true);
});
test('conserva busqueda por documentos y observaciones sin exigir campos completos', () => {
  assert.equal(matchesPassenger({ dni: { num: '12345678' }, notes: 'Familia Perez' }, '1234 perez'), true);
  assert.equal(matchesPassenger({}, 'jose'), false);
});
