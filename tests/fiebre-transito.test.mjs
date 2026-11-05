import test from 'node:test';
import assert from 'node:assert/strict';
import { injectMatrizSanidad } from '../lib/travel-matriz.mjs';
import { buildRequisitosEmail } from '../lib/requisitos-checkin.mjs';
import { etiquetaRequisito } from '../public/js/travel-reqs.mjs';
import { parseGDSSegmentos } from '../public/js/gds-segmentos.mjs';

function parada(iso, iata, tipo, extra = {}) {
  return { pais_codigo: iso, pais: '', aeropuerto_iata: iata, tipo, requisitos: [], ...extra };
}

function fiebre(stops, segmentos, nacionalidad = 'Argentina (ARG)') {
  const data = { ruta: stops };
  injectMatrizSanidad(data, nacionalidad, segmentos);
  const dest = [...data.ruta].reverse().find(s => s.tipo === 'destino');
  const req = (dest?.requisitos || []).find(r => /fiebre|certificado/i.test(`${r.nombre} ${r.descripcion}`));
  assert.ok(req, 'hay tarjeta de fiebre amarilla');
  return req;
}

const arg = { id: 'a', lastname: 'GARCIA', firstname: 'JUAN', parg: { num: 'AAA111' } };

function mail(pierna) {
  return buildRequisitosEmail({
    reserva: { piernas: [{ vuelo: 'CM228', reservaVuelo: 'ABCDE', escalas: [], ...pierna }] },
    pasajeros: [arg],
  }).html;
}

test('EZE-PTY-GUA 45 minutos: el transito en Panama no exige el certificado y Argentina queda sin confirmar', () => {
  const req = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('PAN', 'PTY', 'escala_comercial'),
    parada('GTM', 'GUA', 'destino'),
  ], [
    { origen: 'EZE', destino: 'PTY', fecha: '20FEB26', hora_salida: '0600', hora_llegada: '0940' },
    { origen: 'PTY', destino: 'GUA', fecha: '20FEB26', hora_salida: '1025', hora_llegada: '1155' },
  ]);
  assert.equal(req.obligatorio, false);
  assert.equal(req.certeza, 'incierta');
  assert.equal(etiquetaRequisito(req), 'A confirmar');
  assert.match(req.descripcion, /Sale de Argentina/);
  assert.match(req.descripcion, /No está confirmado/);
  assert.match(req.descripcion, /Misiones\/Corrientes/);
  assert.match(req.descripcion, /45 minutos/);
  assert.match(req.descripcion, /más de 12 horas/);
  assert.match(req.descripcion, /no es una exenci[oó]n para todos los destinos/i);
  assert.doesNotMatch(req.descripcion, /region del Darien|región del Darién/);
  assert.doesNotMatch(req.descripcion, /EZE est[aá] exent/i);
  assert.doesNotMatch(req.descripcion, /Buenos Aires est[aá] exent/i);

  const html = mail({
    fecha: '2026-02-20T06:00', origen: 'EZE', destino: 'GUA', escalas: ['PTY'],
    transitos: [{ iata: 'PTY', minutos: 45, sinHora: false }],
  });
  assert.match(html, /Sale de Argentina/);
  assert.match(html, /No está confirmado/);
  assert.match(html, /45 minutos/);
  assert.doesNotMatch(html, /region del Darien|región del Darién/);
});

