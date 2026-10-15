import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapScanToForm, archivosImportacionMasiva } from '../public/js/scanner.js';

// Regresión del bug "DNI chileno lo tomaba como pasaporte": un DNI/cédula de
// cualquier país va a la sección DNI con su país emisor; solo un PASAPORTE
// (tipo PASAPORTE de Gemini) va a parg/pext.
describe('mapScanToForm — tipo DNI vs PASAPORTE', () => {
  it('cédula chilena (tipo DNI, pais CHL) → sección DNI con country CHL, no pasaporte', () => {
    const mapped = mapScanToForm({
      tipo: 'DNI', apellido: 'MORALES', nombre: 'CAMILA',
      numero: '18.452.987-3', numero_dni: '18452987',
      pais_emisor: 'CHL', nacionalidad: 'CHL',
      fecha_emision: '2020-05-10', fecha_vencimiento: '2030-05-10'
    });
    assert.equal(mapped.doc_type, 'dni');
    assert.equal(mapped.dni.country, 'CHL');
    assert.equal(mapped.dni.num, '18452987');
    assert.equal(mapped.pext, undefined);
  });

  it('DNI argentino (pais vacío) → sección DNI con country ARG', () => {
    const mapped = mapScanToForm({
      tipo: 'DNI', numero: '39171901', nacionalidad: 'ARG',
      fecha_vencimiento: '2035-08-22'
    });
    assert.equal(mapped.doc_type, 'dni');
    assert.equal(mapped.dni.country, 'ARG');
  });

  it('DNI español (tipo DNI, pais ESP) → DNI con country ESP, no pasaporte', () => {
    const mapped = mapScanToForm({
      tipo: 'DNI', numero: '12345678Z', pais_emisor: 'ESP', nacionalidad: 'ESP'
    });
    assert.equal(mapped.doc_type, 'dni');
    assert.equal(mapped.dni.country, 'ESP');
    assert.equal(mapped.pext, undefined);
  });

  it('pasaporte extranjero (tipo PASAPORTE, pais DEU) → sigue yendo a pext', () => {
    const mapped = mapScanToForm({
      tipo: 'PASAPORTE', numero_pasaporte: 'C4CKM1ZJV',
      pais_emisor: 'DEU', nacionalidad: 'DEU'
    });
    assert.equal(mapped.doc_type, 'pext');
    assert.equal(mapped.pext.country, 'DEU');
  });

  it('pasaporte argentino (tipo PASAPORTE, pais ARG) → parg + dni si viene numero_dni', () => {
    const mapped = mapScanToForm({
      tipo: 'PASAPORTE', numero_pasaporte: 'AAI204554',
      numero_dni: '39171901', pais_emisor: 'ARG', nacionalidad: 'ARG'
    });
    assert.equal(mapped.doc_type, 'parg');
    assert.equal(mapped.dni.num, '39171901');
  });

  it('visa (tipo VISA) → sigue yendo a la sección visa', () => {
    const mapped = mapScanToForm({
      tipo: 'VISA', numero: 'V4784660', pais_destino_visa: 'USA', tipo_visa: 'T'
    });
    assert.equal(mapped.doc_type, 'visa');
    assert.equal(mapped.visa.country, 'USA');
  });
});

describe('mapScanToForm — viajero frecuente', () => {
  it('captura ConnectMiles: solo aerolínea CM y número, sin tocar el nombre', () => {
    const mapped = mapScanToForm({
      tipo: 'FFN',
      apellido: 'ROSENDE',
      nombre: 'RODOLFO',
      aerolinea: 'CM',
      numero: '101212593'
    });
    assert.equal(mapped.doc_type, 'ffn');
    assert.deepEqual(mapped.ffn, { airline: 'CM', number: '101212593' });
    assert.equal(mapped.lastname, undefined);
    assert.equal(mapped.firstname, undefined);
  });

  it('si viene el nombre del programa, lo pasa al código de la ficha', () => {
    const mapped = mapScanToForm({
      tipo: 'FFN',
      aerolinea: 'ConnectMiles (Copa Airlines)',
      numero: '101 212 593'
    });
    assert.deepEqual(mapped.ffn, { airline: 'CM', number: '101212593' });
  });

  it('sin número no arma la fila', () => {
    const mapped = mapScanToForm({ tipo: 'FFN', aerolinea: 'CM', numero: '' });
    assert.equal(mapped.ffn, undefined);
  });

  it('cualquier código IATA arma la fila, aunque el programa no esté en la lista', () => {
    const mapped = mapScanToForm({ tipo: 'FFN', aerolinea: 'QF', numero: '998877' });
    assert.deepEqual(mapped.ffn, { airline: 'QF', number: '998877' });
  });

  it('saca el código de una aerolínea que no está en la lista', () => {
    const mapped = mapScanToForm({
      tipo: 'FFN',
      aerolinea: 'Qantas Frequent Flyer (QF)',
      numero: '998877'
    });
    assert.equal(mapped.ffn.airline, 'QF');
  });

  it('Smiles es Gol y Azul Fidelidade es Azul', () => {
    assert.equal(mapScanToForm({ tipo: 'FFN', aerolinea: 'Smiles', numero: '123' }).ffn.airline, 'G3');
    assert.equal(mapScanToForm({ tipo: 'FFN', aerolinea: 'Azul Fidelidade', numero: '456' }).ffn.airline, 'AD');
    assert.equal(mapScanToForm({ tipo: 'FFN', aerolinea: 'TudoAzul', numero: '789' }).ffn.airline, 'AD');
  });
});

describe('archivosImportacionMasiva', () => {
  const MB = 1024 * 1024;
  const archivo = (type, size, name) => ({ type, size, name });

  it('se queda con imagenes de hasta 4 MB y PDF de hasta 20 MB', () => {
    const files = [
      archivo('image/jpeg', 3 * MB, 'foto.jpg'),
      archivo('image/png', 4 * MB, 'visa.png'),
      archivo('image/webp', 4 * MB + 1, 'grande.webp'),
      archivo('application/pdf', 19 * MB, 'pasaporte.pdf'),
      archivo('application/pdf', 20 * MB + 1, 'pesado.pdf'),
      archivo('text/plain', 100, 'nota.txt'),
    ];
    assert.deepEqual(
      archivosImportacionMasiva(files).map(f => f.name),
      ['foto.jpg', 'visa.png', 'pasaporte.pdf']
    );
  });
});
