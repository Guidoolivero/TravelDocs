import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSSRStrings } from '../public/js/ssr.js';

// Busca el item de email (CTCE) para el GDS dado
function ctceItem(p, gds) {
  return buildSSRStrings(p, '1', '1', null, { gds }).find(s => s.label.includes('Email'));
}

// Busca el item SRDOCS/DOCS del DNI para el GDS dado (excluye el FOID)
function dniItem(p, gds) {
  return buildSSRStrings(p, '1', '1', null, { gds }).find(s => s.label.includes('DNI') && !s.label.includes('FOID'));
}

const P_DNI_ARG = {
  lastname: 'OLIVERO', firstname: 'GUIDO', dob: '2002-04-16', gender: 'M', nationality: 'ARG',
  dni: { num: '39171901', issue: '2015-03-10', exp: '2035-08-22' }
};

describe('SRDOCS — DNI por pais emisor (dni.country)', () => {
  it('DNI sin country (datos existentes) sigue emitiendo ARG en los 3 GDS', () => {
    assert.equal(dniItem(P_DNI_ARG, 'amadeus').value,
      'SRDOCSYYHK1-I-ARG-39171901-ARG-16APR02-M-22AUG35-OLIVERO-GUIDO/P1');
    assert.equal(dniItem(P_DNI_ARG, 'sabre').value,
      '3DOCS/I/AR/39171901/AR/16APR2002/M/22AUG2035/OLIVERO/GUIDO-1.1');
    assert.equal(dniItem(P_DNI_ARG, 'galileo').value,
      'SI.P1S1/DOCS*I/AR/39171901/ARG/16APR02/M/22AUG35/OLIVERO/GUIDO');
  });

  it('DNI chileno (country CHL, pasajero ARG): CHL en Amadeus, CL en Sabre/Galileo', () => {
    const p = { ...P_DNI_ARG, dni: { ...P_DNI_ARG.dni, country: 'CHL' } };
    assert.equal(dniItem(p, 'amadeus').value,
      'SRDOCSYYHK1-I-CHL-39171901-ARG-16APR02-M-22AUG35-OLIVERO-GUIDO/P1');
    assert.equal(dniItem(p, 'sabre').value,
      '3DOCS/I/CL/39171901/AR/16APR2002/M/22AUG2035/OLIVERO/GUIDO-1.1');
    assert.equal(dniItem(p, 'galileo').value,
      'SI.P1S1/DOCS*I/CL/39171901/ARG/16APR02/M/22AUG35/OLIVERO/GUIDO');
  });

  it('el label del DNI muestra el pais cuando no es ARG', () => {
    const p = { ...P_DNI_ARG, dni: { ...P_DNI_ARG.dni, country: 'CHL' } };
    assert.ok(dniItem(p, 'amadeus').label.includes('CHL'));
    assert.equal(dniItem(P_DNI_ARG, 'amadeus').label.includes('CHL'), false);
  });

  it('SRFOID NI usa el alpha-2 correcto de la nacionalidad (CHL → CL, no CH)', () => {
    const p = { ...P_DNI_ARG, nationality: 'CHL' };
    const foid = buildSSRStrings(p, '1', '1', null, { gds: 'amadeus' }).find(s => s.label.includes('FOID'));
    assert.equal(foid.value, 'SRFOIDYYHK1-NICL39171901/P1');
  });
});