test('el umbral de 12 horas es estricto y un origen de riesgo real sigue exigiendo', () => {
  const base = [
    parada('ARG', 'EZE', 'origen'),
    parada('PAN', 'PTY', 'escala_comercial'),
    parada('GTM', 'GUA', 'destino'),
  ];
  const segs = (salida) => [
    { origen: 'EZE', destino: 'PTY', fecha: '20FEB26', hora_salida: '0600', hora_llegada: '0940' },
    { origen: 'PTY', destino: 'GUA', fecha: '20FEB26', hora_salida: salida, hora_llegada: '2300' },
  ];
  const menos = fiebre(base, segs('2110'));
  assert.match(menos.descripcion, /11 h 30 min/);
  assert.doesNotMatch(menos.descripcion, /Darien|Darién/);
  const exacto = fiebre(base, segs('2140'));
  assert.match(exacto.descripcion, /12 horas/);
  assert.doesNotMatch(exacto.descripcion, /Darien|Darién/);
  assert.equal(exacto.obligatorio, false);
  const mas = fiebre(base, segs('2141'));
  assert.equal(mas.obligatorio, true);
  assert.match(mas.descripcion, /Sale de Panam[aá]/);
  assert.match(mas.descripcion, /Darien|Darién/);

  const brasil = fiebre([
    parada('BRA', 'GRU', 'origen'),
    parada('GTM', 'GUA', 'destino'),
  ]);
  assert.equal(brasil.obligatorio, true);
  assert.match(brasil.descripcion, /Sale de Brasil/);
  assert.match(brasil.descripcion, /EXIGIDO/);
});

test('varias conexiones, salida del aeropuerto, cambio de dia y huso', () => {
  const varias = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('PAN', 'PTY', 'escala_comercial'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada('GTM', 'GUA', 'destino'),
  ], [
    { origen: 'EZE', destino: 'PTY', fecha: '20FEB26', hora_salida: '0600', hora_llegada: '0940' },
    { origen: 'PTY', destino: 'GRU', fecha: '20FEB26', hora_salida: '1025', hora_llegada: '1800' },
    { origen: 'GRU', destino: 'GUA', fecha: '21FEB26', hora_salida: '0700', hora_llegada: '1000' },
  ]);
  assert.equal(varias.obligatorio, true);
  assert.match(varias.descripcion, /Sale de Brasil/);
  assert.match(varias.descripcion, /45 minutos/);

  const rollover = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('PAN', 'PTY', 'escala_comercial'),
    parada('GTM', 'GUA', 'destino'),
  ], [
    { origen: 'EZE', destino: 'PTY', fecha: '20FEB26', hora_salida: '2000', hora_llegada: '2350' },
    { origen: 'PTY', destino: 'GUA', fecha: '21FEB26', hora_salida: '0020', hora_llegada: '0210' },
  ]);
  assert.match(rollover.descripcion, /30 minutos/);
  assert.doesNotMatch(rollover.descripcion, /Darien|Darién/);

  const huso = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('PAN', 'PTY', 'escala_comercial'),
    parada('GTM', 'GUA', 'destino'),
  ], [
    { origen: 'EZE', destino: 'PTY', fecha: '2026-02-20T08:00', fecha_llegada: '2026-02-20T11:40' },
    { origen: 'PTY', destino: 'GUA', fecha: '2026-02-20T12:25', fecha_llegada: '2026-02-20T14:00' },
  ]);
  assert.match(huso.descripcion, /45 minutos/);
  assert.doesNotMatch(huso.descripcion, /Darien|Darién/);

  const salida = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('PAN', 'PTY', 'destino', { salio_aeropuerto: true }),
    parada('GTM', 'GUA', 'destino'),
  ], [
    { origen: 'EZE', destino: 'PTY', fecha: '20FEB26', hora_salida: '0600', hora_llegada: '0940' },
    { origen: 'PTY', destino: 'GUA', fecha: '20FEB26', hora_salida: '1025', hora_llegada: '1155' },
  ]);
  assert.equal(salida.obligatorio, true);
  assert.match(salida.descripcion, /Sale de Panam[aá]/);

  const sinHora = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('PAN', 'PTY', 'escala_comercial'),
    parada('GTM', 'GUA', 'destino'),
  ], [
    { origen: 'EZE', destino: 'PTY', fecha: '20FEB26' },
    { origen: 'PTY', destino: 'GUA', fecha: '20FEB26' },
  ]);
  assert.equal(sinHora.obligatorio, false);
  assert.equal(sinHora.certeza, 'incierta');
  assert.match(sinHora.descripcion, /sin horario/);
  assert.doesNotMatch(sinHora.descripcion, /Darien|Darién/);
});

