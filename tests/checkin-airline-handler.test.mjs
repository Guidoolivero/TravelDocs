import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parsePnrPassengers } from '../public/js/parse-pnr-passengers.mjs';
import * as airlines from '../public/js/checkin-airline.mjs';

async function interpret(outputs, payload) {
  let prompt = '';
  class GoogleGenAI {
    constructor() { this.models = { generateContent: async request => {
      prompt = request.contents[0].parts?.[1]?.text || request.contents[0].text;
      return { text: JSON.stringify({ segmentos: outputs.shift(), pasajeros: [] }) };
    } }; }
  }
  const deps = {
    './_auth.cjs': { verifyAuth: async () => ({ ok: true, agencyId: 'test', uid: 'test' }) },
    './_usage.cjs': { recordUsage: async () => {} },
    '../../public/js/parse-pnr-passengers.mjs': { parsePnrPassengers },
    '../../public/js/checkin-airline.mjs': airlines,
    '@google/genai': { GoogleGenAI, HarmCategory: new Proxy({}, { get: (_, key) => key }), HarmBlockThreshold: { BLOCK_ONLY_HIGH: 'high' } },
    './_sentry.cjs': { wrapHandler: fn => fn }
  };
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL('../netlify/functions/pnr-checkin.cjs', import.meta.url), 'utf8'), {
    module, exports: module.exports, require: id => { assert.ok(deps[id], id); return deps[id]; },
    Date, Intl, AbortSignal, Math, setTimeout, console: { log() {}, warn() {}, error() {} }, process: { env: { GEMINI_API_KEY: 'synthetic' } }
  });
  const res = await module.exports.handler({ httpMethod: 'POST', body: JSON.stringify({ ...payload, hoy: '2026-10-23' }) });
  assert.equal(res.statusCode, 200);
  return { data: JSON.parse(res.body).data, prompt };
}
const segment = (extra = {}) => ({ vuelo: 'UX1134', vueloDocumento: '1134', compania: 'AR', companiaFuente: 'logo', companiaEvidencia: 'Logo del condor', fecha_salida: '2026-10-24T15:05', fecha_llegada: '2026-10-25T03:20', origen: 'EZE', destino: 'MAD', reservaVuelo: 'TEST01', ...extra });

test('handler PDF devuelve el numero sin prefijo y la sugerencia pendiente de confirmar', async () => {
  const { data } = await interpret([[segment()]], { pdf: 'cGRm' });
  assert.equal(data.piernas[0].vuelo, '1134');
  assert.equal(data.piernas[0].compania, '');
  assert.equal(data.piernas[0].companiaSugerida, 'AR');
  assert.equal(data.piernas[0].companiaPendiente, true);
});

test('varios PDFs conservan cada confirmacion y no fusionan conexiones con operadora incierta', async () => {
  const { data } = await interpret([[segment()], [segment({ vuelo: 'UX2000', vueloDocumento: '2000', origen: 'MAD', destino: 'BCN', fecha_salida: '2026-10-25T05:00', fecha_llegada: '2026-10-25T06:00' })]], { pdfs: ['cGRm', 'cGRm'] });
  assert.equal(data.piernas.length, 2);
  assert.deepEqual(data.piernas.map(p => p.companiaPendiente), [true, true]);
  assert.deepEqual(data.piernas.map(p => p.vuelo), ['1134', '2000']);
});

test('PNR escrito mantiene el vuelo y la compania sin requerir evidencia de PDF', async () => {
  const { data } = await interpret([[segment({ vuelo: 'AR1134', compania: 'AR', companiaFuente: undefined, companiaEvidencia: undefined })]], { pnr: 'AR1134 EZE MAD' });
  assert.equal(data.piernas[0].vuelo, 'AR1134');
  assert.equal(data.piernas[0].compania, 'AR');
  assert.equal(data.piernas[0].companiaPendiente, false);
});

test('el JSON incompleto no rompe la lectura y tampoco confirma una aerolinea sin evidencia', async () => {
  const { data } = await interpret([[null, segment({ companiaFuente: undefined, companiaEvidencia: undefined })]], { pdf: 'cGRm' });
  assert.equal(data.piernas[0].compania, '');
  assert.equal(data.piernas[0].companiaPendiente, true);
});
