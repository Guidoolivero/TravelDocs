// Test de docs/conocidos.json / public/js/requisitos/conocidos.mjs (fuente unica de
// PAISES_CONOCIDOS + ALERTAS_CONOCIDAS). Detecta ediciones malas del JSON
// antes de regenerar: sameAs que no compila, entradas sin matcher, reqs
// sin campos obligatorios.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAISES_CONOCIDOS, ALERTAS_CONOCIDAS } from '../public/js/requisitos/conocidos.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const json = JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'conocidos.json'), 'utf-8'));

test('conocidos: JSON y modulo generado estan sincronizados', () => {
  // El .mjs se genera desde el JSON: misma cantidad y mismos paises.
  assert.equal(json.paises.length, PAISES_CONOCIDOS.length);
  assert.equal(json.alertas.length, ALERTAS_CONOCIDAS.length);
  const jsonIso = json.paises.map(p => p.iso3.join(',')).sort().join('|');
  const modIso = PAISES_CONOCIDOS.map(p => p.iso3.join(',')).sort().join('|');
  assert.equal(jsonIso, modIso, 'el modulo generado no coincide con el JSON: correr node scripts/gen-conocidos.mjs');
});

test('conocidos: entradas con matcher y reqs bien formados', () => {
  assert.ok(PAISES_CONOCIDOS.length >= 140, `se esperaban ~146 paises, hay ${PAISES_CONOCIDOS.length}`);
  for (const p of PAISES_CONOCIDOS) {
    assert.ok(Array.isArray(p.iso3) && p.iso3.length > 0, `entrada sin iso3: ${JSON.stringify(p).slice(0, 80)}`);
    assert.ok(Array.isArray(p.nombres), `sin nombres: ${p.iso3?.[0]}`);
    assert.ok(Array.isArray(p.reqs), `sin reqs: ${p.iso3?.[0]}`);
    for (const r of p.reqs) {
      assert.ok(r.categoria, `req sin categoria en ${p.iso3?.[0]}`);
      assert.ok(r.nombre, `req sin nombre en ${p.iso3?.[0]}`);
      assert.equal(typeof r.obligatorio, 'boolean', `obligatorio no booleano en ${p.iso3?.[0]}/${r.nombre}`);
      assert.ok(!r.url_oficial || /^https?:\/\//.test(r.url_oficial), `url invalida en ${p.iso3?.[0]}/${r.nombre}`);
      if (r.sameAs !== undefined) assert.ok(r.sameAs instanceof RegExp, `sameAs no es RegExp en ${p.iso3?.[0]}/${r.nombre}`);
    }
  }
});

test('conocidos: alertas con dedup RegExp', () => {
  for (const a of ALERTAS_CONOCIDAS) {
    assert.ok(a.texto, 'alerta sin texto');
    assert.ok(a.dedup instanceof RegExp, 'alerta sin dedup RegExp');
    assert.ok(Array.isArray(a.iso3) && a.iso3.length > 0, 'alerta sin iso3');
  }
});

test('conocidos: Peru tiene TUUA de transferencia solo en escala LIM', () => {
  const peru = PAISES_CONOCIDOS.find(p => p.iso3.includes('PER'));
  assert.ok(peru, 'falta la entrada de Peru');
  const tuua = peru.reqs.find(r => /TUUA/i.test(r.nombre));
  assert.ok(tuua, 'falta la TUUA de transferencia');
  assert.equal(tuua.solo_escala, true);
  assert.equal(tuua.solo_arg, false);
  assert.deepEqual(tuua.iatas, ['LIM']);
  assert.equal(tuua.url_oficial, 'https://pagotuua.lima-airport.com');
  assert.match(tuua.costo_aproximado, /11\.86/);
});

test('conocidos: Cuba usa la e-Visa electronica (desde 01/07/2025)', () => {
  const cuba = PAISES_CONOCIDOS.find(p => p.iso3.includes('CUB'));
  assert.ok(cuba, 'falta la entrada de Cuba');
  const visa = cuba.reqs.find(r => r.categoria === 'visado');
  assert.match(visa.nombre, /e-Visa de turismo/);
  assert.equal(visa.url_oficial, 'https://evisacuba.cu/');
  // El sameAs debe matchear tanto la variante vieja (Tarjeta de Turista)
  // como la nueva (e-Visa) para deduplicar lo que genere el modelo.
  assert.match('Tarjeta de Turista', visa.sameAs);
  assert.match('e-Visa de turismo', visa.sameAs);
});
