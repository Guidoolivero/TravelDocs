import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './firebase-fixture.mjs';

const ida = { fecha_salida: '2026-12-01T10:00', fecha_llegada: '2026-12-02T00:00', origen: 'EZE', destino: 'MAD', vuelo: 'IB100', compania: 'IB', reservaVuelo: 'ABC123' };
const vuelta = { fecha_salida: '2026-12-15T10:00', fecha_llegada: '2026-12-15T23:00', origen: 'MAD', destino: 'EZE', vuelo: 'IB101', compania: 'IB', reservaVuelo: 'ABC123' };

function pnrFixture(segments) {
  class GoogleGenAI {
    models = { generateContent: async request => {
      const pdf = request.contents.flatMap(c => c.parts || []).find(p => p.inlineData)?.inlineData.data;
      return { text: JSON.stringify({ segmentos: [segments[pdf]], pasajeros: [], pnrAmadeus: 'ABC123' }) };
    } };
  }
  return fixture({ env: { GEMINI_API_KEY: 'dummy' }, modules: { '@google/genai': { GoogleGenAI, HarmCategory: {}, HarmBlockThreshold: {} } } });
}

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
