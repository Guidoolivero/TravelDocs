import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './firebase-fixture.mjs';

const ida = { fecha_salida: '2026-12-01T10:00', fecha_llegada: '2026-12-02T00:00', origen: 'EZE', destino: 'MAD', vuelo: 'IB100', compania: 'IB', reservaVuelo: 'ABC123' };
const vuelta = { fecha_salida: '2026-12-15T10:00', fecha_llegada: '2026-12-15T23:00', origen: 'MAD', destino: 'EZE', vuelo: 'IB101', compania: 'IB', reservaVuelo: 'ABC123' };

function pnrFixture(segments) {
  class GoogleGenAI {
    models = { generateContent: async request => {
      const pdf = request.contents.flatMap(c => c.parts || []).find(p => p.inlineData)?.inlineData.data;
      const val = segments[pdf];
      const segs = Array.isArray(val) ? val : (val ? [val] : []);
      return { text: JSON.stringify({ segmentos: segs, pasajeros: [], pnrAmadeus: 'ABC123' }) };
    } };
  }
  return fixture({ env: { GEMINI_API_KEY: 'dummy' }, modules: { '@google/genai': { GoogleGenAI, HarmCategory: {}, HarmBlockThreshold: {} } } });
}

// E-ticket LATAM BUE-AUA: ida EZE-LIM-AUA el 24/12, vuelta AUA-LIM-AEP el 7/8 ene.
const arubaIda1 = { fecha_salida: '2026-12-24T07:20', fecha_llegada: '2026-12-24T12:10', origen: 'EZE', destino: 'LIM', vuelo: 'LA2976', compania: 'LA', reservaVuelo: 'EBUOFH' };
const arubaIda2 = { fecha_salida: '2026-12-24T14:45', fecha_llegada: '2026-12-24T20:10', origen: 'LIM', destino: 'AUA', vuelo: 'LA2440', compania: 'LA', reservaVuelo: 'EBUOFH' };
const arubaVuelta1 = { fecha_salida: '2027-01-07T20:15', fecha_llegada: '2027-01-08T00:35', origen: 'AUA', destino: 'LIM', vuelo: 'LA2441', compania: 'LA', reservaVuelo: 'EBUOFH' };
const arubaVuelta2 = { fecha_salida: '2027-01-08T03:20', fecha_llegada: '2027-01-08T07:40', origen: 'LIM', destino: 'AEP', vuelo: 'LA2465', compania: 'LA', reservaVuelo: 'EBUOFH' };
const arubaSegs = [arubaIda1, arubaIda2, arubaVuelta1, arubaVuelta2];

test('PDFs de vuelta e ida producen dos check-ins cronologicos en cualquier orden', async () => {
  for (const pdfs of [['return', 'outbound'], ['outbound', 'return']]) {
    const f = pnrFixture({ outbound: ida, return: vuelta });
    const response = await f.invoke('pnr-checkin', { pdfs });
    assert.equal(response.statusCode, 200);
    const { data } = JSON.parse(response.body);
    assert.equal(data.piernas.length, 2);
    assert.deepEqual(data.piernas.map(p => [p.fecha, p.origen, p.destino]), [
      ['2026-12-01T10:00', 'EZE', 'MAD'], ['2026-12-15T10:00', 'MAD', 'EZE'],
    ]);
  }
});

test('una conexion valida se agrupa y segmentos solapados no se fusionan', async () => {
  for (const [departure, count] of [['2026-12-02T02:00', 1], ['2026-12-01T12:00', 2]]) {
    const next = { ...ida, fecha_salida: departure, fecha_llegada: '2026-12-02T04:00', origen: 'MAD', destino: 'BCN' };
    const f = pnrFixture({ outbound: ida, next });
    const response = await f.invoke('pnr-checkin', { pdfs: ['next', 'outbound'] });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).data.piernas.length, count);
  }
});

test('ida y vuelta a Aruba con escala en Lima no es multi-city aunque vuelva a AEP', async () => {
  const f = pnrFixture({ ticket: arubaSegs });
  const response = await f.invoke('pnr-checkin', { pdfs: ['ticket'] });
  assert.equal(response.statusCode, 200);
  const { data } = JSON.parse(response.body);
  assert.equal(data.tipo, 'round-trip');
  assert.deepEqual(data.piernas.map(p => [p.origen, p.destino, p.escalas]), [
    ['EZE', 'AUA', ['LIM']],
    ['AUA', 'AEP', ['LIM']],
  ]);
});

test('conexion el mismo dia sin hora real (00:01/23:59) sigue siendo escala', async () => {
  const sinHora = s => ({ ...s, fecha_salida: s.fecha_salida.slice(0, 10) + 'T00:01', fecha_llegada: s.fecha_llegada.slice(0, 10) + 'T23:59' });
  const f = pnrFixture({ ticket: arubaSegs.map(sinHora) });
  const response = await f.invoke('pnr-checkin', { pdfs: ['ticket'] });
  assert.equal(response.statusCode, 200);
  const { data } = JSON.parse(response.body);
  assert.equal(data.tipo, 'round-trip');
  assert.equal(data.piernas.length, 2);
  assert.deepEqual(data.piernas.map(p => p.escalas), [['LIM'], ['LIM']]);
});

test('cuatro e-tickets del mismo itinerario no duplican tramos', async () => {
  const f = pnrFixture({ a: arubaSegs, b: arubaSegs, c: arubaSegs, d: arubaSegs });
  const response = await f.invoke('pnr-checkin', { pdfs: ['a', 'b', 'c', 'd'] });
  assert.equal(response.statusCode, 200);
  const { data } = JSON.parse(response.body);
  assert.equal(data.piernas.length, 2);
  assert.equal(data.tipo, 'round-trip');
});

test('menos de 24h en Lima es escala; 24h o mas es multi destino', async () => {
  const lim23h = { ...arubaIda2, fecha_salida: '2026-12-25T12:09', fecha_llegada: '2026-12-25T17:30' };
  const lim24h = { ...arubaIda2, fecha_salida: '2026-12-25T12:10', fecha_llegada: '2026-12-25T17:30' };
  const rt = await pnrFixture({ ticket: [arubaIda1, lim23h, arubaVuelta1, arubaVuelta2] })
    .invoke('pnr-checkin', { pdfs: ['ticket'] });
  const multi = await pnrFixture({ ticket: [arubaIda1, lim24h, arubaVuelta1, arubaVuelta2] })
    .invoke('pnr-checkin', { pdfs: ['ticket'] });
  const dataRt = JSON.parse(rt.body).data;
  const dataMulti = JSON.parse(multi.body).data;
  assert.equal(dataRt.tipo, 'round-trip');
  assert.deepEqual(dataRt.piernas.map(p => [p.origen, p.destino, p.escalas]), [
    ['EZE', 'AUA', ['LIM']],
    ['AUA', 'AEP', ['LIM']],
  ]);
  assert.equal(dataMulti.tipo, 'multi-city');
  assert.equal(dataMulti.piernas.length, 3);
  assert.deepEqual(dataMulti.piernas.map(p => [p.origen, p.destino]), [
    ['EZE', 'LIM'],
    ['LIM', 'AUA'],
    ['AUA', 'AEP'],
  ]);
});
