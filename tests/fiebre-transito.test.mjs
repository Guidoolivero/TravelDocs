import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injectMatrizSanidad, lecturaMatriz } from '../lib/travel-matriz.mjs';
import { buildRequisitosEmail } from '../lib/requisitos-checkin.mjs';
import { etiquetaRequisito } from '../public/js/travel-reqs.mjs';
import { parseGDSSegmentos } from '../public/js/gds-segmentos.mjs';
import { fixture } from './firebase-fixture.mjs';
import { minutosConexion } from '../lib/fiebre-transito.mjs';

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
  assert.match(req.descripcion, /12 horas o menos/);
  assert.match(req.descripcion, /no activa por s[ií] solo/);
  assert.match(req.descripcion, /no anula un requisito por llegada/);
  assert.match(req.descripcion, /m[aá]s de 12 horas/);
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
  assert.match(brasil.descripcion, /Condicional/);
  assert.match(brasil.descripcion, /Se exige si el itinerario/);
  assert.doesNotMatch(brasil.descripcion, /Exigida/);
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
  assert.match(pyLargo.descripcion, /transito aereo/i);
  assert.match(pyLargo.descripcion, /nota 11/);
  assert.doesNotMatch(pyLargo.descripcion, /entrada migratoria|inmigraci[oó]n/i);

  const pyExacto = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada('PRY', 'ASU', 'destino'),
  ], [
    { origen: 'EZE', destino: 'GRU', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1000' },
    { origen: 'GRU', destino: 'ASU', fecha: '21FEB26', hora_salida: '1000', hora_llegada: '1100' },
  ]);
  assert.match(pyExacto.descripcion, /Sale de Argentina/);
  assert.match(pyExacto.descripcion, /24 horas/);
  assert.doesNotMatch(pyExacto.descripcion, /Amazonas/);
  assert.equal(pyExacto.obligatorio, false);

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

