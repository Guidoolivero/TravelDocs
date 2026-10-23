import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parsePnrPassengers } from '../../public/js/parse-pnr-passengers.mjs';
import * as airlines from '../../public/js/checkin-airline.mjs';

export async function interpret(outputs, payload) {
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
  runInNewContext(readFileSync(new URL('../../netlify/functions/pnr-checkin.cjs', import.meta.url), 'utf8'), {
    module, exports: module.exports, require: id => { assert.ok(deps[id], id); return deps[id]; },
    Date, Intl, AbortSignal, Math, setTimeout, console: { log() {}, warn() {}, error() {} }, process: { env: { GEMINI_API_KEY: 'synthetic' } }
  });
  const res = await module.exports.handler({ httpMethod: 'POST', body: JSON.stringify({ ...payload, hoy: '2026-10-23' }) });
  assert.equal(res.statusCode, 200);
  return { data: JSON.parse(res.body).data, prompt };
}