describe('SRDOCS — pasaporte extranjero (string real: pasaporte DEU + nacionalidad ARG)', () => {
  const P_PEXT_DEU = {
    lastname: 'OLIVERO', firstname: 'GUIDO', dob: '2002-04-16', gender: 'M', nationality: 'ARG',
    pext: { country: 'DEU', num: 'C4CKM1ZJV', issue: '2021-10-02', exp: '2031-10-01' }
  };

  it('Amadeus emite pais emisor DEU y nacionalidad ARG (caso real del usuario)', () => {
    const item = buildSSRStrings(P_PEXT_DEU, '1', '1', null, { gds: 'amadeus' })
      .find(s => s.label.includes('Pasaporte DEU'));
    assert.equal(item.value, 'SRDOCSYYHK1-P-DEU-C4CKM1ZJV-ARG-16APR02-M-01OCT31-OLIVERO-GUIDO/P1');
  });

  it('Sabre usa alpha-2 correcto para pais extranjero (CHL → CL, no CH)', () => {
    const p = {
      lastname: 'GOMEZ', firstname: 'PEDRO', dob: '1990-01-05', gender: 'M', nationality: 'CHL',
      pext: { country: 'CHL', num: 'YB6340724', issue: '2020-03-25', exp: '2030-03-25' }
    };
    const item = buildSSRStrings(p, '1', '1', null, { gds: 'sabre' }).find(s => s.label.includes('Pasaporte CHL'));
    assert.equal(item.value, '3DOCS/P/CL/YB6340724/CL/05JAN1990/M/25MAR2030/GOMEZ/PEDRO-1.1');
  });
});

describe('CTCE — codificacion IATA de email (@ → //, _ → .., - → ./)', () => {
  it('guion bajo en Amadeus', () => {
    const item = ctceItem({ email: 'sanmar_33@hotmail.com' }, 'amadeus');
    assert.equal(item.value, 'SRCTCEYYHK1-sanmar..33//hotmail.com/P1');
  });

  it('guion bajo en Sabre', () => {
    const item = ctceItem({ email: 'sanmar_33@hotmail.com' }, 'sabre');
    assert.equal(item.value, '3CTCE/sanmar..33//hotmail.com-1.1');
  });

  it('guion medio se codifica como ./', () => {
    const item = ctceItem({ email: 'juan-perez@mail.com' }, 'amadeus');
    assert.equal(item.value, 'SRCTCEYYHK1-juan./perez//mail.com/P1');
  });

  it('email simple queda igual que antes', () => {
    const item = ctceItem({ email: 'jp@gmail.com' }, 'amadeus');
    assert.equal(item.value, 'SRCTCEYYHK1-jp//gmail.com/P1');
  });

  it('sin email no genera item CTCE', () => {
    assert.equal(ctceItem({}, 'amadeus'), undefined);
  });

  it('email sin @ no genera item CTCE', () => {
    assert.equal(ctceItem({ email: 'sin-arroba.com' }, 'amadeus'), undefined);
  });

  it('Galileo omite CTCE', () => {
    assert.equal(ctceItem({ email: 'sanmar_33@hotmail.com' }, 'galileo'), undefined);
  });
});

describe('CTCM - celular Amadeus', () => {
  it('quita separadores del numero y conserva el prefijo y el pasajero', () => {
    for (const whatsapp of ['549383455-0959', '549383455\u20110959', '549383455\u20130959', '+54 (9) 383.455-0959', '5493834550959']) {
      const item = buildSSRStrings({ whatsapp }, '2', '1', null, { gds: 'amadeus' })
        .find(s => s.label.includes('Celular'));
      assert.equal(item.value, 'SRCTCMYYHK1-5493834550959/P2', whatsapp);
    }
  });
});

describe('nombres compatibles con GDS', () => {
  it('reemplaza apostrofes y guiones por espacio, y quita acentos y enie, en NM y DOCS de todos los GDS', () => {
    const p = { ...P_DNI_ARG, lastname: "D’ÁÑGÉLO", firstname: "José-María" };
    for (const gds of ['amadeus', 'sabre', 'galileo']) {
      const items = buildSSRStrings(p, '1', '1', null, { gds });
      const docs = dniItem(p, gds).value;
      assert.ok(docs.includes('D ANGELO'));
      assert.ok(docs.includes('JOSE MARIA'));
      assert.equal(docs.includes('DANGELO'), false);
      assert.equal(docs.includes('JOSEMARIA'), false);
      assert.equal(items.some(item => /[’'Ññáéíóú]/.test(item.value)), false);
    }
  });
});
