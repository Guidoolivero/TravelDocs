import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapScanToForm, archivosImportacionMasiva, nombresDesdeMrz } from '../public/js/documentos/scanner.js';

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

// Regresion: pasaporte espanol con dos apellidos (SALADINO FERNANDEZ, BALTAZAR).
// El modelo ponia el segundo apellido en "nombre". Manda lo impreso; el MRZ
// ("<<" separa apellido de nombre) solo corrige DONDE se corta, si las
// palabras coinciden. El MRZ corta nombres largos y no tiene acentos.
describe('nombresDesdeMrz', () => {
  const mrz = 'P<ESPSALADINO<FERNANDEZ<<BALTAZAR<<<<<<<<<<<<\nXDF9425085ESP2211020M2807292RE20260617933048';

  it('pasaporte espanol: los dos apellidos van a apellido', () => {
    const d = { apellido: 'SALADINO', nombre: 'FERNANDEZ BALTAZAR', mrz };
    nombresDesdeMrz(d);
    assert.equal(d.apellido, 'SALADINO FERNANDEZ');
    assert.equal(d.nombre, 'BALTAZAR');
  });

  it('conserva los acentos de lo impreso', () => {
    const d = { apellido: 'SALADINO', nombre: 'FERNÁNDEZ BALTAZAR', mrz };
    nombresDesdeMrz(d);
    assert.equal(d.apellido, 'SALADINO FERNÁNDEZ');
    assert.equal(d.nombre, 'BALTAZAR');
  });

  it('tolera espacios que mete el modelo al transcribir el MRZ', () => {
    const d = { apellido: 'SALADINO', nombre: 'FERNANDEZ BALTAZAR', mrz: 'P < ESP SALADINO < FERNANDEZ << BALTAZAR <<<<' };
    nombresDesdeMrz(d);
    assert.equal(d.apellido, 'SALADINO FERNANDEZ');
    assert.equal(d.nombre, 'BALTAZAR');
  });

  it('visa: tambien usa la linea de nombres', () => {
    const d = { apellido: 'GARCIA', nombre: 'LOPEZ ANA MARIA', mrz: 'VNUSAGARCIA<LOPEZ<<ANA<MARIA<<<<<<<<<<<<<<<<<' };
    nombresDesdeMrz(d);
    assert.equal(d.apellido, 'GARCIA LOPEZ');
    assert.equal(d.nombre, 'ANA MARIA');
  });

  it('nombre largo cortado en el MRZ: no pisa lo impreso', () => {
    const d = { apellido: 'RODRIGUEZ DE LA FUENTE', nombre: 'MARIA DE LOS ANGELES', mrz: 'P<ESPRODRIGUEZ<DE<LA<FUENTE<<MARIA<DE<LOS<A' };
    nombresDesdeMrz(d);
    assert.deepEqual([d.apellido, d.nombre], ['RODRIGUEZ DE LA FUENTE', 'MARIA DE LOS ANGELES']);
  });

  it('sin MRZ, sin separador "<<" o con otras palabras: no toca nada', () => {
    for (const m of [undefined, '', 'P<ESPSALADINO<FERNANDEZ<BALTAZAR', 'IDARG12345678<<<<<<<', 'P<ESPPEREZ<<JUAN<<<<']) {
      const d = { apellido: 'SALADINO', nombre: 'BALTAZAR', mrz: m };
      nombresDesdeMrz(d);
      assert.deepEqual([d.apellido, d.nombre], ['SALADINO', 'BALTAZAR'], String(m));
    }
  });
});
