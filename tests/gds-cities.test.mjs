import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromStorage,
  addCity,
  updateCity,
  saveCity,
  editCity,
  removeCity,
  persistable,
  copyValue,
} from '../public/js/ciudades/gds-cities.mjs';

describe('fromStorage', () => {
  it('lista vacia si no hay nada', () => {
    assert.deepEqual(fromStorage(null), []);
    assert.deepEqual(fromStorage([]), []);
  });

  it('tira las celdas vacias de Amadeus/Sabre que se sembraban antes', () => {
    const list = fromStorage([
      { id: 'amadeus', gds: 'amadeus', title: 'Amadeus', code: '' },
      { id: 'sabre', gds: 'sabre', title: 'Sabre', code: '' },
      { id: 'c1', gds: 'amadeus', title: 'Ciudad Ricale', code: 'BUEGS28AA' },
    ]);
    assert.deepEqual(list.map(c => c.id), ['c1']);
    assert.equal(list[0].saved, true);
  });

  it('conserva Amadeus/Sabre si ya tenian codigo', () => {
    const list = fromStorage([
      { id: 'amadeus', gds: 'amadeus', title: 'Amadeus', code: 'BUEGS3236' },
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].code, 'BUEGS3236');
    assert.equal(list[0].saved, true);
  });

  it('gds invalido cae a amadeus', () => {
    const list = fromStorage([{ id: 'c1', gds: 'galileo', title: 'X', code: '1' }]);
    assert.equal(list[0].gds, 'amadeus');
  });
});

describe('addCity / saveCity', () => {
  it('agregar deja un borrador, no persistible', () => {
    const list = addCity([], { id: 'c1', title: 'Ciudad Tower', gds: 'sabre' });
    assert.equal(list.length, 1);
    assert.equal(list[0].saved, false);
    assert.equal(list[0].gds, 'sabre');
    assert.deepEqual(persistable(list), []);
  });

  it('guardar fija titulo, gds y codigo', () => {
    let list = addCity([], { id: 'c1', gds: 'amadeus' });
    list = saveCity(list, 'c1', { title: 'Ciudad Ricale', gds: 'sabre', code: '  8W9I  ' });
    assert.equal(list[0].saved, true);
    assert.equal(list[0].title, 'Ciudad Ricale');
    assert.equal(list[0].gds, 'sabre');
    assert.equal(list[0].code, '8W9I');
    assert.equal(persistable(list).length, 1);
  });

  it('no guarda si falta el titulo', () => {
    let list = addCity([], { id: 'c1', gds: 'amadeus' });
    list = saveCity(list, 'c1', { title: '   ', code: 'X' });
    assert.equal(list[0].saved, false);
  });

  it('editar reabre el formulario y sigue persistible', () => {
    let list = saveCity(addCity([], { id: 'c1' }), 'c1', { title: 'Ricale', code: 'X' });
    list = editCity(list, 'c1');
    assert.equal(list[0].editing, true);
    assert.equal(list[0].saved, true);
    assert.equal(persistable(list).length, 1);
    list = saveCity(list, 'c1', { title: 'Ciudad Ricale', gds: 'sabre', code: 'Y' });
    assert.equal(list[0].editing, false);
    assert.equal(list[0].title, 'Ciudad Ricale');
    assert.equal(list[0].gds, 'sabre');
    assert.equal(list[0].code, 'Y');
  });
});

describe('updateCity / removeCity / copyValue', () => {
  it('updateCity cambia el codigo de una fija', () => {
    let list = saveCity(addCity([], { id: 'c1', title: 'Ricale' }), 'c1', { title: 'Ricale', code: 'A' });
    list = updateCity(list, 'c1', { code: 'BUEGS28AA' });
    assert.equal(list[0].code, 'BUEGS28AA');
    assert.equal(list[0].saved, true);
  });

  it('borra cualquiera', () => {
    let list = saveCity(addCity([], { id: 'c1', title: 'Tower' }), 'c1', { title: 'Tower' });
    list = removeCity(list, 'c1');
    assert.deepEqual(list, []);
  });

  it('copia el codigo', () => {
    const list = saveCity(addCity([], { id: 'c1', title: 'X' }), 'c1', { title: 'X', code: '  8W9I  ' });
    assert.equal(copyValue(list, 'c1'), '8W9I');
    assert.equal(copyValue(list, 'nope'), '');
  });
});
