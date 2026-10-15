import test from 'node:test';
import assert from 'node:assert/strict';
import { PAISES, opcionesPais, nombrePais } from '../public/js/paises.mjs';

test('la lista trae todas las nacionalidades ISO, con Bélgica y sin códigos repetidos', () => {
  const codigos = PAISES.map(p => p.codigo);
  assert.equal(codigos.length, 249);
  assert.equal(new Set(codigos).size, 249);
  assert.ok(codigos.every(c => /^[A-Z]{3}$/.test(c)));
  assert.ok(PAISES.some(p => p.codigo === 'BEL' && p.nombre === 'Bélgica'));
  assert.ok(PAISES.some(p => p.codigo === 'ARG' && p.nombre === 'Argentina'));
});

test('opcionesPais ordena por nombre y puede dejar la primera vacía', () => {
  const todas = opcionesPais();
  assert.equal(todas[0].value, 'ARG');
  assert.equal(todas[1].value !== 'ARG', true);
  const nombres = todas.slice(1).map(o => o.label);
  assert.deepEqual(nombres, [...nombres].sort((a, b) => a.localeCompare(b, 'es')));

  const conVacio = opcionesPais({ vacio: '— No tiene —' });
  assert.equal(conVacio[0].value, '');
  assert.equal(conVacio[0].label, '— No tiene —');
  assert.equal(conVacio[1].value, 'ARG');
});

test('nombrePais devuelve el nombre en español', () => {
  assert.equal(nombrePais('BEL'), 'Bélgica');
  assert.equal(nombrePais('bel'), 'Bélgica');
  assert.equal(nombrePais('ZZZ'), 'ZZZ');
});
