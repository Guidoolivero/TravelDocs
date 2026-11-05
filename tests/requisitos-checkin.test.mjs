import test from 'node:test';
import assert from 'node:assert/strict';
import { debeEnviarRequisitos, emailAviso, buildRequisitosEmail, marcasTrasEnvioRequisitos } from '../lib/requisitos-checkin.mjs';

const ahora = Date.parse('2026-09-29T12:00:00-03:00');

test('el email identifica los nombres del itinerario pendientes de vincular sin asumir documentos', () => {
  const r = reserva('2026-10-05T12:00', { pasajeros: [], pendingPassengers: [{ lastname: 'BERALDI', firstname: 'JOSE' }] });
  const mail = buildRequisitosEmail({ reserva: r, now: ahora });
  assert.match(mail.html, /BERALDI/);
  assert.match(mail.html, /pendiente de vincular/i);
});

function reserva(fecha, extra = {}) {
  return {
    alertEmail: '',
    reqsNotified: false,
    piernas: [{
      fecha,
      vuelo: 'IB6841',
      origen: 'EZE',
      destino: 'MAD',
      escalas: [],
      compania: 'IB',
      reservaVuelo: 'KRBJJ',
    }],
    ...extra,
  };
}

const garcia = {
  id: 'p1',
  lastname: 'GARCIA',
  firstname: 'JUAN',
  parg: { num: 'AAA111' },
  pext: { country: 'BEL', num: 'BB222' },
};

test('email del check-in: el del agente si está cargado, si no el de la agencia', () => {
  assert.equal(emailAviso('agente@agencia.com', 'alertas@agencia.com'), 'agente@agencia.com');
  assert.equal(emailAviso('  ', 'alertas@agencia.com'), 'alertas@agencia.com');
  assert.equal(emailAviso('', ''), '');
});

test('creado el 29 sep para viajar el 15 oct: un solo aviso, el de la creación', () => {
  const r = reserva('2026-10-15T09:00', { createdAt: { toMillis: () => ahora } });
  assert.equal(debeEnviarRequisitos(r, { alCrear: true, now: ahora }), true);
  r.reqsNotified = true;
  assert.equal(debeEnviarRequisitos(r, { alCrear: false, now: ahora }), false);
  assert.equal(debeEnviarRequisitos(r, { alCrear: true, now: ahora }), false);
});

test('cargado el 15 ene para viajar el 15 sep: mail al crear y otro cuando faltan 30 días', () => {
  const enero = Date.parse('2026-01-15T12:00:00-03:00');
  const unDiaAntes = Date.parse('2026-08-15T09:00:00-03:00');
  const agosto = Date.parse('2026-08-16T09:00:00-03:00');
  const r = reserva('2026-09-15T09:00', { createdAt: { toMillis: () => enero } });
  assert.equal(debeEnviarRequisitos(r, { alCrear: true, now: enero }), true);
  r.reqsNotified = true;
  assert.equal(debeEnviarRequisitos(r, { alCrear: false, now: enero }), false);
  assert.equal(debeEnviarRequisitos(r, { alCrear: false, now: unDiaAntes }), false);
  assert.equal(debeEnviarRequisitos(r, { alCrear: false, now: agosto }), true);
  r.reqs30Notified = true;
  assert.equal(debeEnviarRequisitos(r, { alCrear: false, now: agosto }), false);
});

test('el alta adentro de los 30 días marca los dos avisos; el alta de enero solo el primero', () => {
  const corto = reserva('2026-10-15T09:00');
  assert.deepEqual(marcasTrasEnvioRequisitos(corto, { alCrear: true, now: ahora }), {
    reqsNotified: true,
    reqs30Notified: true,
  });
  const lejos = reserva('2026-12-15T09:00');
  assert.deepEqual(marcasTrasEnvioRequisitos(lejos, { alCrear: true, now: ahora }), {
    reqsNotified: true,
  });
  assert.deepEqual(marcasTrasEnvioRequisitos(lejos, { alCrear: false, now: ahora }), {
    reqs30Notified: true,
  });
});

test('si el alta no pudo avisar y el viaje ya está a menos de 30 días, el cron lo manda', () => {
  const r = reserva('2026-10-15T09:00');
  assert.equal(debeEnviarRequisitos(r, { alCrear: false, now: ahora }), true);
});

test('lejos de los 30 días el cron no avisa; el alta sí', () => {
  const r = reserva('2026-12-15T09:00');
  assert.equal(debeEnviarRequisitos(r, { alCrear: false, now: ahora }), false);
  assert.equal(debeEnviarRequisitos(r, { alCrear: true, now: ahora }), true);
});