test('una escala larga no se toma como entrada: vale el umbral, o la incertidumbre', () => {
  const treinta = (destinoIso, iata) => fiebre([
    parada('CHL', 'SCL', 'origen'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada(destinoIso, iata, 'destino'),
  ], [
    { origen: 'SCL', destino: 'GRU', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1000' },
    { origen: 'GRU', destino: iata, fecha: '21FEB26', hora_salida: '1600', hora_llegada: '2000' },
  ], 'Chile (CHL)');
  const guatemala = treinta('GTM', 'GUA');
  assert.equal(guatemala.obligatorio, true);
  assert.match(guatemala.descripcion, /transito aereo/i);
  assert.match(guatemala.descripcion, /Condicional/);
  assert.match(guatemala.descripcion, /Se exige si el itinerario/);
  assert.doesNotMatch(guatemala.descripcion, /Exigida/);
  assert.doesNotMatch(guatemala.descripcion, /entrada migratoria|inmigraci[oó]n/i);

  const costa = treinta('CRI', 'SJO');
  assert.equal(costa.obligatorio, false);
  assert.match(costa.descripcion, /Sale de Chile/);
  assert.doesNotMatch(costa.descripcion, /EXIGIDO/);

  const sinSalida = fiebre([
    parada('CHL', 'SCL', 'origen'),
    parada('BRA', 'GRU', 'destino'),
    parada('GTM', 'GUA', 'destino'),
  ], [
    { origen: 'SCL', destino: 'GRU', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1200' },
    { origen: 'GRU', destino: 'GUA', fecha: '21FEB26', hora_salida: '1800', hora_llegada: '2200' },
  ], 'Chile (CHL)');
  assert.equal(sinSalida.obligatorio, true);
  assert.match(sinSalida.descripcion, /Sale de Brasil/);
  assert.doesNotMatch(sinSalida.descripcion, /transito aereo/i);
  assert.doesNotMatch(sinSalida.descripcion, /entrada migratoria/);
});

test('Cuba: Sin exigencia no se muestra Obligatorio; Australia no exige por una escala de 45 min', () => {
  const cubaCorta = fiebre([
    parada('CHL', 'SCL', 'origen'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada('CUB', 'HAV', 'destino'),
  ], [
    { origen: 'SCL', destino: 'GRU', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1200' },
    { origen: 'GRU', destino: 'HAV', fecha: '20FEB26', hora_salida: '1245', hora_llegada: '1800' },
  ], 'Chile (CHL)');
  assert.equal(cubaCorta.obligatorio, false);
  assert.match(cubaCorta.descripcion, /Condicional/);
  assert.match(cubaCorta.descripcion, /No se exige por el pasaporte/);
  assert.match(cubaCorta.descripcion, /9 meses/);
  assert.match(cubaCorta.descripcion, /m[aá]s de 12 horas/);
  assert.match(cubaCorta.descripcion, /45 minutos/);

  const cubaLarga = fiebre([
    parada('CHL', 'SCL', 'origen'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada('CUB', 'HAV', 'destino'),
  ], [
    { origen: 'SCL', destino: 'GRU', fecha: '20FEB26', hora_salida: '0600', hora_llegada: '1000' },
    { origen: 'GRU', destino: 'HAV', fecha: '21FEB26', hora_salida: '0000', hora_llegada: '0400' },
  ], 'Chile (CHL)');
  assert.match(cubaLarga.descripcion, /Sale de Brasil/);
  assert.match(cubaLarga.descripcion, /9 meses/);
  assert.match(cubaLarga.descripcion, /m[aá]s de 12 horas/);
  assert.match(cubaLarga.descripcion, /No está confirmado/);
  assert.equal(cubaLarga.certeza, 'incierta');

  const cubaArg = fiebre([
    parada('ARG', 'EZE', 'origen'),
    parada('CUB', 'HAV', 'destino'),
  ]);
  assert.equal(cubaArg.obligatorio, false);
  assert.equal(cubaArg.certeza, 'incierta');
  assert.match(cubaArg.descripcion, /No está confirmado/);
  assert.doesNotMatch(cubaArg.descripcion, /no es pais de riesgo OMS/);

  const australia = fiebre([
    parada('CHL', 'SCL', 'origen'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada('AUS', 'SYD', 'destino'),
  ], [
    { origen: 'SCL', destino: 'GRU', fecha: '20FEB26', hora_salida: '0800', hora_llegada: '1200' },
    { origen: 'GRU', destino: 'SYD', fecha: '20FEB26', hora_salida: '1245', hora_llegada: '1800' },
  ], 'Chile (CHL)');
  assert.equal(australia.obligatorio, false);
  assert.notEqual(australia.certeza, 'incierta');
  assert.match(australia.descripcion, /No se exige/);
  assert.match(australia.descripcion, /pernoctado/);
});

test('Guatemala y Cuba: ocho procedencias de riesgo arrancan Condicional, no por pasaporte', () => {
  const nats = ['BRA', 'PRY', 'BOL', 'COL', 'PER', 'VEN', 'ECU', 'PAN'];
  const clausula = /12 horas o menos, sin salir del aeropuerto, no activa por s[ií] solo la condici[oó]n de tr[aá]nsito; no anula un requisito por llegada desde un pa[ií]s con riesgo/;
  for (const dest of ['GTM', 'CUB']) {
    for (const nat of nats) {
      const t = lecturaMatriz(dest, nat).sanidad.texto;
      assert.match(t, /^Condicional: certificado de fiebre amarilla\./, `${dest} ${nat}`);
      assert.match(t, clausula, `${dest} ${nat}`);
      assert.match(t, /Se exige si el itinerario incluye llegada desde un pa[ií]s con riesgo o tr[aá]nsito aeroportuario de m[aá]s de 12 horas en pa[ií]s con riesgo/, `${dest} ${nat}`);
      assert.doesNotMatch(t, /desde este pa[ií]s/i, `${dest} ${nat}`);
      assert.doesNotMatch(t, /permanencia/i, `${dest} ${nat}`);
      assert.doesNotMatch(t, /\bExigida\b/, `${dest} ${nat}`);
    }
  }
  for (const dest of ['GTM', 'CUB']) {
    const arg = lecturaMatriz(dest, 'ARG').sanidad.texto;
    assert.match(arg, /No está confirmado/);
    assert.match(arg, /EZE incluido/);
    assert.match(arg, clausula);
    assert.doesNotMatch(arg, /desde este pa[ií]s|permanencia/i);
  }
  const chile = lecturaMatriz('GTM', 'CHL').sanidad.texto;
  assert.match(chile, /No se exige por el pasaporte/);
  assert.match(chile, clausula);
  assert.match(chile, /tr[aá]nsito aeroportuario de m[aá]s de 12 horas en pa[ií]s con riesgo/);
});

test('la regla positiva de mas de 12 horas en pais con riesgo queda en la sanidad, y Cuba guarda el contexto en la nota', () => {
  const db = JSON.parse(readFileSync(new URL('../docs/travel-db.json', import.meta.url), 'utf8'));
  const pos = /tránsito aeroportuario de más de 12 horas en país con riesgo/;
  const gua = db.matrices_multinacionalidad.centroamerica.destinos.find(d => d.pais === 'Guatemala');
  const cub = db.matrices_multinacionalidad.norteamerica_caribe.destinos.find(d => d.pais === 'Cuba');
  const reg = db.regiones.centroamerica.paises.find(p => p.pais === 'Guatemala');
  assert.match(reg.sanidad.requisito, /Desde 1 año/);
  assert.match(reg.sanidad.requisito, pos);
  assert.match(reg.sanidad.requisito, /12 horas o menos/);
  assert.match(reg.sanidad.requisito, /aplicación Argentina\/EZE sin excepción confirmada/);
  for (const nat of ['Argentina', 'Guatemala']) {
    assert.match(gua.por_nacionalidad[nat].sanidad, /Desde 1 año/, nat);
    assert.match(gua.por_nacionalidad[nat].sanidad, pos, nat);
  }
  const cortas = ['Argentina', 'UE / EEE', 'Chile', 'Uruguay', 'Mexico', 'Guatemala', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Belice', 'Estados Unidos', 'Canada'];
  for (const nat of cortas) {
    assert.match(cub.por_nacionalidad[nat].sanidad, pos, nat);
    assert.match(cub.por_nacionalidad[nat].sanidad, /12 horas o menos/, nat);
    assert.match(cub.por_nacionalidad[nat].sanidad, /Desde los 9 meses/, nat);
  }
  assert.match(cub.por_nacionalidad.Argentina.sanidad, /aplicación Argentina\/EZE sin excepción confirmada/);
  assert.match(cub.por_nacionalidad.Argentina.sanidad, /No está confirmado/);
  const nota = cub.notas;
  for (const zona of ['Amazonia/algunos estados', 'Paraguay (este)', 'tierras bajas/Amazonia', 'Perú (selva)', 'Ecuador (Amazonia)', 'Darién', 'zonas de riesgo']) {
    assert.match(nota, new RegExp(zona.replace(/[()]/g, '\\$&')));
  }
  assert.match(nota, /pendiente de verificación/);
  assert.match(nota, /no es regla de entrada ni exención de entrada/);
  assert.doesNotMatch(nota, /recomendable|llevar certificado|Argentina no es pa[ií]s de riesgo/i);
  for (const nat of ['Brasil', 'Paraguay', 'Bolivia', 'Colombia', 'Peru', 'Venezuela', 'Ecuador', 'Panama']) {
    assert.doesNotMatch(cub.por_nacionalidad[nat].sanidad, /recomendable|llevar certificado/);
  }
});

test('una estadia en Brasil conserva la procedencia aunque el siguiente vuelo salga de GRU', () => {
  const req = fiebre([
    parada('CHL', 'SCL', 'origen'),
    parada('BRA', 'GRU', 'destino'),
    parada('ABW', 'AUA', 'destino'),
  ], [
    { origen: 'SCL', destino: 'GRU', fecha: '20FEB26', hora_llegada: '1200' },
    { origen: 'GRU', destino: 'AUA', fecha: '24FEB26', hora_salida: '0800' },
  ], 'Chile (CHL)');
  assert.equal(req.obligatorio, true);
  assert.match(req.descripcion, /Sale de Brasil/);
});

test('el backend respeta +1 en la llegada GDS y conserva una conexion de una hora', async () => {
  const ruta = [
    parada('CHL', 'SCL', 'origen'),
    parada('BRA', 'GRU', 'escala_comercial'),
    parada('GTM', 'GUA', 'destino'),
  ];
  class GoogleGenAI {
    models = { generateContent: async () => ({ text: JSON.stringify({ ruta }) }) };
  }
  const f = fixture({
    env: { GEMINI_API_KEY: 'dummy' },
    modules: { '@google/genai': { GoogleGenAI, HarmCategory: {}, HarmBlockThreshold: {} } },
  });
  const segmentos = parseGDSSegmentos([
    'SCL GRU 20FEB 23:00 > 03:00 +1 LA 123',
    'GRU GUA 21FEB 04:00 > 10:00 LA 456',
  ].join('\n'));
  assert.equal(segmentos.length, 2);
  const response = await f.invoke('gemini-travel', {
    fase: 'analisis', nacionalidad: 'Chile (CHL)', segmentos,
  });
  assert.equal(response.statusCode, 200);
  const req = JSON.parse(response.body).data.ruta.at(-1).requisitos.find(r => /fiebre|certificado/i.test(`${r.nombre} ${r.descripcion}`));
  assert.ok(req);
  assert.equal(req.obligatorio, false);
  assert.match(req.descripcion, /\(1 hora\)/);
});

test('el desplazamiento de llegada respeta el calendario y la fecha explicita', () => {
  for (const [fecha, mas_dias, fechaSalida, fecha_llegada] of [
    ['28FEB26', '1', '01MAR26'],
    ['28FEB28', '1', '29FEB28'],
    ['31DEC', '1', '01JAN'],
    ['31DEC26', '2', '02JAN27'],
    ['20FEB26', '1', '22FEB26', '22FEB26'],
    ['20FEB26', '0', '20FEB26'],
    ['20FEB26', 'invalido', '20FEB26'],
  ]) {
    const conexion = minutosConexion(
      { fecha, mas_dias, fecha_llegada, hora_llegada: '0300' },
      { fecha: fechaSalida, hora_salida: '0400' },
    );
    assert.deepEqual(conexion, { minutos: 60, sinHora: false }, `${fecha} +${mas_dias}`);
  }
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