test('cualquier duracion, umbrales propios y reglas universales no se apagan', () => {
  const botsuana = fiebre([
    parada('CHL', 'SCL', 'origen'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada('BWA', 'GBE', 'destino'),
  ], [
    { origen: 'SCL', destino: 'GRU', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1200' },
    { origen: 'GRU', destino: 'GBE', fecha: '20FEB26', hora_salida: '1245', hora_llegada: '1800' },
  ], 'Chile (CHL)');
  assert.equal(botsuana.obligatorio, true);
  assert.match(botsuana.descripcion, /nota 8/);
  assert.match(botsuana.descripcion, /45 minutos/);

  const india = fiebre([
    parada('CHL', 'SCL', 'origen'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada('IND', 'DEL', 'destino'),
  ], [
    { origen: 'SCL', destino: 'GRU', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1200' },
    { origen: 'GRU', destino: 'DEL', fecha: '20FEB26', hora_salida: '1245', hora_llegada: '2000' },
  ], 'Chile (CHL)');
  assert.equal(india.obligatorio, true);
  assert.match(india.descripcion, /nota 8/);

  const nigeria = fiebre([
    parada('CHL', 'SCL', 'origen'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada('NGA', 'LOS', 'destino'),
  ], [
    { origen: 'SCL', destino: 'GRU', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1200' },
    { origen: 'GRU', destino: 'LOS', fecha: '20FEB26', hora_salida: '1245', hora_llegada: '1800' },
  ], 'Chile (CHL)');
  assert.equal(nigeria.obligatorio, true);

  const angola = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('PAN', 'PTY', 'escala_comercial'),
    parada('AGO', 'LAD', 'destino'),
  ], [
    { origen: 'EZE', destino: 'PTY', fecha: '20FEB26', hora_salida: '0600', hora_llegada: '0940' },
    { origen: 'PTY', destino: 'LAD', fecha: '20FEB26', hora_salida: '1025', hora_llegada: '1800' },
  ]);
  assert.equal(angola.obligatorio, true);
  assert.match(angola.descripcion, /Sale de Argentina/);

  const angolaChile = fiebre([
    parada('CHL', 'SCL', 'origen'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada('AGO', 'LAD', 'destino'),
  ], [
    { origen: 'SCL', destino: 'GRU', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1200' },
    { origen: 'GRU', destino: 'LAD', fecha: '20FEB26', hora_salida: '1245', hora_llegada: '1800' },
  ], 'Chile (CHL)');
  assert.equal(angolaChile.obligatorio, false);
  assert.match(angolaChile.descripcion, /NO exigido/);
  assert.doesNotMatch(angolaChile.descripcion, /OBLIGATORIO/);

  function guyana(minutosSalida) {
    return fiebre([
      parada('CHL', 'SCL', 'origen'),
      parada('BRA', 'GRU', 'escala_comercial'),
      parada('GUY', 'GEO', 'destino'),
    ], [
      { origen: 'SCL', destino: 'GRU', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1000' },
      { origen: 'GRU', destino: 'GEO', fecha: '20FEB26', hora_salida: minutosSalida, hora_llegada: '1800' },
    ], 'Chile (CHL)');
  }
  assert.match(guyana('1300').descripcion, /Sale de Chile/);
  assert.match(guyana('1400').descripcion, /Sale de Chile/);
  assert.match(guyana('1400').descripcion, /4 horas/);
  const g5 = guyana('1500');
  assert.match(g5.descripcion, /Sale de Brasil/);
  assert.match(g5.descripcion, /nota 9/);

  const pyCorto = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada('PRY', 'ASU', 'destino'),
  ], [
    { origen: 'EZE', destino: 'GRU', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1000' },
    { origen: 'GRU', destino: 'ASU', fecha: '20FEB26', hora_salida: '2300', hora_llegada: '2330' },
  ]);
  assert.match(pyCorto.descripcion, /Sale de Argentina/);
  assert.match(pyCorto.descripcion, /24 horas/);
  assert.doesNotMatch(pyCorto.descripcion, /Amazonas/);

  const pyLargo = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada('PRY', 'ASU', 'destino'),
  ], [
    { origen: 'EZE', destino: 'GRU', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1000' },
    { origen: 'GRU', destino: 'ASU', fecha: '21FEB26', hora_salida: '1100', hora_llegada: '1200' },
  ]);
  assert.match(pyLargo.descripcion, /Sale de Brasil/);
  assert.match(pyLargo.descripcion, /OBLIGATORIA/);

  const pyPanama = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('PAN', 'PTY', 'escala_comercial'),
    parada('PRY', 'ASU', 'destino'),
  ], [
    { origen: 'EZE', destino: 'PTY', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1000' },
    { origen: 'PTY', destino: 'ASU', fecha: '21FEB26', hora_salida: '1200', hora_llegada: '1800' },
  ]);
  assert.match(pyPanama.descripcion, /Sale de Argentina/);
  assert.doesNotMatch(pyPanama.descripcion, /Amazonas/);

  const salvador = fiebre([
    parada('BRA', 'GRU', 'origen'),
    parada('PAN', 'PTY', 'escala_comercial'),
    parada('SLV', 'SAL', 'destino'),
  ], [
    { origen: 'GRU', destino: 'PTY', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1200' },
    { origen: 'PTY', destino: 'SAL', fecha: '21FEB26', hora_salida: '0200', hora_llegada: '0400' },
  ]);
  assert.equal(salvador.obligatorio, false);
  assert.match(salvador.descripcion, /No se exige/);

  const costa = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('PAN', 'PTY', 'escala_comercial'),
    parada('CRI', 'SJO', 'destino'),
  ], [
    { origen: 'EZE', destino: 'PTY', fecha: '20FEB26', hora_salida: '0600', hora_llegada: '0940' },
    { origen: 'PTY', destino: 'SJO', fecha: '20FEB26', hora_salida: '1025', hora_llegada: '1200' },
  ]);
  assert.equal(costa.obligatorio, false);
  assert.match(costa.descripcion, /Sale de Argentina/);
  assert.match(costa.descripcion, /no figura en la lista de riesgo/);
  assert.doesNotMatch(costa.descripcion, /reconfirmar por posible riesgo/);

  const honduras = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('PAN', 'PTY', 'escala_comercial'),
    parada('HND', 'TGU', 'destino'),
  ], [
    { origen: 'EZE', destino: 'PTY', fecha: '20FEB26', hora_salida: '0600', hora_llegada: '0940' },
    { origen: 'PTY', destino: 'TGU', fecha: '20FEB26', hora_salida: '1025', hora_llegada: '1200' },
  ]);
  assert.equal(honduras.obligatorio, true);
  assert.match(honduras.descripcion, /Sale de Argentina/);
  assert.match(honduras.descripcion, /45 minutos/);
});

test('el GDS conserva las horas del transito', () => {
  const segs = parseGDSSegmentos([
    '2  CM 228 Y 20FEB 5*EZEPTY HK1  0600 0940',
    '3  CM 400 Y 20FEB 5*PTYGUA HK1  1025 1155',
  ].join('\n'));
  assert.equal(segs.length, 2);
  assert.equal(segs[0].origen, 'EZE');
  assert.equal(segs[0].destino, 'PTY');
  assert.equal(segs[0].hora_llegada, '0940');
  assert.equal(segs[1].hora_salida, '1025');
  assert.equal(segs[1].destino, 'GUA');
});