function cabotaje(fecha = '2026-10-15T09:00') {
  return {
    reqsNotified: false,
    piernas: [
      { fecha, vuelo: 'AR1680', origen: 'AEP', destino: 'ROS', escalas: [], reservaVuelo: 'ABCDE' },
      { fecha: '2026-10-18T18:00', vuelo: 'AR1681', origen: 'ROS', destino: 'AEP', escalas: [], reservaVuelo: 'ABCDE' },
    ],
  };
}

test('cabotaje con argentinos no manda el mail de requisitos', () => {
  const r = cabotaje();
  const pax = [{ nationality: 'ARG', dni: { num: '30111222', country: 'ARG' } }];
  assert.equal(debeEnviarRequisitos(r, { alCrear: true, now: ahora, pasajeros: pax }), false);
  assert.equal(debeEnviarRequisitos(r, { alCrear: false, now: ahora, pasajeros: pax }), false);
});

test('cabotaje con un australiano sí avisa, sin inventar una visa', () => {
  const r = cabotaje();
  const aus = { id: 'a1', lastname: 'SMITH', firstname: 'ANNE', nationality: 'AUS', pext: { country: 'AUS', num: 'P9' } };
  const arg = { id: 'a2', lastname: 'GARCIA', firstname: 'JUAN', nationality: 'ARG', dni: { num: '30111222', country: 'ARG' } };
  assert.equal(debeEnviarRequisitos(r, { alCrear: true, now: ahora, pasajeros: [aus] }), true);
  assert.equal(debeEnviarRequisitos(r, { alCrear: true, now: ahora, pasajeros: [arg, aus] }), true);
  const { subject, html } = buildRequisitosEmail({ reserva: r, pasajeros: [arg, aus] });
  assert.match(subject, /cabotaje/);
  assert.match(html, /Vuelo de cabotaje/);
  assert.match(html, /SMITH, ANNE/);
  assert.match(html, /Viaja con pasaporte, no con DNI argentino/);
  assert.match(html, /GARCIA, JUAN/);
  assert.match(html, /Viaja con DNI/);
  assert.equal(/requiere visa|No requiere visa|Schengen|Libre circulación/i.test(html), false);
});

test('ida EZE-MAD con pasaporte argentino y belga: España, las dos lecturas juntas', () => {
  const { subject, html } = buildRequisitosEmail({
    appName: 'TravelDocs',
    reserva: reserva('2026-10-15T09:00'),
    pasajeros: [garcia],
  });
  assert.match(subject, /para este destino/);
  assert.match(html, /España \(MAD\)/);
  assert.equal(html.includes('Argentina (EZE)'), false);
  assert.match(html, /GARCIA, JUAN/);
  assert.match(html, /IB6841/);
  assert.match(html, /EZE &rarr; MAD/);
  assert.match(html, /font-weight:bold/);
  assert.match(html, /#f0ece4/);
  assert.match(html, /KRBJJ/);
  assert.match(html, /Pasajero GARCIA, JUAN/);
  assert.match(html, /Usted tiene Pasaporte argentino y Pasaporte de Bélgica/);
  assert.match(html, /Pasaporte argentino/);
  assert.match(html, /No requiere visa/);
  assert.match(html, /Schengen/);
  assert.match(html, /Pasaporte de Bélgica/);
  assert.match(html, /Libre circulación/);
  const arg = html.indexOf('Pasaporte argentino');
  const bel = html.indexOf('Pasaporte de Bélgica');
  assert.ok(arg > -1 && bel > arg);
});

test('belga a Estados Unidos sale como autorización electrónica', () => {
  const { html } = buildRequisitosEmail({
    appName: 'TravelDocs',
    reserva: reserva('2026-10-15T09:00', {
      piernas: [{ fecha: '2026-10-15T09:00', vuelo: 'AA908', origen: 'EZE', destino: 'MIA', escalas: [], reservaVuelo: 'KRBJJ' }],
    }),
    pasajeros: [{ id: 'p1', lastname: 'GARCIA', firstname: 'JUAN', pext: { country: 'BEL', num: 'BB' } }],
  });
  assert.match(html, /Estados Unidos \(MIA\)/);
  assert.match(html, /Autorización electrónica de viaje \(ETA\)/);
});

test('pasaporte japonés no inventa una visa', () => {
  const { html } = buildRequisitosEmail({
    appName: 'TravelDocs',
    reserva: reserva('2026-10-15T09:00'),
    pasajeros: [{ id: 'p1', lastname: 'SATO', firstname: 'KEN', pext: { country: 'JPN', num: 'JJ' } }],
  });
  assert.match(html, /no tiene datos de este pasaporte/);
  assert.equal(/Requiere visa/.test(html), false);
});

test('sin pasaporte lo dice y no arma requisitos', () => {
  const { html } = buildRequisitosEmail({
    appName: 'TravelDocs',
    reserva: reserva('2026-10-15T09:00'),
    pasajeros: [{ id: 'p1', lastname: 'GARCIA', firstname: 'JUAN' }],
  });
  assert.match(html, /No tiene pasaporte cargado/);
  assert.equal(html.includes('Pasaporte argentino'), false);
});

test('PUJ con pasaporte argentino separa la exención del formulario de Migración', () => {
  const { html } = buildRequisitosEmail({
    appName: 'TravelDocs',
    reserva: reserva('2026-10-15T09:00', {
      piernas: [{ fecha: '2026-10-15T09:00', vuelo: 'AR', origen: 'EZE', destino: 'PUJ', escalas: [], reservaVuelo: 'ABCDE' }],
    }),
    pasajeros: [
      { id: 'p1', lastname: 'IBARGUEN', firstname: 'ANA', gender: 'F', parg: { num: '1' } },
      { id: 'p2', lastname: 'LUCAS', firstname: 'JUAN', gender: 'M', parg: { num: '2' } },
    ],
  });
  assert.match(html, /República Dominicana \(PUJ\)/);
  assert.match(html, /No requiere visa ni tarjeta de turista \(categoría B\)\./);
  assert.equal(html.includes('No requiere visa. No requiere visa'), false);
  assert.equal(html.includes('E-Ticket obligatorio'), false);
  assert.match(html, /Ingreso/);
  assert.match(html, /Formulario electrónico de entrada y salida \(E-Ticket de Migración\)/);
  assert.match(html, /Obligatorio para ingresar y salir/);
  assert.match(html, /https:\/\/eticket\.migracion\.gob\.do\//);
  assert.equal((html.match(/eticket\.migracion\.gob\.do/g) || []).length, 1);
});

test('China conserva la tarjeta de llegada aunque haya una ficha vacia con el mismo codigo', () => {
  const { html } = buildRequisitosEmail({
    reserva: reserva('2026-11-02T10:00', {
      piernas: [{ fecha: '2026-11-02T10:00', vuelo: 'XX1', origen: 'EZE', destino: 'PVG', escalas: [], reservaVuelo: 'ABCDE' }],
    }),
    pasajeros: [{ id: 'a', lastname: 'GARCIA', firstname: 'JUAN', parg: { num: '1' } }],
  });
  assert.match(html, /Destino China \(PVG\)/);
  assert.match(html, />Ingreso</);
  assert.match(html, /Tarjeta de Llegada a China \(digital\)/);
  assert.match(html, /https:\/\/s\.nia\.gov\.cn\/ArrivalCardFillingPC\//);
});

test('la tarjeta de ingreso del destino sale en el mail: ED Card en Aruba y NZeTA en Nueva Zelanda', () => {
  const arg = { id: 'a', lastname: 'CIGNETTI', firstname: 'MARIA', gender: 'F', parg: { num: 'AAA' } };
  const { html } = buildRequisitosEmail({
    reserva: reserva('2026-10-13T21:00', {
      piernas: [
        { fecha: '2026-10-13T21:00', vuelo: 'UA818', origen: 'EZE', destino: 'IAH', escalas: [], reservaVuelo: 'PGRY3J' },
        { fecha: '2026-10-19T14:10', vuelo: 'UA410', origen: 'IAH', destino: 'MIA', escalas: [], reservaVuelo: 'PGRY3J' },
        { fecha: '2026-10-26T14:10', vuelo: 'AA2217', origen: 'MIA', destino: 'AUA', escalas: [], reservaVuelo: 'KRKEPA' },
        { fecha: '2026-10-31T09:45', vuelo: 'AR1375', origen: 'AUA', destino: 'EZE', escalas: [], reservaVuelo: 'KTISPF' },
      ],
    }),
    pasajeros: [arg],
  });
  const usa = html.slice(html.indexOf('Estados Unidos'), html.indexOf('Aruba'));
  const aruba = html.slice(html.indexOf('Aruba'));
  assert.equal(/ED Card/.test(usa), false);
  assert.match(aruba, />Ingreso</);
  assert.match(aruba, /Aruba ED Card \(Embarkation\/Disembarkation Card\)/);
  assert.match(aruba, /https:\/\/edcardaruba\.aw\/welcome/);
  assert.equal((aruba.match(/edcardaruba\.aw/g) || []).length, 1);

  const nz = buildRequisitosEmail({
    reserva: reserva('2026-11-02T22:00', {
      piernas: [{ fecha: '2026-11-02T22:00', vuelo: 'LA801', origen: 'EZE', destino: 'AKL', escalas: [], reservaVuelo: 'NZETA1' }],
    }),
    pasajeros: [arg],
  }).html;
  assert.match(nz, /Nueva Zelanda \(AKL\)/);
  assert.match(nz, />Ingreso</);
  assert.match(nz, /NZeTA \(New Zealand Electronic Travel Authority\)/);
  assert.match(nz, /https:\/\/www\.immigration\.govt\.nz\/new-zealand-visas\/visas\/visa\/nzeta/);

  const py = buildRequisitosEmail({
    reserva: reserva('2026-11-02T22:00', {
      piernas: [{ fecha: '2026-11-02T22:00', vuelo: 'LA801', origen: 'EZE', destino: 'AKL', escalas: [], reservaVuelo: 'NZETA1' }],
    }),
    pasajeros: [{ id: 'p', lastname: 'GOMEZ', firstname: 'LUIS', pext: { country: 'PRY', num: 'PP' } }],
  }).html;
  assert.equal(py.includes('>Ingreso<'), false);

  const mixto = buildRequisitosEmail({
    reserva: reserva('2026-11-02T22:00', {
      piernas: [{ fecha: '2026-11-02T22:00', vuelo: 'LA801', origen: 'EZE', destino: 'AKL', escalas: [], reservaVuelo: 'NZETA1' }],
    }),
    pasajeros: [arg, { id: 'p', lastname: 'GOMEZ', firstname: 'LUIS', pext: { country: 'PRY', num: 'PP' } }],
  }).html;
  assert.equal(mixto.includes('>Ingreso<'), false);
  assert.match(mixto, /NZeTA/);
});

test('la vuelta a Argentina no se explica: es el país del que salieron y la base no lo tiene', () => {
  const { subject, html } = buildRequisitosEmail({
    appName: 'TravelDocs',
    reserva: reserva('2026-10-15T09:00', {
      piernas: [
        { fecha: '2026-10-15T09:00', vuelo: 'IB6841', origen: 'EZE', destino: 'MAD', escalas: [], reservaVuelo: 'KRBJJ' },
        { fecha: '2026-10-22T21:00', vuelo: 'IB6842', origen: 'MAD', destino: 'EZE', escalas: [], reservaVuelo: 'KRBJJ' },
      ],
    }),
    pasajeros: [garcia],
  });
  assert.match(subject, /para este destino/);
  assert.match(html, /Destino España \(MAD\)/);
  assert.match(html, /Sale de Argentina\./);
  assert.equal(html.includes('Destino Argentina'), false);
  assert.equal(html.includes('Argentina (EZE)'), false);
  assert.equal(html.includes('La base no tiene este destino'), false);
});

test('escala se suma al destino', () => {
  const { html } = buildRequisitosEmail({
    appName: 'TravelDocs',
    reserva: reserva('2026-10-15T09:00', {
      piernas: [{ fecha: '2026-10-15T09:00', vuelo: 'IB', origen: 'EZE', destino: 'MAD', escalas: ['LIS'], reservaVuelo: 'KRBJJ' }],
    }),
    pasajeros: [garcia],
  });
  assert.match(html, /España \(MAD\)/);
  assert.match(html, /Portugal \(LIS\)/);
});

test('un código que no está en el mapa se nombra y el resto sigue', () => {
  const { html } = buildRequisitosEmail({
    appName: 'TravelDocs',
    reserva: reserva('2026-10-15T09:00', {
      piernas: [{ fecha: '2026-10-15T09:00', vuelo: 'XX', origen: 'EZE', destino: 'ZZZ', escalas: [], reservaVuelo: 'KRBJJ' }],
    }),
    pasajeros: [garcia],
  });
  assert.match(html, /No identificamos el país de ZZZ/);
});

test('dos pasajeros al mismo destino: un texto por pasaporte, y el belga solo de ella', () => {
  const mirtha = {
    id: 'm', lastname: 'GLATIGNY', firstname: 'MIRTHA ELENA', gender: 'F',
    parg: { num: '1' }, pext: { country: 'BEL', num: '2' },
  };
  const roberto = {
    id: 'r', lastname: 'HERRERO', firstname: 'ROBERTO OSCAR', gender: 'M',
    parg: { num: '3' },
  };
  const { subject, html } = buildRequisitosEmail({
    appName: 'Trading Travel',
    reserva: {
      piernas: [
        { fecha: '2027-05-07T15:05', vuelo: 'KL702', origen: 'EZE', destino: 'AMS', escalas: [], reservaVuelo: 'AY2K9Z' },
        { fecha: '2027-05-15T03:10', vuelo: 'KL1511', origen: 'AMS', destino: 'BCN', escalas: [], reservaVuelo: 'AY2K9Z' },
        { fecha: '2027-05-29T12:10', vuelo: 'KL1506', origen: 'MAD', destino: 'AMS', escalas: [], reservaVuelo: 'AY2K9Z' },
        { fecha: '2027-06-10T16:10', vuelo: 'KL701', origen: 'AMS', destino: 'EZE', escalas: [], reservaVuelo: 'AY2K9Z' },
      ],
    },
    pasajeros: [mirtha, roberto],
    alCrear: true,
    now: Date.parse('2026-10-02T12:00:00-03:00'),
  });
  assert.match(subject, /para estos destinos/);
  assert.match(html, /Pasajera GLATIGNY, MIRTHA ELENA/);
  assert.match(html, /Usted tiene Pasaporte argentino y Pasaporte de Bélgica/);
  assert.match(html, /Pasajero HERRERO, ROBERTO OSCAR/);
  assert.match(html, /Usted tiene Pasaporte argentino\./);
  assert.match(html, /Destinos Países Bajos \(AMS\) y España \(BCN, MAD\)/);
  assert.match(html, /Pasaporte argentino\. Lo tienen los dos\./);
  assert.match(html, /Pasaporte de Bélgica\. Solo la pasajera GLATIGNY\./);
  assert.equal((html.match(/Schengen/g) || []).length, 1);
  assert.equal((html.match(/Libre circulación/g) || []).length, 1);
  assert.match(html, /Sanidad\. Igual para los dos pasaportes\./);
  assert.match(html, /Sale de Argentina\./);
  assert.equal(html.includes('Destino Argentina'), false);
  assert.equal(html.includes('Argentina (EZE)'), false);
  assert.match(html, /KL1511<\/span> &middot; AMS &rarr; BCN &middot; 15 may 2027, 03:10 &middot; Reserva AY2K9Z/);
  assert.match(html, /Ser profesional tiene sus privilegios/);
  const aviso = html.indexOf('privilegios');
  const titulo = html.indexOf('Requisitos migratorios');
  assert.ok(aviso > -1 && aviso < titulo);
});

test('el mail de requisitos, al crear y a los 30 días, cierra con las dos leyendas', () => {
  const creado = buildRequisitosEmail({
    reserva: reserva('2027-05-15T09:00'),
    pasajeros: [garcia],
    alCrear: true,
    now: Date.parse('2026-10-02T12:00:00-03:00'),
  });
  const cron = buildRequisitosEmail({
    reserva: reserva('2026-10-15T09:00'),
    pasajeros: [garcia],
    alCrear: false,
    now: ahora,
  });
  for (const { html } of [creado, cron]) {
    const leyendas = html.indexOf('Aviso legal');
    const pie = html.indexOf('Enviado automáticamente');
    assert.ok(html.indexOf('Requisitos migratorios') < leyendas);
    assert.ok(leyendas < pie);
    assert.match(html, /Datos orientativos — verificar antes de emitir\./);
    assert.match(html, /La información se facilita únicamente como guía\./);
    assert.match(html, /Confirmá siempre con fuentes oficiales del gobierno antes de emitir\./);
  }
});

test('el aviso de los 30 días no promete otro mail si ese ya es el único o es el segundo', () => {
  const ahoraLejos = Date.parse('2026-10-02T12:00:00-03:00');
  const lejos = reserva('2027-05-15T09:00');
  const cron = buildRequisitosEmail({
    reserva: lejos, pasajeros: [garcia], alCrear: false, now: ahoraLejos,
  });
  assert.equal(cron.html.includes('privilegios'), false);
  const corto = buildRequisitosEmail({
    reserva: reserva('2026-10-15T09:00'), pasajeros: [garcia], alCrear: true, now: ahoraLejos,
  });
  assert.equal(corto.html.includes('privilegios'), false);
});

test('una pasajera: el sexo de la ficha y un solo destino en singular', () => {
  const sofia = {
    id: 's', lastname: 'HERRERO GLATIGNY', firstname: 'SOFIA MARIA', gender: 'F',
    parg: { num: '1' }, pext: { country: 'NLD', num: '2' },
  };
  const { html } = buildRequisitosEmail({
    appName: 'Trading Travel',
    reserva: {
      piernas: [
        { fecha: '2027-05-15T03:10', vuelo: 'KL1511', origen: 'AMS', destino: 'BCN', escalas: [], reservaVuelo: 'AO2XN5' },
        { fecha: '2027-05-29T12:10', vuelo: 'KL1506', origen: 'MAD', destino: 'AMS', escalas: [], reservaVuelo: 'AO2XN5' },
      ],
    },
    pasajeros: [sofia],
  });
  assert.match(html, /Pasajera HERRERO GLATIGNY, SOFIA MARIA/);
  assert.match(html, /Usted tiene Pasaporte argentino y Pasaporte de Países Bajos/);
  assert.match(html, /Destino España \(BCN, MAD\)/);
  assert.match(html, /Sale de Países Bajos\./);
  assert.match(html, /Destino Países Bajos \(AMS\)/);
  assert.match(html, /Sale de España\./);
  assert.equal(html.includes('Lo tienen los dos'), false);
  assert.equal(html.includes('Solo la pasajera'), false);
});

test('la sanidad de Guatemala sale del país de donde sale, la visa del pasaporte', () => {
  const usa = { id: 'u', lastname: 'SMITH', firstname: 'ANN', pext: { country: 'USA', num: 'P1' } };
  const vuelo = (origen) => reserva('2026-10-15T09:00', {
    piernas: [{ fecha: '2026-10-15T09:00', vuelo: 'XX', origen, destino: 'GUA', escalas: [], reservaVuelo: 'ABCDE' }],
  });
  const desdeChile = [
    buildRequisitosEmail({ reserva: vuelo('SCL'), pasajeros: [usa], alCrear: true, now: ahora }),
    buildRequisitosEmail({ reserva: vuelo('SCL'), pasajeros: [usa], alCrear: false, now: ahora }),
  ];
  for (const { html } of desdeChile) {
    assert.match(html, /Guatemala \(GUA\)/);
    assert.match(html, /No requiere visa\. Categoria A, exenta, 90 dias\./);
    assert.match(html, /Sale de Chile\./);
    assert.match(html, /Chile no es pais de riesgo/);
    assert.equal(/para esta nacionalidad/.test(html), false);
    assert.equal(/Paraguay en lista OMS/.test(html), false);
  }
  const { html } = buildRequisitosEmail({ reserva: vuelo('ASU'), pasajeros: [usa] });
  assert.match(html, /No requiere visa\. Categoria A, exenta, 90 dias\./);
  assert.match(html, /Sale de Paraguay\./);
  assert.match(html, /Paraguay en lista OMS de riesgo/);
  assert.equal(/no confirma el visado/.test(html), false);
  assert.equal(/Chile no es pais de riesgo/.test(html), false);
});

test('pasaporte argentino: Asunción exige el certificado y Ezeiza deja la celda de Argentina', () => {
  const arg = { id: 'a', lastname: 'GARCIA', firstname: 'JUAN', parg: { num: 'AAA111' } };
  const vuelo = (origen) => reserva('2026-10-15T09:00', {
    piernas: [{ fecha: '2026-10-15T09:00', vuelo: 'XX', origen, destino: 'GUA', escalas: [], reservaVuelo: 'ABCDE' }],
  });
  const asu = buildRequisitosEmail({ reserva: vuelo('ASU'), pasajeros: [arg] }).html;
  assert.match(asu, /No requiere visa \(Categoria A\)\. Solo pasaporte valido/);
  assert.match(asu, /Sale de Paraguay\./);
  assert.match(asu, /Paraguay en lista OMS de riesgo/);
  assert.equal(/Misiones/.test(asu), false);
  const eze = buildRequisitosEmail({ reserva: vuelo('EZE'), pasajeros: [arg] }).html;
  assert.match(eze, /Sale de Argentina\./);
  assert.match(eze, /Misiones\/Corrientes/);
  assert.match(eze, /No está confirmado/);
  assert.match(eze, /No exime a Buenos Aires ni a EZE/);
  assert.match(eze, /no publica esa excepción/);
  assert.equal(/Paraguay en lista OMS/.test(eze), false);
});

test('una escala en un país que exige gana a la salida que no exige', () => {
  const usa = { id: 'u', lastname: 'SMITH', firstname: 'ANN', pext: { country: 'USA', num: 'P1' } };
  const { html } = buildRequisitosEmail({
    reserva: reserva('2026-10-15T09:00', {
      piernas: [{ fecha: '2026-10-15T09:00', vuelo: 'XX', origen: 'SCL', destino: 'GUA', escalas: ['ASU'], reservaVuelo: 'ABCDE' }],
    }),
    pasajeros: [usa],
  });
  assert.match(html, /No requiere visa\. Categoria A, exenta, 90 dias\./);
  assert.match(html, /Destino Guatemala \(GUA\)/);
  const guatemala = html.slice(html.indexOf('Destino Guatemala'));
  assert.match(guatemala, /Sale de Chile\./);
  assert.match(guatemala, /sin horario de llegada y salida/);
  assert.match(guatemala, /No se inventa la duracion/);
  assert.equal(/Paraguay en lista OMS de riesgo/.test(guatemala), false);
});

test('sin columna para el país de salida no se dice que está exento', () => {
  const jap = { id: 'j', lastname: 'SATO', firstname: 'KEN', pext: { country: 'JPN', num: 'JJ' } };
  const { html } = buildRequisitosEmail({
    reserva: reserva('2026-10-15T09:00', {
      piernas: [{ fecha: '2026-10-15T09:00', vuelo: 'XX', origen: 'NRT', destino: 'GUA', escalas: ['SCL'], reservaVuelo: 'ABCDE' }],
    }),
    pasajeros: [jap],
  });
  assert.match(html, /Guatemala \(GUA\)/);
  assert.match(html, /La base no tiene sanidad para la salida desde Japón\./);
  assert.equal(/Chile no es pais de riesgo/.test(html), false);
  assert.equal(/para esta nacionalidad/.test(html), false);
});

test('Aruba lee la fiebre amarilla de la fila, segun el pais de salida', () => {
  const arg = { id: 'a', lastname: 'GARCIA', firstname: 'JUAN', parg: { num: 'AAA111' } };
  const usa = { id: 'u', lastname: 'SMITH', firstname: 'ANN', pext: { country: 'USA', num: 'P1' } };
  const vuelo = (origen, destino) => reserva('2026-10-15T09:00', {
    piernas: [{ fecha: '2026-10-15T09:00', vuelo: 'XX', origen, destino, escalas: [], reservaVuelo: 'ABCDE' }],
  });
  const asu = buildRequisitosEmail({
    reserva: vuelo('ASU', 'AUA'), pasajeros: [arg], alCrear: true, now: ahora,
  }).html;
  const asu30 = buildRequisitosEmail({
    reserva: vuelo('ASU', 'AUA'), pasajeros: [arg], alCrear: false, now: ahora,
  }).html;
  for (const html of [asu, asu30]) {
    assert.match(html, /Aruba \(AUA\)/);
    assert.match(html, /No requiere visa, 90 dias en 180/);
    assert.match(html, /Sale de Paraguay\./);
    assert.match(html, /Certificado EXIGIDO/);
    assert.equal(/1 de febrero de 2019/.test(html), false);
  }
  const eze = buildRequisitosEmail({ reserva: vuelo('EZE', 'AUA'), pasajeros: [arg] }).html;
  assert.match(eze, /Sale de Argentina\./);
  assert.match(eze, /1 de febrero de 2019/);
  assert.equal(/Certificado EXIGIDO/.test(eze), false);
  const chile = buildRequisitosEmail({ reserva: vuelo('SCL', 'AUA'), pasajeros: [usa] }).html;
  assert.match(chile, /180 dias consecutivos en 365/);
  assert.match(chile, /Sale de Chile\./);
  assert.match(chile, /Chile no esta en la lista oficial de Aruba/);
  assert.equal(/Certificado EXIGIDO/.test(chile), false);
});

test('Aruba: conexion el mismo dia en Lima no exige el certificado', () => {
  const arg = { id: 'a', lastname: 'GARCIA', firstname: 'JUAN', parg: { num: 'AAA111' } };
  const { html } = buildRequisitosEmail({
    reserva: reserva('2026-12-24T08:00', {
      piernas: [
        { fecha: '2026-12-24T08:00', vuelo: 'LA2464', origen: 'AEP', destino: 'LIM', escalas: [], reservaVuelo: 'ABCDE' },
        { fecha: '2026-12-24T12:00', vuelo: 'LA2440', origen: 'LIM', destino: 'AUA', escalas: [], reservaVuelo: 'ABCDE' },
      ],
    }),
    pasajeros: [arg],
  });
  const aruba = html.slice(html.indexOf('Aruba'));
  assert.match(aruba, /Sale de Argentina/);
  assert.match(aruba, /1 de febrero de 2019/);
  assert.equal(/Certificado EXIGIDO/.test(aruba), false);
});

test('Aruba: unos dias en Lima si exigen el certificado', () => {
  const arg = { id: 'a', lastname: 'GARCIA', firstname: 'JUAN', parg: { num: 'AAA111' } };
  const { html } = buildRequisitosEmail({
    reserva: reserva('2026-12-24T08:00', {
      piernas: [
        { fecha: '2026-12-24T08:00', vuelo: 'LA2464', origen: 'AEP', destino: 'LIM', escalas: [], reservaVuelo: 'ABCDE' },
        { fecha: '2026-12-28T12:00', vuelo: 'LA2440', origen: 'LIM', destino: 'AUA', escalas: [], reservaVuelo: 'ABCDE' },
      ],
    }),
    pasajeros: [arg],
  });
  const aruba = html.slice(html.indexOf('Aruba'));
  assert.match(aruba, /Sale de Per[uú]/);
  assert.match(aruba, /Certificado EXIGIDO/);
  assert.equal(/1 de febrero de 2019/.test(aruba), false);
});

test('escapa el nombre del pasajero', () => {
  const { html } = buildRequisitosEmail({
    appName: 'TravelDocs',
    reserva: reserva('2026-10-15T09:00'),
    pasajeros: [{ id: 'p1', lastname: 'EVIL <b>', firstname: 'X', parg: { num: '1' } }],
  });
  assert.equal(html.includes('<b>'), false);
  assert.match(html, /EVIL &lt;b&gt;/);
});

test('KIX -> HKG con pasaporte argentino: no requiere visa y sanidad dice No hay vacunas obligatorias', () => {
  const cicero = { id: 'p1', lastname: 'CICERO', firstname: 'SILVANA NORMA', gender: 'F', parg: { num: 'AAA1' } };
  const trapani = { id: 'p2', lastname: 'TRAPANI', firstname: 'SERGIO ISIDORO', gender: 'M', parg: { num: 'AAA2' } };
  const { html } = buildRequisitosEmail({
    appName: 'Trading Travel',
    reserva: reserva('2026-10-22T21:45', {
      piernas: [{ fecha: '2026-10-22T21:45', vuelo: 'CX503', origen: 'KIX', destino: 'HKG', escalas: [], reservaVuelo: 'D2TF5A' }],
      pasajeros: ['p1', 'p2'],
    }),
    pasajeros: [cicero, trapani],
    alCrear: true,
    now: Date.UTC(2026, 9, 19, 13, 0, 0),
  });
  assert.match(html, /Destino RAE de Hong Kong \(China\) \(HKG\)/);
  assert.match(html, /Pasaporte argentino\. Lo tienen los dos\./);
  assert.match(html, /No requiere visa\. Exenta, 90 dias\./);
  assert.match(html, /<p[^>]*>Sanidad<\/p>\s*<p[^>]*>No hay vacunas obligatorias\.<\/p>/);
  assert.equal(/Sale de Jap/.test(html), false);
});

test('Macao (MFM): argentino exento 30 dias y boliviano visa a la llegada', () => {
  const arg = { id: 'a', lastname: 'GARCIA', firstname: 'JUAN', parg: { num: 'A1' } };
  const bol = { id: 'b', lastname: 'MAMANI', firstname: 'LUIS', pext: { country: 'BOL', num: 'B1' } };
  const { html } = buildRequisitosEmail({
    reserva: reserva('2026-11-10T10:00', {
      piernas: [{ fecha: '2026-11-10T10:00', vuelo: 'NX101', origen: 'HKG', destino: 'MFM', escalas: [], reservaVuelo: 'ABCDE' }],
    }),
    pasajeros: [arg, bol],
  });
  assert.match(html, /Destino RAE de Macao \(China\) \(MFM\)/);
  assert.match(html, /No requiere visa\. Exenta, 30 dias\./);
  assert.match(html, /Visa a la llegada \(on arrival\)/);
  assert.match(html, /<p[^>]*>Sanidad[^<]*<\/p>\s*<p[^>]*>No hay vacunas obligatorias\.<\/p>/);
});

test('reentrada a Aruba despues de Paraguay usa la sanidad mas estricta', () => {
  const arg = { id: 'a', lastname: 'GARCIA', firstname: 'JUAN', parg: { num: 'AAA111' } };
  const { html } = buildRequisitosEmail({
    reserva: reserva('2026-10-01T08:00', {
      piernas: [
        { fecha: '2026-10-01T08:00', vuelo: 'AR1400', origen: 'EZE', destino: 'AUA', escalas: [], reservaVuelo: 'ABCDE' },
        { fecha: '2026-10-05T10:00', vuelo: 'AR1401', origen: 'AUA', destino: 'ASU', escalas: [], reservaVuelo: 'ABCDE' },
        { fecha: '2026-10-10T12:00', vuelo: 'AR1402', origen: 'ASU', destino: 'AUA', escalas: [], reservaVuelo: 'ABCDE' },
      ],
    }),
    pasajeros: [arg],
  });
  const aruba = html.slice(html.indexOf('Aruba'));
  assert.match(aruba, /Sale de Paraguay/);
  assert.match(aruba, /EXIGIDO|Certificado EXIGIDO/i);
});

test('destino que no esta en la matriz no queda en silencio: avisa que no hay datos', () => {
  const arg = { id: 'a', lastname: 'GARCIA', firstname: 'JUAN', parg: { num: 'A1' } };
  // Groenlandia (GOH -> GL -> GRL) tiene IATA e ISO3 pero no fila en la matriz.
  const { html } = buildRequisitosEmail({
    reserva: reserva('2026-11-10T10:00', {
      piernas: [{ fecha: '2026-11-10T10:00', vuelo: 'GL781', origen: 'CPH', destino: 'GOH', escalas: [], reservaVuelo: 'ABCDE' }],
    }),
    pasajeros: [arg],
  });
  assert.match(html, /Destino Groenlandia \(GOH\)/);
  assert.match(html, /No tenemos datos de este destino en la base\. Verific[aá] los requisitos antes de emitir\./);
});
